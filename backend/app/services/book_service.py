"""Book reference service — Phase 05.

Provides list/get/create/update/soft-delete for Book rows, plus a helper
for listing BookCategory rows.  Ref-number allocation is atomic via SQLite's
``BEGIN IMMEDIATE`` serialisation — see ``create_book`` for details.
"""

from __future__ import annotations

import contextlib
import json
import logging
import re
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from pathlib import Path, PurePath
from typing import Any, Final, Literal, NamedTuple
from zoneinfo import ZoneInfo

from sqlalchemy import Integer, and_, exists, false, func, not_, or_, select, text
from sqlalchemy.orm import Session, aliased, selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.constants import ALLOWED_DOC_EXTS, STAMP_STYLES
from app.core.form_kind import (
    OTHER_SERVICE_ID,
    SERVICE_IDS,
    resolve_service,
    service_template_ids,
    subject_prefixes,
)
from app.db.models import (
    AuditLog,
    Book,
    BookAnnotation,
    BookApprovalStep,
    BookCategory,
    BookRevisionAccess,
    BookVersion,
    Document,
    Employee,
    Manager,
    OutboundMessage,
    Submitter,
    User,
)
from app.db.repos.refs_repo import allocate_ref_with_retry
from app.schemas.book import (
    ApprovalLogItem,
    ApprovalSummaryBucket,
    ApprovalSummaryResponse,
    ApproverOptionRead,
    BookApprovalStepRead,
    BookCreate,
    BookUpdate,
    ImportedDocRead,
)
from app.services import notify_format as nf
from app.services import perm_service

log = logging.getLogger(__name__)

MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024  # 25 MiB

_UNSAFE_CHARS = re.compile(r"[\\/:\*\?\"<>\|\x00-\x1f]")

LIST_DEFAULT_LIMIT = 100
LIST_MAX_LIMIT = 500
_ORGANIZATION_TIMEZONE = ZoneInfo("Asia/Dubai")


def count_my_generated_documents(db: Session, *, user_id: int) -> dict[str, int]:
    now_local = datetime.now(_ORGANIZATION_TIMEZONE)
    day_start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start_local = day_start_local - timedelta(days=now_local.weekday())
    day_start_utc = day_start_local.astimezone(UTC).replace(tzinfo=None)
    week_start_utc = week_start_local.astimezone(UTC).replace(tzinfo=None)

    def count_since(boundary: datetime) -> int:
        count = db.scalar(
            select(func.count())
            .select_from(BookVersion)
            .where(
                BookVersion.created_by_user_id == user_id,
                BookVersion.created_at >= boundary,
            )
        )
        return int(count or 0)

    return {
        "documents_today": count_since(day_start_utc),
        "documents_week": count_since(week_start_utc),
    }




# ---------------------------------------------------------------------------
# Category helpers
# ---------------------------------------------------------------------------


def list_book_categories(db: Session, user: User | None = None) -> list[BookCategory]:
    """Return visible categories in natural numeric order ("1", "2", …)."""
    stmt = select(BookCategory)
    if user is not None:
        _denied_services, denied_categories = perm_service.denied_record_types(db, user)
        if denied_categories:
            stmt = stmt.where(BookCategory.id.not_in(denied_categories))
    stmt = stmt.order_by(func.cast(BookCategory.id, Integer), BookCategory.id)
    return list(db.execute(stmt).scalars().all())


# ---------------------------------------------------------------------------
# Book read helpers
# ---------------------------------------------------------------------------


def derive_subject(book: Book) -> str | None:
    """The display subject for a Records row.

    Prefer the operator-entered ``subject`` token captured in a version's
    ``fields`` blob (only the General Book form has a free-text subject today);
    fall back to the stored ``Book.subject`` (which, for generated forms, holds a
    ``"<form type> — <employee name>"`` placeholder). Reads only the already-
    loaded ``versions`` relationship — no extra query.
    """
    for version in reversed(book.versions):
        fields = version.fields
        if isinstance(fields, dict):
            value = fields.get("subject")
            if isinstance(value, str) and value.strip():
                return value.strip()
    return book.subject


def _fts_query_books(db: Session, q: str) -> dict[int, str]:
    """Run an FTS5 query on books_fts; return {book_id: snippet}.

    Normalises the query with normalize_ar, splits into tokens, and appends
    ``*`` to the last token for prefix-match typing (e.g. ``تصريح أمن*``).

    Falls back to {} on any error (missing FTS table, syntax, etc.) so the
    caller's ilike path still works.
    """
    from app.core.book_text import normalize_ar

    norm = normalize_ar(q.strip())
    if not norm:
        return {}

    tokens = norm.split()
    if not tokens:
        return {}
    # Append prefix wildcard to last token only; escape embedded quotes.
    escaped = [t.replace('"', '""') for t in tokens]
    match_str = (
        " ".join([*escaped[:-1], escaped[-1] + "*"]) if len(escaped) > 1 else escaped[0] + "*"
    )

    try:
        rows = db.execute(
            text(
                "SELECT rowid, snippet(books_fts, 0, '[', ']', '…', 12) AS snip"
                " FROM books_fts WHERE books_fts MATCH :m"
            ),
            {"m": match_str},
        ).all()
        return {int(r.rowid): (r.snip or "") for r in rows}
    except Exception:
        log.warning("books FTS query failed for %r; falling back to ilike-only", q, exc_info=True)
        return {}


def service_clause(service_id: str) -> ColumnElement[bool]:
    """SQL for "this book belongs to `service_id`".

    Mirrors `form_kind.resolve_service`, generated from the same prefix table:
    a book belongs to a service if its NEWEST version carries that
    `template_id`, or — being version-less — its subject starts with one of
    the service's names. `OTHER_SERVICE_ID` is the literal negation of every
    named clause, so the buckets are provably complementary: no book can land
    in two or in none. Any `service_id` that is neither `OTHER_SERVICE_ID` nor
    a member of `SERVICE_IDS` matches nothing — `resolve_service` never
    returns such a value, so the SQL must not invent a match for it either.

    "Newest" means highest `version_no` (a correlated per-book subquery), NOT
    "any version" — `resolve_service` (via `BookRead.service_id`) only ever
    consults `versions[-1]`, the relationship's `order_by="version_no"` tail.
    Today no live book carries two distinct `template_id`s across its
    versions, so the two would agree either way — but matching "any version"
    would silently break the "exactly one bucket" guarantee the moment a book
    ever does acquire two differently-templated versions (it would be claimed
    by two named services and excluded from `other` simultaneously).

    `subject_prefixes()` is asserted wildcard-free in test_form_kind, so
    interpolating it into ILIKE cannot widen the match. Both the subject
    branch and the newest-version comparison are guarded with ``is_not(None)``:
    ILIKE/``==`` against a NULL value evaluates to SQL's UNKNOWN (not FALSE),
    which would otherwise make a subject-less, version-less book (or a
    versioned book whose newest version has a NULL `template_id`) vanish from
    every bucket instead of landing in `other`.
    """
    if service_id == OTHER_SERVICE_ID:
        return and_(*[not_(service_clause(s)) for s in SERVICE_IDS])
    if service_id not in SERVICE_IDS:
        return false()
    newest_template_id = (
        select(BookVersion.template_id)
        .where(BookVersion.book_id == Book.id)
        .order_by(BookVersion.version_no.desc())
        .limit(1)
        .scalar_subquery()
    )
    is_newest_version_of = and_(
        newest_template_id.is_not(None),
        newest_template_id.in_(service_template_ids(service_id)),
    )
    prefixes = subject_prefixes(service_id)
    return or_(
        is_newest_version_of,
        and_(
            Book.id.not_in(select(BookVersion.book_id)),
            Book.subject.is_not(None),
            or_(*[Book.subject.ilike(f"{p}%") for p in prefixes]),
        ),
    )


def user_visibility_clause(db: Session, user: User) -> ColumnElement[bool] | None:
    """SQL clause hiding every service/category explicitly denied to ``user``."""
    denied_services, denied_categories = perm_service.denied_record_types(db, user)
    clauses: list[ColumnElement[bool]] = []
    if denied_categories:
        clauses.append(Book.category_id.not_in(denied_categories))
    if denied_services:
        clauses.append(
            not_(or_(*[service_clause(service_id) for service_id in sorted(denied_services)]))
        )
    return and_(*clauses) if clauses else None


def document_visibility_clause(db: Session, user: User) -> ColumnElement[bool] | None:
    """Hide Documents whose service or owning submission category is denied."""
    denied_services, denied_categories = perm_service.denied_record_types(db, user)
    clauses: list[ColumnElement[bool]] = []
    if denied_services:
        denied_template_ids = {
            template_id
            for service_id in denied_services
            if service_id != OTHER_SERVICE_ID
            for template_id in service_template_ids(service_id)
        }
        if denied_template_ids:
            clauses.append(Document.template_id.not_in(sorted(denied_template_ids)))
        if OTHER_SERVICE_ID in denied_services:
            named_template_ids = {
                template_id
                for service_id in SERVICE_IDS
                for template_id in service_template_ids(service_id)
            }
            clauses.append(Document.template_id.in_(sorted(named_template_ids)))
    if denied_categories:
        linked_document = aliased(Document)
        linked_to_denied_category = exists(
            select(BookVersion.id)
            .select_from(BookVersion)
            .join(Book, Book.id == BookVersion.book_id)
            .join(linked_document, linked_document.id == BookVersion.document_id)
            .where(
                Book.category_id.in_(sorted(denied_categories)),
                or_(
                    linked_document.id == Document.id,
                    and_(
                        Document.role == "companion",
                        linked_document.role == "primary",
                        linked_document.submission_id == Document.submission_id,
                    ),
                ),
            )
            .correlate(Document)
        )
        clauses.append(not_(linked_to_denied_category))
    return and_(*clauses) if clauses else None


def require_record_type_access(
    db: Session,
    user: User,
    *,
    category_id: str | None = None,
    service_id: str | None = None,
) -> None:
    """Require the user's effective dynamic caps for a record type."""
    if category_id is not None and db.get(BookCategory, category_id) is None:
        raise NotFoundError(
            "BOOK_CATEGORY_NOT_FOUND",
            f"Book category {category_id!r} does not exist",
            category_id=category_id,
        )
    caps = perm_service.effective_caps(db, user)
    category_denied = category_id is not None and f"books.category.{category_id}" not in caps
    service_denied = service_id is not None and f"books.service.{service_id}" not in caps
    if category_denied or service_denied:
        raise AppError(
            "RECORD_TYPE_FORBIDDEN",
            "You don't have access to this record type.",
            http_status=403,
        )


def assert_record_type_visible(db: Session, user: User, row: Book) -> None:
    """Raise the stable 403 when ``row`` belongs to a denied record type."""
    denied_services, denied_categories = perm_service.denied_record_types(db, user)
    newest = max(row.versions, key=lambda version: version.version_no, default=None)
    service_id = resolve_service(
        row.subject,
        newest.template_id if newest is not None else None,
        versioned=newest is not None,
    )
    if row.category_id in denied_categories or service_id in denied_services:
        raise AppError(
            "RECORD_TYPE_FORBIDDEN",
            "You don't have access to this record type.",
            http_status=403,
        )


class BookReadAccess(NamedTuple):
    full_access: bool
    allowed_version_ids: frozenset[int]
    selected_version_id: int | None


def resolve_book_read_access(
    db: Session, user: User, book: Book, *, version_id: int | None = None,
) -> BookReadAccess:
    """Resolve the exact readable revisions without granting record mutation authority."""
    if book.deleted_at is not None and not perm_service.has_capability(db, user, "users.manage"):
        raise NotFoundError("BOOK_NOT_FOUND", "Record not found")
    versions = sorted(book.versions, key=lambda version: version.version_no)
    ids = frozenset(version.id for version in versions)
    if version_id is not None and version_id not in ids:
        raise NotFoundError("VERSION_NOT_FOUND", "Revision not found")
    has_view = perm_service.has_capability(db, user, "books.view")
    full = has_view
    record_type_error: AppError | None = None
    if full:
        try:
            assert_record_type_visible(db, user, book)
        except AppError as exc:
            if exc.code != "RECORD_TYPE_FORBIDDEN":
                raise
            full = False
            record_type_error = exc
    if full:
        return BookReadAccess(True, ids, version_id or (versions[-1].id if versions else None))
    allowed = set(db.scalars(
        select(BookRevisionAccess.version_id).join(BookVersion).where(
            BookVersion.book_id == book.id,
            BookRevisionAccess.user_id == user.id,
            BookRevisionAccess.revoked_at.is_(None),
        )
    ))
    if versions and book.deleted_at is None and book.voided_at is None:
        current = versions[-1]
        if any(
            step.assignee_user_id == user.id and step.state == "pending"
            and step.kind in ("approver", "reviewer")
            for step in current.approval_steps
        ):
            allowed.add(current.id)
    if not allowed or (version_id is not None and version_id not in allowed):
        never_assigned = not (
            db.scalar(
                select(BookApprovalStep.id)
                .join(BookVersion)
                .where(BookVersion.book_id == book.id, BookApprovalStep.assignee_user_id == user.id)
                .limit(1)
            )
            is not None
            or db.scalar(
                select(BookRevisionAccess.id)
                .join(BookVersion)
                .where(BookVersion.book_id == book.id, BookRevisionAccess.user_id == user.id)
                .limit(1)
            )
            is not None
        )
        if record_type_error is not None and never_assigned:
            raise record_type_error
        raise AppError(
            "FORBIDDEN", "You do not have access to this revision.", http_status=403,
        )
    selected = version_id or next(version.id for version in reversed(versions) if version.id in allowed)
    return BookReadAccess(False, frozenset(allowed), selected)


def require_book_access(db: Session, user: User, row: Book) -> None:
    resolve_book_read_access(db, user, row)


def require_full_book_access(db: Session, user: User, row: Book) -> None:
    """Require normal books.view + type visibility. Never satisfied by an assignment."""
    if not perm_service.has_capability(db, user, "books.view"):
        raise AppError(
            "FORBIDDEN", "Missing capability: books.view", http_status=403,
            details={"capability": "books.view"},
        )
    assert_record_type_visible(db, user, row)


class ServiceCount(NamedTuple):
    """One rail entry's numbers. `states` maps approval_state → count."""

    service_id: str
    count: int  # type: ignore[assignment]  # shadows tuple.count; field name is the public API
    states: dict[str, int]


def service_facets(
    db: Session, user: User | None = None
) -> tuple[ServiceCount, list[ServiceCount]]:
    """`(all_records, per_service)` over EVERY non-deleted book.

    Deliberately unpaginated: these are the numbers the Records rail and the
    status spine display, and computing them from a page window is what made
    them disagree with the page's own total.

    "The book's template" is its NEWEST version's template_id, defined exactly
    as `service_clause` and `BookRead.service_id` define it — highest
    `version_no`. Do NOT use `func.max(BookVersion.template_id)`: that is the
    lexicographic max across all versions, which reintroduces the any-vs-newest
    divergence Task 3 removed, and would let a multi-template book be counted
    under a service it no longer belongs to. The separate version count
    distinguishes "no version at all" from "has a version whose template is
    NULL" — the two resolve differently.

    # ponytail: one full scan with two correlated subqueries per row — 629 rows
    # today, and book_versions.book_id is indexed. If books pass ~50k,
    # denormalise service_id onto `books`.
    """
    newest_template_id = (
        select(BookVersion.template_id)
        .where(BookVersion.book_id == Book.id)
        .order_by(BookVersion.version_no.desc())
        .limit(1)
        .scalar_subquery()
    )
    n_versions = (
        select(func.count())
        .select_from(BookVersion)
        .where(BookVersion.book_id == Book.id)
        .scalar_subquery()
    )
    stmt = select(Book.subject, Book.approval_state, newest_template_id, n_versions).where(
        Book.deleted_at.is_(None)
    )
    if user is not None:
        visibility = user_visibility_clause(db, user)
        if visibility is not None:
            stmt = stmt.where(visibility)

    all_states: Counter[str] = Counter()
    per_service: dict[str, Counter[str]] = {}
    for subject, approval_state, template_id, n_versions in db.execute(stmt):
        service_id = resolve_service(subject, template_id, versioned=n_versions > 0)
        state = approval_state or "none"
        all_states[state] += 1
        per_service.setdefault(service_id, Counter())[state] += 1

    ordered = [*SERVICE_IDS, OTHER_SERVICE_ID]
    services = [
        ServiceCount(sid, sum(per_service[sid].values()), dict(per_service[sid]))
        for sid in ordered
        if sid in per_service
    ]
    all_records = ServiceCount("all", sum(all_states.values()), dict(all_states))
    return all_records, services


def list_books(
    db: Session,
    *,
    user: User | None = None,
    category_id: str | None = None,
    service_id: str | None = None,
    direction: str | None = None,
    approval_state: str | None = None,
    q: str | None = None,
    from_date: datetime | None = None,
    to_date: date | None = None,
    limit: int = LIST_DEFAULT_LIMIT,
    offset: int = 0,
    include_deleted: bool = False,
) -> tuple[list[Book], int, dict[int, str]]:
    """Paginated list with optional filters.

    Returns ``(rows, total, snippet_map)`` where ``snippet_map`` maps book
    id → FTS snippet string for rows that matched via body search.  Rows that
    matched only via ilike (ref/subject) are absent from the map.
    """
    limit = max(1, min(limit, LIST_MAX_LIMIT))
    offset = max(0, offset)

    # FTS body search — run first so we know which ids matched body text.
    fts_snippets: dict[int, str] = {}
    fts_ids: set[int] = set()
    if q:
        fts_snippets = _fts_query_books(db, q)
        fts_ids = set(fts_snippets)

    stmt = select(Book)
    count_stmt = select(func.count()).select_from(Book)

    if user is not None:
        visibility = user_visibility_clause(db, user)
        if visibility is not None:
            stmt = stmt.where(visibility)
            count_stmt = count_stmt.where(visibility)
    if not include_deleted:
        stmt = stmt.where(Book.deleted_at.is_(None))
        count_stmt = count_stmt.where(Book.deleted_at.is_(None))

    if category_id is not None:
        stmt = stmt.where(Book.category_id == category_id)
        count_stmt = count_stmt.where(Book.category_id == category_id)

    if service_id is not None:
        svc_clause = service_clause(service_id)
        stmt = stmt.where(svc_clause)
        count_stmt = count_stmt.where(svc_clause)

    if direction is not None:
        stmt = stmt.where(Book.direction == direction)
        count_stmt = count_stmt.where(Book.direction == direction)

    if approval_state is not None:
        stmt = stmt.where(Book.approval_state == approval_state)
        count_stmt = count_stmt.where(Book.approval_state == approval_state)

    if q:
        needle = f"%{q.strip()}%"
        ilike_clause = or_(
            Book.subject.ilike(needle),
            Book.ref_number.ilike(needle),
        )
        # Union: ilike OR FTS body match (ternary; fts_ids empty = ilike only).
        clause = or_(ilike_clause, Book.id.in_(fts_ids)) if fts_ids else ilike_clause
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)

    if from_date is not None:
        stmt = stmt.where(Book.created_at >= from_date)
        count_stmt = count_stmt.where(Book.created_at >= from_date)

    if to_date is not None:
        # ``to_date`` is a calendar day; include the whole day by using an
        # exclusive upper bound at the start of the next day (a plain
        # ``created_at <= to_date`` coerces to midnight and drops same-day rows).
        upper = datetime.combine(to_date, datetime.min.time()) + timedelta(days=1)
        stmt = stmt.where(Book.created_at < upper)
        count_stmt = count_stmt.where(Book.created_at < upper)

    stmt = (
        stmt.options(
            selectinload(Book.category),
            selectinload(Book.versions).selectinload(BookVersion.approval_steps),
        )
        .order_by(Book.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    rows = list(db.execute(stmt).scalars().all())
    total = int(db.execute(count_stmt).scalar_one())
    return rows, total, fts_snippets


def get_book(
    db: Session,
    book_id: int,
    *,
    include_deleted: bool = False,
) -> Book:
    """Raise ``NotFoundError`` if the book is absent or soft-deleted."""
    row = db.get(Book, book_id)
    if row is None:
        raise NotFoundError("BOOK_NOT_FOUND", f"Book {book_id} does not exist", id=book_id)
    if not include_deleted and row.deleted_at is not None:
        raise NotFoundError("BOOK_NOT_FOUND", f"Book {book_id} has been deleted", id=book_id)
    return row


def get_book_by_ref(db: Session, ref_number: str) -> Book:
    """Resolve a book by its exact (case-insensitive) ``ref_number``.

    Backs the smart-link book-chip deep-link: a ref string parsed out of an
    email body (e.g. ``GS-0005``) is looked up to its book id so the Books page
    can open the exact entry. Soft-deleted books are excluded. Raises
    ``NotFoundError`` when no live book carries the ref.
    """
    needle = ref_number.strip()
    stmt = (
        select(Book)
        .where(func.lower(Book.ref_number) == needle.lower())
        .where(Book.deleted_at.is_(None))
        .limit(1)
    )
    row = db.execute(stmt).scalars().first()
    if row is None:
        raise NotFoundError(
            "BOOK_NOT_FOUND",
            f"No book with reference {ref_number!r}",
            ref_number=ref_number,
        )
    return row


def get_book_detail(db: Session, book_id: int, *, include_deleted: bool = False) -> Book:
    """get_book + eager-load versions and their approval steps (for the detail endpoint)."""
    stmt = (
        select(Book)
        .options(selectinload(Book.versions).selectinload(BookVersion.approval_steps))
        .where(Book.id == book_id)
    )
    row = db.execute(stmt).scalars().first()
    if row is None:
        raise NotFoundError("BOOK_NOT_FOUND", f"Book {book_id} does not exist", id=book_id)
    if not include_deleted and row.deleted_at is not None:
        raise NotFoundError("BOOK_NOT_FOUND", f"Book {book_id} has been deleted", id=book_id)
    return row


def _get_book_with_versions(db: Session, book_id: int) -> Book:
    """get_book + eager-load versions and their steps (approval write paths)."""
    stmt = (
        select(Book)
        .options(
            selectinload(Book.versions).selectinload(BookVersion.approval_steps),
            selectinload(Book.versions).selectinload(BookVersion.annotations),
        )
        .where(Book.id == book_id)
    )
    book = db.execute(stmt).scalars().first()
    if book is None or book.deleted_at is not None:
        raise NotFoundError("BOOK_NOT_FOUND", f"Book {book_id} does not exist", id=book_id)
    return book


# ---------------------------------------------------------------------------
# Book write helpers
# ---------------------------------------------------------------------------


def create_book(db: Session, payload: BookCreate) -> Book:
    """Atomically allocate a ref number and insert the book row.

    Uses SQLite's ``BEGIN IMMEDIATE`` to serialise concurrent writers.
    If anything fails after allocation the transaction rolls back, so the
    counter reverts and no number is wasted.

    Note: ``BookCreate.stamp_style`` is validated by Pydantic via the
    ``BookStampStyle`` Literal — extra defence here validates against the
    canonical tuple from ``core.constants.STAMP_STYLES``.
    """
    # Validate category exists.
    category = db.get(BookCategory, payload.category_id)
    if category is None:
        raise NotFoundError(
            "BOOK_CATEGORY_NOT_FOUND",
            f"Book category {payload.category_id!r} does not exist",
            category_id=payload.category_id,
        )

    # Validate stamp_style against the authoritative constant.
    if payload.stamp_style not in STAMP_STYLES:
        raise ValidationFailedError(
            "INVALID_STAMP_STYLE",
            f"stamp_style {payload.stamp_style!r} is not a recognised style",
            valid=list(STAMP_STYLES),
        )

    # Serialised + bounded-retry ref allocation (BEGIN IMMEDIATE inside the
    # helper). The caller's db.commit() below keeps allocation atomic with the
    # Book insert.
    ref_number = allocate_ref_with_retry(db, payload.category_id)

    row = Book(
        category_id=payload.category_id,
        ref_number=ref_number,
        subject=payload.subject,
        direction=payload.direction,
        stamp_style=payload.stamp_style,
        created_at=datetime.now(UTC).replace(tzinfo=None),
        deleted_at=None,
    )
    db.add(row)
    db.flush()  # assign row.id before creating the v1 version
    db.add(
        BookVersion(
            book_id=row.id,
            version_no=1,
            trigger="initial",
            status="none",
            created_at=row.created_at,
        )
    )
    db.commit()
    db.refresh(row)
    return row


def update_book(db: Session, book_id: int, payload: BookUpdate) -> Book:
    """Partial update — subject, direction, stamp_style only."""
    row = get_book(db, book_id)
    data: dict[str, Any] = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


def delete_book(db: Session, book_id: int) -> None:
    """Soft-delete: set deleted_at.  Ref number is NOT released."""
    row = get_book(db, book_id)
    row.deleted_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()


# ---------------------------------------------------------------------------
# Approval chain (plan Tasks 5-8)
# ---------------------------------------------------------------------------

# Decisions a current-step assignee can take via decide_step.
# "approved" is intentionally absent: approval must go through sign_book,
# which embeds the signer's signature into the document.
_DECISIONS: frozenset[str] = frozenset({"rejected", "returned"})


def _current_version(book: Book) -> BookVersion | None:
    """The highest-numbered version — the book's "current" state.

    Relies on Book.versions being mapped with order_by=version_no (ascending).
    """
    return book.versions[-1] if book.versions else None


def _approver_steps(version: BookVersion | None) -> list[BookApprovalStep]:
    """Steps that gate approval_state — the single signing manager (kind=approver).
    Legacy rows created before migration 0039 default to 'approver'; in-memory
    steps whose kind hasn't been written yet also default to 'approver'."""
    if version is None:
        return []
    return [s for s in version.approval_steps if (s.kind or "approver") == "approver"]


def _recompute_approval_state(book: Book) -> None:
    """Derive the current version's status from its steps, mirror to the book.

    Precedence: any rejected → "rejected"; else any returned → "returned"; else
    all approved → "approved"; else "pending". No steps → "none".
    Only approver-kind steps gate the state; reviewer steps are advisory.
    """
    version = _current_version(book)
    steps = sorted(_approver_steps(version), key=lambda s: s.step_order)
    if not steps:
        state = "none"
    elif any(s.state == "rejected" for s in steps):
        state = "rejected"
    elif any(s.state == "returned" for s in steps):
        state = "returned"
    elif all(s.state == "approved" for s in steps):
        state = "approved"
    else:
        state = "pending"
    if version is not None:
        version.status = state
    book.approval_state = state


def _current_pending_step(book: Book) -> BookApprovalStep | None:
    """The lowest-order pending approver step of the current version.
    Reviewer steps are advisory and never returned as the 'current' step."""
    version = _current_version(book)
    if version is None:
        return None
    for step in sorted(_approver_steps(version), key=lambda s: s.step_order):
        if step.state == "pending":
            return step
    return None


def _approval_context(
    db: Session,
    book: Book,
    version: BookVersion,
    *,
    submitted_by_user_id: int | None,
    submitted_at: datetime | None,
) -> dict[str, object]:
    """Freeze only the current revision; unknown legacy submission time stays null."""
    current = _current_version(book)
    if current is not version:
        raise ValueError("Cannot capture historical revision metadata from the current record")
    manager = db.get(Manager, book.doc_manager_id) if book.doc_manager_id else None
    manager_user_id = manager.user_id if manager else None
    names = resolve_names_by_ids(
        db, {uid for uid in (submitted_by_user_id, manager_user_id) if uid is not None}
    )
    fields = version.fields or {}
    subject = fields.get("subject")
    subject = subject.strip() if isinstance(subject, str) and subject.strip() else book.subject
    instant = (
        submitted_at.replace(tzinfo=UTC) if submitted_at and submitted_at.tzinfo is None
        else submitted_at
    )
    return {
        "subject": subject,
        "category_id": book.category_id,
        "category_name_ar": book.category.name_ar if book.category else None,
        "category_name_en": book.category.name_en if book.category else None,
        "priority": book.priority,
        "direction": book.direction,
        "stamp_style": book.stamp_style,
        "employee_id": book.employee_id,
        "employee_name_snapshot": book.employee_name_snapshot,
        "submitted_by_user_id": submitted_by_user_id,
        "submitted_by_name": names.get(submitted_by_user_id) if submitted_by_user_id else None,
        "doc_manager_user_id": manager_user_id,
        "doc_manager_name": names.get(manager_user_id) if manager_user_id else None,
        "submitted_at": instant.isoformat() if instant else None,
    }


def capture_approval_context(
    db: Session,
    book: Book,
    version: BookVersion,
    *,
    submitted_by_user_id: int | None,
    submitted_at: datetime,
) -> None:
    version.approval_context = _approval_context(
        db, book, version,
        submitted_by_user_id=submitted_by_user_id, submitted_at=submitted_at,
    )


def retain_revision_access(db: Session, version: BookVersion, step: BookApprovalStep) -> None:
    """Retain a real completion without reviving revoked rights, including another role."""
    if (
        step.kind not in ("approver", "reviewer")
        or step.state not in ("approved", "rejected", "returned", "reviewed", "changes_requested")
        or step.decided_at is None
        or step.version_id != version.id
    ):
        return
    grants = list(db.scalars(select(BookRevisionAccess).where(
        BookRevisionAccess.version_id == version.id,
        BookRevisionAccess.user_id == step.assignee_user_id,
    )))
    grants.extend(
        grant for grant in db.new
        if isinstance(grant, BookRevisionAccess)
        and grant.version_id == version.id and grant.user_id == step.assignee_user_id
        and grant not in grants
    )
    existing = next((grant for grant in grants if grant.kind == step.kind), None)
    revoked = next((grant for grant in grants if grant.revoked_at is not None), None)
    if existing is None:
        existing = BookRevisionAccess(
            version_id=version.id, user_id=step.assignee_user_id, kind=step.kind,
        )
        db.add(existing)
    if existing.decided_at is None or existing.decided_at <= step.decided_at:
        existing.state = step.state
        existing.note = step.note
        existing.assigned_at = step.created_at
        existing.decided_at = step.decided_at
    if revoked is not None:
        existing.revoked_at = revoked.revoked_at
        existing.revoked_by_user_id = revoked.revoked_by_user_id
        existing.revocation_reason = revoked.revocation_reason


def submit_for_approval(
    db: Session,
    book_id: int,
    *,
    priority: str,
    approver_user_id: int | None,
    reviewer_user_ids: Sequence[int],
    submitted_by_user_id: int,
) -> Book:
    """Fresh chain: one approver step (the signing manager) + 0..N advisory
    reviewer steps. The approver defaults to the doc's linked manager
    (Book.doc_manager_id → Manager.user_id) when ``approver_user_id`` is None."""
    book = _get_book_with_versions(db, book_id)
    version = _current_version(book)
    if version is None:
        raise ValidationFailedError("NO_VERSION", "Book has no version to submit")
    if version.status == "awaiting_scan":
        raise ValidationFailedError(
            "AWAITING_SCAN",
            "This form awaits its signed scanned copy; file the scan instead of "
            "submitting for approval.",
        )
    if version.manager_sig_embedded:
        raise ValidationFailedError(
            "SIGNATURE_ALREADY_PRESENT",
            "This form already carries the manager signature; it can't be sent for approval.",
        )
    if version.status == "approved" or version.signed_pdf_path:
        raise ValidationFailedError(
            "ALREADY_SIGNED",
            "This version is already signed/approved; it can't be re-submitted for approval.",
        )

    # Resolve the approver: explicit arg wins, else the doc's linked manager.
    resolved_id = approver_user_id
    if resolved_id is None and book.doc_manager_id is not None:
        mgr = db.get(Manager, book.doc_manager_id)
        resolved_id = mgr.user_id if mgr is not None else None
    if resolved_id is None:
        raise ValidationFailedError(
            "APPROVER_REQUIRED",
            "No signing manager is linked to this document. Link the manager to a "
            "login account in Settings → Managers, or pick one.",
        )
    approver_id = resolved_id  # lenient: signature enforced at sign-time, not here
    # Validate the approver is a real, active account before we build the step.
    # BookApprovalStep.assignee_user_id is a NOT-NULL FK (ondelete=RESTRICT), so a
    # stale/deleted id would otherwise blow up as an opaque 500 at db.commit().
    approver = db.get(User, approver_id)
    if approver is None or approver.status != "active":
        raise ValidationFailedError(
            "APPROVER_NOT_ELIGIBLE",
            "The chosen signing manager is not an active user account.",
        )

    # Reviewers: active accounts, deduped, never the approver.
    seen: set[int] = set()
    reviewers: list[int] = []
    for uid in reviewer_user_ids:
        if uid == approver_id or uid in seen:
            continue
        u = db.get(User, uid)
        if u is None or u.status != "active":
            raise ValidationFailedError(
                "REVIEWER_NOT_ELIGIBLE", f"Reviewer {uid} is not an active user"
            )
        seen.add(uid)
        reviewers.append(uid)

    for step in version.approval_steps:
        retain_revision_access(db, version, step)
    version.approval_steps.clear()
    version.approval_steps.append(
        BookApprovalStep(
            book_id=book.id,
            step_order=0,
            stage_label="Approve",
            assignee_user_id=approver_id,
            kind="approver",
            state="pending",
        )
    )
    for i, rev_id in enumerate(reviewers, start=1):
        version.approval_steps.append(
            BookApprovalStep(
                book_id=book.id,
                step_order=i,
                stage_label="Review",
                assignee_user_id=rev_id,
                kind="reviewer",
                state="pending",
            )
        )
    book.priority = priority
    book.submitted_by_user_id = submitted_by_user_id
    capture_approval_context(
        db, book, version, submitted_by_user_id=submitted_by_user_id,
        submitted_at=datetime.now(UTC),
    )
    _recompute_approval_state(book)
    db.commit()
    db.refresh(book)
    return book


def _require_current_revision(
    db: Session, book: Book, version_id: int,
) -> BookVersion:
    current_id = db.scalar(
        select(BookVersion.id).where(BookVersion.book_id == book.id)
        .order_by(BookVersion.version_no.desc()).limit(1)
    )
    if current_id != version_id:
        raise AppError(
            "REVISION_CHANGED", "The record has a newer revision. Reopen the current task.",
            http_status=409,
        )
    version = next((version for version in book.versions if version.id == version_id), None)
    if version is None:
        raise AppError("REVISION_CHANGED", "Reopen the current revision.", http_status=409)
    return version


def _require_assignment_action(
    db: Session, book: Book, user_id: int, *, reviewer: bool = False,
) -> None:
    user = db.get(User, user_id)
    if user is None or user.status != "active":
        raise AppError("FORBIDDEN", "An active account is required.", http_status=403)
    if not reviewer and not perm_service.has_capability(db, user, "books.approve"):
        raise AppError("FORBIDDEN", "Signing capability is required.", http_status=403)
    states = ("pending", "approved", "returned", "rejected") if reviewer else ("pending",)
    if book.voided_at is not None or book.deleted_at is not None or book.approval_state not in states:
        raise ValidationFailedError(
            "NOT_A_REVIEWER" if reviewer else "NO_PENDING_STEP",
            "There is no actionable assignment on this revision.",
        )


def decide_step(
    db: Session,
    book_id: int,
    *,
    user_id: int,
    version_id: int,
    decision: str,
    note: str | None = None,
) -> Book:
    """Record ``decision`` on the current (lowest-order pending) step.

    Only that step's assignee may act. ``decision`` is one of
    ``"approved" | "rejected" | "returned"``. The aggregate
    ``book.approval_state`` is re-derived afterwards.
    """
    if decision == "approved":
        raise ValidationFailedError(
            "USE_SIGN_TO_APPROVE",
            "Approval is via sign_book, not decide_step",
        )
    book = _get_book_with_versions(db, book_id)
    _require_current_revision(db, book, version_id)
    _require_assignment_action(db, book, user_id)
    current = _current_pending_step(book)
    if current is None:
        raise ValidationFailedError("NO_PENDING_STEP", "Book has no step awaiting a decision")
    if current.assignee_user_id != user_id:
        raise ValidationFailedError("NOT_YOUR_STEP", "This step is assigned to another user")
    if decision not in _DECISIONS:
        raise ValidationFailedError("BAD_DECISION", f"{decision!r} is not a valid decision")
    if decision in ("returned", "rejected") and not (note and note.strip()):
        raise ValidationFailedError(
            "REASON_REQUIRED", "A nonblank reason is required to return or reject.",
        )
    current.state = decision
    current.note = note.strip() if note else None
    current.decided_at = datetime.now(UTC).replace(tzinfo=None)
    version = _current_version(book)
    assert version is not None
    retain_revision_access(db, version, current)
    _recompute_approval_state(book)
    db.commit()
    db.refresh(book)
    return book


# ─── Administrative state override ────────────────────────────────────────────
# Record states an override can force. `voided` is the one pseudo-state: it is
# stored as approval_state="none" + Book.voided_at, because "discarded draft" is
# a separate column but reads as a state on every records surface (chips, rows,
# the state pill). Keeping it in this list is what makes the control cover the
# whole of "what state is this record in".
VOIDED_STATE: Final[str] = "voided"
OVERRIDABLE_STATES: Final[tuple[str, ...]] = (
    "none",
    "pending",
    "awaiting_scan",
    "approved",
    "returned",
    "rejected",
    VOIDED_STATE,
)


def displayed_state(book: Book) -> str:
    """The state the records surfaces show for ``book`` — the override's unit of
    work. Voided wins over the approval state: a discarded draft reads "voided",
    never "draft"."""
    return VOIDED_STATE if book.voided_at is not None else book.approval_state


def _override_approver_id(db: Session, book: Book, actor: User) -> int:
    """Assignee for a chain an override has to build from nothing.

    The doc's linked signing manager (the resolution ``submit_for_approval``
    uses), else the acting admin — ``assignee_user_id`` is NOT NULL, and parking
    the step on whoever forced the state is both visible on the record and
    re-routable afterwards via Send for approval.
    """
    if book.doc_manager_id is not None:
        mgr = db.get(Manager, book.doc_manager_id)
        if mgr is not None and mgr.user_id is not None:
            candidate = db.get(User, mgr.user_id)
            if candidate is not None and candidate.status == "active":
                return candidate.id
    return actor.id


def _align_chain_to(
    db: Session,
    book: Book,
    version: BookVersion,
    target_state: str,
    *,
    actor: User,
    note: str | None,
    now: datetime,
) -> None:
    """Re-point the current version's approval chain at ``target_state``.

    The chain IS the audit trail, and readers derive from either it or the
    aggregate — so an override that moved only the aggregate would leave the
    record telling two different stories about who decided what.
    """
    for step in version.approval_steps:
        retain_revision_access(db, version, step)
    if target_state in ("none", "awaiting_scan", VOIDED_STATE):
        # Neither a draft nor a scan-path record carries an in-app chain.
        version.approval_steps.clear()
        return
    if target_state == "pending":
        steps = _approver_steps(version)
        if not steps:
            version.approval_steps.append(
                BookApprovalStep(
                    book_id=book.id,
                    step_order=0,
                    stage_label="Approve",
                    assignee_user_id=_override_approver_id(db, book, actor),
                    kind="approver",
                    state="pending",
                )
            )
            return
        for step in steps:
            step.state = "pending"
            step.note = None
            step.decided_at = None
        return
    if target_state == "approved":
        # Administrative approval — the steps stop contradicting the state; no
        # signature is fabricated (see override_state's docstring).
        for step in _approver_steps(version):
            if step.state != "approved":
                step.state = "approved"
                step.note = note
                step.decided_at = None  # Administrative state, not an assignee's decision.
        return
    # returned | rejected — settle the step that was in play (else the last one).
    ordered = sorted(_approver_steps(version), key=lambda s: s.step_order)
    settling = next((s for s in ordered if s.state == "pending"), ordered[-1] if ordered else None)
    if settling is not None:
        settling.state = target_state
        settling.note = note
        settling.decided_at = None  # Administrative state, not an assignee's decision.


def override_state(
    db: Session,
    book_id: int,
    *,
    target_state: str,
    actor: User,
    reason: str | None = None,
) -> Book:
    """Force a record to ``target_state``, bypassing the approval flow.

    The escape hatch for records the normal flow has stranded: the assigned
    signer left, a paper scan that will never arrive, a form approved on the
    wrong record, a draft discarded by mistake. Gated on
    ``books.override_state`` — admin-only by default.

    Both axes of "state" are covered — the six ``approval_state`` values plus
    the ``voided`` marker (``OVERRIDABLE_STATES``) — and the current version's
    chain is re-aligned to match (``_align_chain_to``).

    What it deliberately does NOT do:
      - fabricate a signature. Forcing ``approved`` settles the steps and names
        the acting admin in the audit row; it never embeds a signature image or
        writes ``signed_pdf_path``.
      - delete artifacts. Flipping away from ``approved`` leaves a filed signed
        PDF in place (it just stops being served, since serving keys on
        ``status == "approved"``); ``unfile_signed_copy`` is how you remove it.
      - notify, or re-file in the Correspondence Log. This is a repair tool,
        not a signing path.

    Writes a ``book_state_override`` AuditLog row with the before/after pair
    and the reason.
    """
    if target_state not in OVERRIDABLE_STATES:
        raise ValidationFailedError(
            "BAD_STATE",
            f"{target_state!r} is not a record state",
            allowed=list(OVERRIDABLE_STATES),
        )
    book = _get_book_with_versions(db, book_id)
    previous = displayed_state(book)
    if previous == target_state:
        raise ValidationFailedError(
            "STATE_UNCHANGED", "This record is already in that state", state=previous
        )
    note = (reason or "").strip() or None
    if target_state in ("returned", "rejected") and note is None:
        # Same contract as decide_step: a negative verdict carries its reason.
        raise ValidationFailedError(
            "REASON_REQUIRED",
            "A reason is required to force a record to returned or rejected",
        )
    now = datetime.now(UTC).replace(tzinfo=None)
    version = _current_version(book)
    stored_state = "none" if target_state == VOIDED_STATE else target_state
    if version is not None:
        _align_chain_to(db, book, version, target_state, actor=actor, note=note, now=now)
        version.status = stored_state
    book.approval_state = stored_state
    book.voided_at = now if target_state == VOIDED_STATE else None
    db.add(
        AuditLog(
            actor=actor.employee_id,
            action="book_state_override",
            entity_type="book",
            entity_id=str(book.id),
            payload=json.dumps(
                {
                    "ref_number": book.ref_number,
                    "from": previous,
                    "to": target_state,
                    "reason": note,
                    "actor_user_id": actor.id,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    db.refresh(book)
    return book


def _resolve_signer_signature(db: Session, signer: User) -> Path | None:
    """The signer's ONE signature: their uploaded approval signature, else the
    stored signature of their linked employee (G number) from the Submitter
    registry — people should not need a second signature just for approvals."""
    candidates: list[str] = []
    if signer.signature_path:
        candidates.append(signer.signature_path)
    if signer.employee_id:
        # .first(), not one_or_none: submitters.employee_id uniqueness is only
        # app-side — a legacy duplicate row must not 500 the whole sign/detail
        # path with MultipleResultsFound.
        sub = (
            db.execute(select(Submitter).where(Submitter.employee_id == signer.employee_id))
            .scalars()
            .first()
        )
        if sub is not None and sub.stored_sig_path:
            candidates.append(sub.stored_sig_path)
    for raw in candidates:
        p = Path(raw)
        if not p.is_absolute():
            p = get_settings().data_dir / p
        if p.is_file():
            return p
    return None


def sign_book(db: Session, book_id: int, *, user_id: int, version_id: int) -> Book:
    """Approve by signing: verify the caller is the pending signer, embed their
    signature into the current version's document, store the signed PDF, mark
    the book (and current version) approved.

    Mirrors ``decide_step``'s authorization + state machine, but instead of
    merely advancing the step it physically signs: ``render_signed_pdf``
    re-renders the version's document with the signer's signature injected.
    """
    from app.services import document_service, included_papers_service

    book = _get_book_with_versions(db, book_id)
    _require_current_revision(db, book, version_id)
    _require_assignment_action(db, book, user_id)
    current = _current_pending_step(book)
    if current is None:
        raise ValidationFailedError("NO_PENDING_STEP", "Book has no step awaiting a signature")
    if current.assignee_user_id != user_id:
        raise ValidationFailedError("NOT_YOUR_STEP", "This signature is assigned to another user")
    signer = db.get(User, user_id)
    if signer is None:
        raise ValidationFailedError("NO_SIGNATURE", "لا يوجد توقيع محفوظ لحسابك")
    abs_sig = _resolve_signer_signature(db, signer)
    if abs_sig is None:
        # Arabic — this message reaches the operator's toast verbatim
        # (apiErrorMessage shows the backend text; same convention as the
        # template-library errors in book_template_service).
        raise ValidationFailedError(
            "NO_SIGNATURE",
            "لا يوجد توقيع محفوظ — ارفع توقيعك من الإعدادات، أو خزّن توقيع "
            "الموظف (برقم G) في سجل مقدمي الطلبات.",
        )

    version = _current_version(book)
    if version is None:
        raise ValidationFailedError("NO_VERSION", "Book has no version to sign")
    # Anchor candidates for the word-authored path: a delegated approver may
    # have typed their OWN closing name in Word, not the doc manager's.
    signer_names: list[str] = [n for n in (signer.display_name,) if n]
    if signer.employee_id:
        emp = db.get(Employee, signer.employee_id)
        if emp is not None:
            signer_names += [n for n in (emp.name_ar, emp.name_en) if n]
    signed_rel = document_service.render_signed_pdf(
        db,
        version=version,
        signer_signature_path=str(abs_sig),
        signer_names=signer_names,
    )
    _require_current_revision(db, book, version_id)
    db.refresh(book, attribute_names=["approval_state", "voided_at", "deleted_at"])
    refreshed_step = db.scalar(
        select(BookApprovalStep).where(BookApprovalStep.id == current.id)
        .execution_options(populate_existing=True)
    )
    _require_assignment_action(db, book, user_id)
    if refreshed_step is None or refreshed_step.state != "pending":
        raise ValidationFailedError("NO_PENDING_STEP", "This assignment is already completed")
    current = refreshed_step
    if current.assignee_user_id != user_id:
        raise ValidationFailedError("NOT_YOUR_STEP", "This signature is assigned to another user")
    signed_primary = Path(signed_rel)
    if not signed_primary.is_absolute():
        signed_primary = get_settings().data_dir / signed_primary
    if signed_primary.suffix.lower() != ".pdf" and book.merged_attachment_paths:
        with contextlib.suppress(OSError):
            signed_primary.unlink()
        raise ValidationFailedError(
            "INCLUDED_PAPERS_SIGNED_PDF_REQUIRED",
            "The signed PDF could not be created; the record was not approved",
        )
    if signed_primary.suffix.lower() == ".pdf":
        signed_rel = included_papers_service.publish_signed_package(
            db,
            book,
            version,
            signed_primary,
            physical_scan=False,
        )
    version.signed_pdf_path = signed_rel
    version.signed_by_user_id = user_id
    version.signed_at = datetime.now(UTC).replace(tzinfo=None)
    current.state = "approved"
    current.decided_at = version.signed_at
    retain_revision_access(db, version, current)
    _recompute_approval_state(book)  # mirrors version.status + book.approval_state -> approved
    # ── Phase 3: re-file in the shared Correspondence Log on signing. ──
    try:
        from app.services import correspondence_service

        correspondence_service.log_event(
            db,
            trigger="book_signed",
            source_kind="generated_doc",
            source_book_id=book.id,
            subject=(book.subject or book.ref_number)[:255],
            employee_id=book.employee_id,
            submitter=(signer.employee_id if signer else None),
            entry_date=(version.signed_at.date() if version.signed_at else date.today()),
            condition_fields={"category": book.category_id},
            direction="outgoing",
        )
    except Exception:
        log.warning("correspondence auto-log failed on sign for book %s", book.id, exc_info=True)
    db.commit()
    db.refresh(book)
    return book


def is_document_signed_locked(db: Session, version: BookVersion) -> tuple[bool, str | None]:
    """Return ``(locked, canonical_pdf_rel)`` for a finalized version.

    Consumes an already-authorized ``BookVersion`` (the caller has already
    resolved and checked read access) rather than re-deriving it from a
    document id, so the lock decision can never drift onto a different
    revision than the one the caller was authorized to read.

    Normal signed versions use ``signed_pdf_path``. Approved imports are already
    finalized paper: their stamped ``Document.pdf_path`` is canonical even though
    no removable signed-copy row exists. Returns ``(False, None)`` otherwise.
    """
    if version.status != "approved":
        return False, None
    if version.signed_pdf_path:
        return True, version.signed_pdf_path
    if (
        isinstance(version.fields, dict)
        and version.fields.get("imported_approved") is True
        and version.document_id is not None
    ):
        document = db.get(Document, version.document_id)
        if document is not None and document.pdf_path:
            return True, document.pdf_path
    return False, None


def add_note(
    db: Session, book_id: int, *, user_id: int, version_id: int, note: str | None = None,
) -> Book:
    """Attach a note to the current pending step without changing its state.

    Only the current step's assignee may add a note.
    """
    if not note:
        raise ValidationFailedError("EMPTY_NOTE", "A note is required")
    book = _get_book_with_versions(db, book_id)
    _require_current_revision(db, book, version_id)
    _require_assignment_action(db, book, user_id)
    current = _current_pending_step(book)
    if current is None:
        raise ValidationFailedError("NO_PENDING_STEP", "Book has no step awaiting a decision")
    if current.assignee_user_id != user_id:
        raise ValidationFailedError("NOT_YOUR_STEP", "This step is assigned to another user")
    current.note = note
    db.commit()
    db.refresh(book)
    return book


_ANNOTATION_KINDS = ("pin", "highlight")
_GEOMETRY_KEYS = {"pin": ("x", "y"), "highlight": ("x", "y", "w", "h")}


def _validate_geometry(kind: str, geometry: dict[str, float]) -> None:
    keys = _GEOMETRY_KEYS[kind]
    for key in keys:
        val = geometry.get(key)
        if (
            not isinstance(val, (int, float))
            or isinstance(val, bool)
            or not (0.0 <= float(val) <= 1.0)
        ):
            raise ValidationFailedError(
                "BAD_GEOMETRY", f"geometry.{key} must be a number in [0, 1]"
            )


def _get_version_in_book(db: Session, book_id: int, version_id: int) -> BookVersion:
    book = _get_book_with_versions(db, book_id)  # 404 if missing/deleted
    version = db.get(BookVersion, version_id)
    if version is None or version.book_id != book.id:
        raise NotFoundError(
            "VERSION_NOT_FOUND", f"Version {version_id} not in book {book_id}", id=version_id
        )
    return version


def create_annotation(
    db: Session,
    book_id: int,
    version_id: int,
    *,
    author_user_id: int,
    page: int,
    kind: str,
    geometry: dict[str, float],
    comment: str | None,
) -> BookAnnotation:
    """Persist a pin/highlight markup against a version. Geometry is normalized 0-1."""
    version = _get_version_in_book(db, book_id, version_id)
    if version.status == "approved":
        raise ValidationFailedError(
            "VERSION_LOCKED",
            "Cannot modify annotations on a signed version",
            version_id=version.id,
        )
    if version.status == "awaiting_scan":
        raise ValidationFailedError(
            "AWAITING_SCAN",
            "Annotations are not available while the form awaits its signed copy",
            version_id=version.id,
        )
    if kind not in _ANNOTATION_KINDS:
        raise ValidationFailedError("BAD_KIND", f"{kind!r} is not a valid annotation kind")
    if page < 1:
        raise ValidationFailedError("BAD_PAGE", "page must be >= 1")
    _validate_geometry(kind, geometry)
    ann = BookAnnotation(
        version_id=version.id,
        page=page,
        kind=kind,
        geometry=geometry,
        comment=(comment.strip() if comment and comment.strip() else None),
        author_user_id=author_user_id,
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return ann


def list_annotations(db: Session, book_id: int, version_id: int) -> list[BookAnnotation]:
    version = _get_version_in_book(db, book_id, version_id)
    return list(
        db.execute(
            select(BookAnnotation)
            .where(BookAnnotation.version_id == version.id)
            .order_by(BookAnnotation.created_at)
        ).scalars()
    )


def delete_annotation(
    db: Session, book_id: int, version_id: int, annotation_id: int, *, user_id: int
) -> None:
    version = _get_version_in_book(db, book_id, version_id)
    if version.status == "approved":
        raise ValidationFailedError(
            "VERSION_LOCKED",
            "Cannot modify annotations on a signed version",
            version_id=version.id,
        )
    ann = db.get(BookAnnotation, annotation_id)
    if ann is None or ann.version_id != version.id:
        raise NotFoundError(
            "ANNOTATION_NOT_FOUND", f"Annotation {annotation_id} not found", id=annotation_id
        )
    if ann.author_user_id != user_id:
        raise ValidationFailedError("NOT_AUTHOR", "You can only delete your own annotations")
    db.delete(ann)
    db.commit()


def list_awaiting(db: Session, *, user_id: int) -> list[Book]:
    """Books with a current pending step (approver OR reviewer) assigned to
    ``user_id``. Deliberately NOT filtered to ``Book.approval_state ==
    "pending"``: a reviewer's pending step remains actionable — late advisory
    feedback — after the signer has already approved, returned, or rejected
    the same revision."""
    stmt = (
        select(Book)
        .options(selectinload(Book.versions).selectinload(BookVersion.approval_steps))
        .where(Book.deleted_at.is_(None))
        .order_by(Book.created_at.desc())
    )
    out: list[Book] = []
    for book in db.execute(stmt).scalars().all():
        if your_step_kind(book, user_id) is not None:
            out.append(book)
    return out


# Hours a record may sit at `awaiting_scan` before it starts nagging its owner.
# Normal turnaround is same-day, so 24h means "genuinely forgotten", not "in
# transit". Raise this if papers legitimately sit with a manager overnight.
SCANBACK_STALE_HOURS = 24


def list_awaiting_scan(
    db: Session,
    *,
    user_id: int | None,
    user: User | None = None,
    stale_hours: int = SCANBACK_STALE_HOURS,
) -> list[Book]:
    """Books stranded at ``awaiting_scan`` past the stale line, oldest first.

    ``user_id=None`` returns every user's rows (the Everyone scope); otherwise
    only books whose CURRENT version was created by ``user_id`` — that is the
    person holding the paper. ``submitted_by_user_id`` is NULL on this path and
    must not be used.

    The cutoff is LOCAL naive time on purpose: ``Book.created_at`` is stamped by
    ``document_service`` with ``datetime.now()``, unlike ``Document.created_at``.
    Comparing against ``datetime.now(UTC)`` reintroduces the +4h bug (f111177).
    """
    cutoff = datetime.now() - timedelta(hours=stale_hours)
    stmt = (
        select(Book)
        .options(selectinload(Book.versions))
        .where(Book.deleted_at.is_(None))
        .where(Book.approval_state == "awaiting_scan")
        .where(Book.created_at < cutoff)
        .order_by(Book.created_at)
    )
    if user is not None:
        visibility = user_visibility_clause(db, user)
        if visibility is not None:
            stmt = stmt.where(visibility)
    out: list[Book] = []
    for book in db.execute(stmt).scalars().all():
        if user_id is None:
            out.append(book)
            continue
        version = _current_version(book)
        if version is not None and version.created_by_user_id == user_id:
            out.append(book)
    return out


def your_step_kind(book: Book, user_id: int) -> str | None:
    """The caller's role on the current version's pending chain: 'approver',
    'reviewer', or None. Approver wins if (improbably) both match."""
    version = _current_version(book)
    if version is None:
        return None
    pending = [s for s in version.approval_steps if s.state == "pending"]
    if any((s.kind or "approver") == "approver" and s.assignee_user_id == user_id for s in pending):
        return "approver"
    if any(s.kind == "reviewer" and s.assignee_user_id == user_id for s in pending):
        return "reviewer"
    return None


# ---------------------------------------------------------------------------
# Approvals worklist (#31, revision-scoped) — GET /books/approval-log,
# GET /books/approval-summary, GET /books/approval-log/{book_id}/neighbors
# ---------------------------------------------------------------------------

_APPROVAL_VERDICTS: frozenset[str] = frozenset({"approved", "rejected", "returned"})
RECEIVED_KINDS: frozenset[str] = frozenset({"approver", "reviewer"})
RECEIVED_STATUSES: frozenset[str] = frozenset({"pending", "returned", "approved", "rejected", "all"})
REVIEW_ALLOWED_STATUSES: frozenset[str] = frozenset({"pending", "all"})


class _WorklistRow(NamedTuple):
    book: Book
    version: BookVersion
    access_scope: Literal["full", "assigned_revision"]
    status: str
    assignment_version_no: int


def _current_pending_step_of_kind(
    book: Book, user_id: int, kind: str,
) -> BookApprovalStep | None:
    version = _current_version(book)
    if version is None:
        return None
    for step in version.approval_steps:
        if step.kind == kind and step.assignee_user_id == user_id and step.state == "pending":
            return step
    return None


def _history_assignment_version_no(book: Book, user_id: int, kind: str) -> int | None:
    """Newest assigned version, then latest decision, then greatest source id —
    a stable tie-break so an old pending step never outranks completed history."""
    candidates: list[tuple[int, datetime, int]] = []
    for version in book.versions:
        for step in version.approval_steps:
            if (
                step.kind == kind
                and step.assignee_user_id == user_id
                and step.decided_at is not None
                and step.state != "pending"
            ):
                candidates.append((version.version_no, step.decided_at, step.id))
        for grant in version.revision_access:
            if grant.kind == kind and grant.user_id == user_id:
                candidates.append((version.version_no, grant.decided_at, grant.id))
    if not candidates:
        return None
    candidates.sort()
    return candidates[-1][0]


def _worklist_candidate_book_ids(db: Session, *, user_id: int, kind: str) -> set[int]:
    current_version_no = (
        select(func.max(BookVersion.version_no))
        .where(BookVersion.book_id == Book.id)
        .correlate(Book)
        .scalar_subquery()
    )
    pending = set(
        db.scalars(
            select(Book.id)
            .join(BookVersion, BookVersion.book_id == Book.id)
            .join(BookApprovalStep, BookApprovalStep.version_id == BookVersion.id)
            .where(
                Book.deleted_at.is_(None),
                BookVersion.version_no == current_version_no,
                BookApprovalStep.assignee_user_id == user_id,
                BookApprovalStep.kind == kind,
                BookApprovalStep.state == "pending",
            )
        )
    )
    history_steps = set(
        db.scalars(
            select(BookApprovalStep.book_id)
            .join(Book, Book.id == BookApprovalStep.book_id)
            .where(
                Book.deleted_at.is_(None),
                BookApprovalStep.assignee_user_id == user_id,
                BookApprovalStep.kind == kind,
                BookApprovalStep.state != "pending",
                BookApprovalStep.decided_at.is_not(None),
            )
        )
    )
    history_grants = set(
        db.scalars(
            select(BookVersion.book_id)
            .join(BookRevisionAccess, BookRevisionAccess.version_id == BookVersion.id)
            .join(Book, Book.id == BookVersion.book_id)
            .where(
                Book.deleted_at.is_(None),
                BookRevisionAccess.user_id == user_id,
                BookRevisionAccess.kind == kind,
            )
        )
    )
    return pending | history_steps | history_grants


def _approval_worklist(db: Session, user: User, *, kind: str, status: str) -> list[_WorklistRow]:
    """Every book the caller has a current or retained ``kind`` relationship
    with, matching ``status``. Unsorted, unpaged — callers slice pages or
    derive counts/positions from the same set."""
    if kind not in RECEIVED_KINDS:
        raise ValidationFailedError("BAD_KIND", f"{kind!r} is not a valid received kind")
    if status not in RECEIVED_STATUSES:
        raise ValidationFailedError("BAD_STATUS", f"{status!r} is not a valid status")
    if kind == "reviewer" and status not in REVIEW_ALLOWED_STATUSES:
        raise ValidationFailedError("BAD_STATUS", "Review status must be 'pending' or 'all'")
    can_sign = kind == "approver" and perm_service.has_capability(db, user, "books.approve")
    book_ids = _worklist_candidate_book_ids(db, user_id=user.id, kind=kind)
    if not book_ids:
        return []
    stmt = (
        select(Book)
        .options(
            selectinload(Book.category),
            selectinload(Book.versions).selectinload(BookVersion.approval_steps),
            selectinload(Book.versions).selectinload(BookVersion.revision_access),
        )
        .where(Book.id.in_(book_ids))
    )
    out: list[_WorklistRow] = []
    for book in db.execute(stmt).scalars().all():
        pending_step = _current_pending_step_of_kind(book, user.id, kind)
        if pending_step is not None and kind == "approver" and not can_sign:
            pending_step = None
        history_version_no = _history_assignment_version_no(book, user.id, kind)
        if pending_step is None and history_version_no is None:
            continue  # the capability gate above removed the caller's only claim
        try:
            access = resolve_book_read_access(db, user, book)
        except AppError:
            # A revoked retained grant (or any other lost-access case) still
            # leaves historical assignment provenance behind; that provenance
            # is not itself visibility. Skip the row rather than let one
            # inaccessible book fail the caller's whole worklist/summary.
            continue
        selected_version = next(v for v in book.versions if v.id == access.selected_version_id)
        if pending_step is not None:
            row_status = "pending"
            assignment_version_no = selected_version.version_no
        else:
            assert history_version_no is not None
            assignment_version_no = history_version_no
            row_status = book.approval_state if access.full_access else selected_version.status
        if status != "all" and row_status != status:
            continue
        out.append(
            _WorklistRow(
                book=book,
                version=selected_version,
                access_scope="full" if access.full_access else "assigned_revision",
                status=row_status,
                assignment_version_no=assignment_version_no,
            )
        )
    return out


def _worklist_submitted_at(row: _WorklistRow) -> datetime | None:
    context = (
        row.version.approval_context if isinstance(row.version.approval_context, dict) else {}
    )
    value = context.get("submitted_at")
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    steps = [s.created_at for s in row.version.approval_steps if s.created_at is not None]
    return min(steps).replace(tzinfo=UTC) if steps else None


def _sort_worklist(rows: list[_WorklistRow], *, sort: str) -> list[_WorklistRow]:
    """Normalized submission time, nulls last in both directions, then stable
    Book ID ascending."""
    timed = [(row, _worklist_submitted_at(row)) for row in rows]
    with_ts = sorted(
        (pair for pair in timed if pair[1] is not None),
        key=lambda pair: (pair[1], pair[0].book.id),
        reverse=(sort == "newest"),
    )
    without_ts = sorted(
        (pair for pair in timed if pair[1] is None), key=lambda pair: pair[0].book.id
    )
    return [row for row, _ in (with_ts + without_ts)]


def _worklist_subject(book: Book, version: BookVersion) -> str | None:
    """The selected revision's own subject — never a different revision's,
    even for a full-access reader looking at history."""
    context = version.approval_context if isinstance(version.approval_context, dict) else {}
    value = context.get("subject")
    if isinstance(value, str):
        return value
    fields = version.fields
    if isinstance(fields, dict):
        value = fields.get("subject")
        if isinstance(value, str) and value.strip():
            return value.strip()
    current = _current_version(book)
    return book.subject if current is not None and current.id == version.id else None


def _worklist_doc_manager(
    db: Session, book: Book, version: BookVersion, *, full: bool, names_by_id: dict[int, str],
) -> tuple[int | None, str | None]:
    context = version.approval_context if isinstance(version.approval_context, dict) else {}
    raw_id = context.get("doc_manager_user_id")
    manager_id = raw_id if isinstance(raw_id, int) and not isinstance(raw_id, bool) else None
    manager_name = context.get("doc_manager_name")
    manager_name = manager_name if isinstance(manager_name, str) else None
    if manager_id is None and full and book.doc_manager_id is not None:
        mgr = db.get(Manager, book.doc_manager_id)
        if mgr is not None and mgr.user_id is not None:
            manager_id = mgr.user_id
            manager_name = names_by_id.get(mgr.user_id)
    return manager_id, manager_name


def _build_worklist_item(
    db: Session, row: _WorklistRow, *, names_by_id: dict[int, str],
) -> ApprovalLogItem:
    book, version, full = row.book, row.version, row.access_scope == "full"
    approver_steps = [s for s in version.approval_steps if (s.kind or "approver") == "approver"]
    signer_step = next((s for s in approver_steps if s.state == "pending"), None) or (
        approver_steps[-1] if approver_steps else None
    )
    context = version.approval_context if isinstance(version.approval_context, dict) else {}
    raw_priority = context.get("priority")
    priority = raw_priority if isinstance(raw_priority, str) else (book.priority if full else None)
    doc_manager_user_id, doc_manager_name = _worklist_doc_manager(
        db, book, version, full=full, names_by_id=names_by_id
    )
    raw_submitted_by_name = context.get("submitted_by_name")
    submitted_by_name = (
        raw_submitted_by_name
        if isinstance(raw_submitted_by_name, str)
        else (names_by_id.get(book.submitted_by_user_id or 0) if full else None)
    )
    raw_category_ar = context.get("category_name_ar")
    raw_category_en = context.get("category_name_en")
    category_name_ar = (
        raw_category_ar if isinstance(raw_category_ar, str)
        else (book.category.name_ar if full and book.category is not None else None)
    )
    category_name_en = (
        raw_category_en if isinstance(raw_category_en, str)
        else (book.category.name_en if full and book.category is not None else None)
    )
    verdict = row.status if row.status in _APPROVAL_VERDICTS else None
    decided_stamps = [s.decided_at for s in approver_steps if s.decided_at is not None]
    return ApprovalLogItem(
        book_id=book.id,
        ref_number=book.ref_number,
        subject=_worklist_subject(book, version),
        category_name_ar=category_name_ar,
        category_name_en=category_name_en,
        status=row.status,
        record_status=version.status,
        priority=priority,
        submitted_by_user_id=book.submitted_by_user_id if full else None,
        submitted_by_name=submitted_by_name,
        doc_manager_user_id=doc_manager_user_id,
        doc_manager_name=doc_manager_name,
        approver_name=names_by_id.get(signer_step.assignee_user_id) if signer_step else None,
        reviewer_names=[
            names_by_id.get(s.assignee_user_id, "")
            for s in version.approval_steps
            if s.kind == "reviewer"
        ],
        submitted_at=_worklist_submitted_at(row),
        decided_at=(
            max(decided_stamps).replace(tzinfo=UTC) if verdict and decided_stamps else None
        ),
        verdict=verdict,
        document_id=version.document_id,
        version_id=version.id,
        version_no=version.version_no,
        assignment_version_no=row.assignment_version_no,
        assigned_signer_user_id=signer_step.assignee_user_id if signer_step else None,
        access_scope=row.access_scope,
    )


def _worklist_names(db: Session, rows: list[_WorklistRow]) -> dict[int, str]:
    user_ids: set[int] = set()
    for row in rows:
        if row.access_scope == "full" and row.book.submitted_by_user_id is not None:
            user_ids.add(row.book.submitted_by_user_id)
        user_ids.update(s.assignee_user_id for s in row.version.approval_steps)
        context = (
            row.version.approval_context if isinstance(row.version.approval_context, dict) else {}
        )
        raw = context.get("submitted_by_user_id")
        if isinstance(raw, int) and not isinstance(raw, bool):
            user_ids.add(raw)
    return resolve_names_by_ids(db, user_ids)


def approval_log_sent(
    db: Session,
    *,
    user_id: int,
    user: User | None = None,
    limit: int,
    offset: int,
    status: str = "all",
    sort: str = "oldest",
) -> tuple[list[ApprovalLogItem], int]:
    """Books the caller submitted for approval — their outbox. Current
    pending submissions unless ``status`` narrows to one aggregate state."""
    count_stmt = (
        select(func.count())
        .select_from(Book)
        .where(Book.deleted_at.is_(None), Book.submitted_by_user_id == user_id)
    )
    visibility = user_visibility_clause(db, user) if user is not None else None
    if visibility is not None:
        count_stmt = count_stmt.where(visibility)
    if status != "all":
        count_stmt = count_stmt.where(Book.approval_state == status)
    total = db.execute(count_stmt).scalar_one()
    stmt = (
        select(Book)
        .options(
            selectinload(Book.category),
            selectinload(Book.versions).selectinload(BookVersion.approval_steps),
        )
        .where(Book.deleted_at.is_(None), Book.submitted_by_user_id == user_id)
    )
    if visibility is not None:
        stmt = stmt.where(visibility)
    if status != "all":
        stmt = stmt.where(Book.approval_state == status)
    rows = list(db.execute(stmt).scalars().all())
    worklist_rows = [
        _WorklistRow(
            book=book,
            version=current,
            access_scope="full",
            status=book.approval_state,
            assignment_version_no=current.version_no,
        )
        for book in rows
        if (current := _current_version(book)) is not None
    ]
    ordered = _sort_worklist(worklist_rows, sort=sort)[offset : offset + limit]
    names_by_id = _worklist_names(db, ordered)
    items = [_build_worklist_item(db, row, names_by_id=names_by_id) for row in ordered]
    return items, total


def approval_log_received(
    db: Session,
    *,
    user: User,
    kind: str = "approver",
    status: str = "pending",
    sort: str = "oldest",
    limit: int,
    offset: int,
) -> tuple[list[ApprovalLogItem], int]:
    """The caller's received worklist for one responsibility — a current
    pending assignment or retained history, one row per Book, no cutoff."""
    rows = _sort_worklist(_approval_worklist(db, user, kind=kind, status=status), sort=sort)
    page = rows[offset : offset + limit]
    names_by_id = _worklist_names(db, page)
    items = [_build_worklist_item(db, row, names_by_id=names_by_id) for row in page]
    return items, len(rows)


def approval_log_neighbors(
    db: Session,
    *,
    user: User,
    scope: str,
    kind: str,
    status: str,
    sort: str,
    book_id: int,
    version_id: int | None,
) -> tuple[int | None, int, ApprovalLogItem | None, ApprovalLogItem | None]:
    """``(position, total, previous, next)`` in the same filtered/ordered
    worklist the log page uses — no full client download."""

    rows = (
        _sort_worklist(_approval_worklist(db, user, kind=kind, status=status), sort=sort)
        if scope == "received"
        else None
    )
    if rows is None:
        # scope == "sent": rebuild the same ordered book-scoped rows directly.
        stmt = (
            select(Book)
            .options(
                selectinload(Book.category),
                selectinload(Book.versions).selectinload(BookVersion.approval_steps),
            )
            .where(Book.deleted_at.is_(None), Book.submitted_by_user_id == user.id)
        )
        visibility = user_visibility_clause(db, user)
        if visibility is not None:
            stmt = stmt.where(visibility)
        if status != "all":
            stmt = stmt.where(Book.approval_state == status)
        rows = _sort_worklist(
            [
                _WorklistRow(
                    book=book, version=current, access_scope="full",
                    status=book.approval_state, assignment_version_no=current.version_no,
                )
                for book in db.execute(stmt).scalars().all()
                if (current := _current_version(book)) is not None
            ],
            sort=sort,
        )
    index = next(
        (
            i
            for i, row in enumerate(rows)
            if row.book.id == book_id and (version_id is None or row.version.id == version_id)
        ),
        None,
    )
    if index is None:
        return None, len(rows), None, None
    window = [i for i in (index - 1, index + 1) if 0 <= i < len(rows)]
    names_by_id = _worklist_names(db, [rows[i] for i in window])
    previous = (
        _build_worklist_item(db, rows[index - 1], names_by_id=names_by_id) if index > 0 else None
    )
    following = (
        _build_worklist_item(db, rows[index + 1], names_by_id=names_by_id)
        if index + 1 < len(rows)
        else None
    )
    return index + 1, len(rows), previous, following


def approval_summary(db: Session, user: User) -> ApprovalSummaryResponse:
    """Counts + oldest row for the generic Approvals landing rule, over the
    caller's FULL authorized set (not one page)."""
    can_sign = perm_service.has_capability(db, user, "books.approve")
    signature_rows = _approval_worklist(db, user, kind="approver", status="pending")
    review_rows = _approval_worklist(db, user, kind="reviewer", status="pending")
    approver_history = _approval_worklist(db, user, kind="approver", status="all")
    reviewer_history = _approval_worklist(db, user, kind="reviewer", status="all")
    can_view_sent = perm_service.has_capability(db, user, "books.view")
    sent_items, sent_total = (
        approval_log_sent(db, user_id=user.id, user=user, limit=1, offset=0, status="pending")
        if can_view_sent
        else ([], 0)
    )
    # Signer-returned submissions only: records this caller SENT that a
    # signer returned for changes — not their own received-approver history.
    _, returned_total = (
        approval_log_sent(db, user_id=user.id, user=user, limit=0, offset=0, status="returned")
        if can_view_sent
        else ([], 0)
    )

    def _oldest(rows: list[_WorklistRow]) -> ApprovalLogItem | None:
        if not rows:
            return None
        newest_first = _sort_worklist(rows, sort="oldest")[:1]
        return _build_worklist_item(
            db, newest_first[0], names_by_id=_worklist_names(db, newest_first)
        )

    available_kinds: list[Literal["approver", "reviewer"]] = []
    if can_sign or approver_history:
        available_kinds.append("approver")
    if review_rows or reviewer_history:
        available_kinds.append("reviewer")
    actionable_books = {row.book.id for row in signature_rows} | {
        row.book.id for row in review_rows
    }
    return ApprovalSummaryResponse(
        can_view_sent=can_view_sent,
        available_received_kinds=available_kinds,
        signature=ApprovalSummaryBucket(count=len(signature_rows), oldest=_oldest(signature_rows)),
        review=ApprovalSummaryBucket(count=len(review_rows), oldest=_oldest(review_rows)),
        sent=ApprovalSummaryBucket(count=sent_total, oldest=sent_items[0] if sent_items else None),
        returned_count=returned_total,
        actionable_count=len(actionable_books),
    )


def _resolve_user_name(db: Session, user: User) -> str:
    """Display name precedence: linked employee's English name → display_name → email."""
    employee = db.get(Employee, user.employee_id) if user.employee_id else None
    if employee is not None:
        return employee.name_en
    if user.display_name:
        return user.display_name
    return user.email


def resolve_names_by_ids(db: Session, user_ids: set[int]) -> dict[int, str]:
    """Batch version of :func:`_resolve_user_name` for a set of user ids — one
    query for the users and one for their linked employees, instead of two
    ``db.get`` per user. Same name precedence. Use when resolving submitter /
    reviewer names across a list (avoids the N+1 the audit flagged)."""
    if not user_ids:
        return {}
    users = db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
    emp_ids = {u.employee_id for u in users if u.employee_id}
    emps: dict[str, Employee] = {}
    if emp_ids:
        emps = {
            e.id: e for e in db.execute(select(Employee).where(Employee.id.in_(emp_ids))).scalars()
        }
    out: dict[int, str] = {}
    for u in users:
        emp = emps.get(u.employee_id) if u.employee_id else None
        out[u.id] = emp.name_en if emp is not None else (u.display_name or u.email)
    return out


def submitter_name(db: Session, book: Book) -> str | None:
    """Resolve the display name of the user who submitted ``book`` for approval."""
    if book.submitted_by_user_id is None:
        return None
    user = db.get(User, book.submitted_by_user_id)
    return _resolve_user_name(db, user) if user is not None else None


def submitter_g_number(db: Session, book: Book) -> str | None:
    """Return the G-number (employee_id) of the user who submitted ``book``."""
    if book.submitted_by_user_id is None:
        return None
    u = db.get(User, book.submitted_by_user_id)
    return u.employee_id if (u and u.employee_id) else None


def resolve_user_name_by_id(db: Session, user_id: int) -> str | None:
    """Resolve display name for any user id — used when building version payloads."""
    user = db.get(User, user_id)
    return _resolve_user_name(db, user) if user is not None else None


def list_approver_candidates(db: Session) -> list[ApproverOptionRead]:
    """Return active users who hold the ``books.approve`` capability.

    Admins always qualify (they hold all capabilities). For other roles,
    capability is resolved via perm_service (role defaults + per-user overrides).
    Locked / disabled / pending users are excluded.

    Display name: linked employee's English name, then user.display_name, then email.
    Lives in book_service because it returns a book-domain schema type and is the
    natural companion to submit_for_approval; name-resolution mirrors auth_service.admin_read.
    """
    users = (
        db.execute(select(User).where(User.status == "active").order_by(User.id)).scalars().all()
    )

    out: list[ApproverOptionRead] = []
    for user in users:
        if not perm_service.has_capability(db, user, "books.approve"):
            continue
        # Lenient by design: a signature-less approver is still eligible to be
        # picked here — the signature is enforced later, at sign-time, and the
        # submit dialog shows a "no signature on file" warning. Filtering them
        # out here empties the picker and hides the Submit button entirely when
        # no approver happens to have a signature yet.
        out.append(
            ApproverOptionRead(
                id=user.id,
                name=_resolve_user_name(db, user),
                is_default=user.is_default_manager,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Reviewer actions (Task 5)
# ---------------------------------------------------------------------------

_REVIEW_DECISIONS: frozenset[str] = frozenset({"reviewed", "changes_requested"})


def _my_pending_reviewer_step(book: Book, user_id: int) -> BookApprovalStep | None:
    version = _current_version(book)
    if version is None:
        return None
    for s in version.approval_steps:
        if s.kind == "reviewer" and s.assignee_user_id == user_id and s.state == "pending":
            return s
    return None


def record_review(
    db: Session, book_id: int, *, user_id: int, version_id: int,
    decision: str, note: str | None = None,
) -> Book:
    """Record an advisory reviewer verdict. Never recomputes approval_state."""
    if decision not in _REVIEW_DECISIONS:
        raise ValidationFailedError("BAD_DECISION", f"{decision!r} is not a valid review decision")
    book = _get_book_with_versions(db, book_id)
    _require_current_revision(db, book, version_id)
    _require_assignment_action(db, book, user_id, reviewer=True)
    step = _my_pending_reviewer_step(book, user_id)
    if step is None:
        raise ValidationFailedError("NOT_A_REVIEWER", "You have no pending review on this record")
    if decision == "changes_requested" and not (note and note.strip()):
        raise ValidationFailedError("REASON_REQUIRED", "A note is required to request changes")
    step.state = decision
    step.note = note.strip() if note and note.strip() else None
    step.decided_at = datetime.now(UTC).replace(tzinfo=None)
    version = _current_version(book)
    assert version is not None
    retain_revision_access(db, version, step)
    db.commit()
    db.refresh(book)
    return book


def mark_seen(db: Session, book_id: int, *, user_id: int) -> bool:
    """Stamp seen_at on the caller's step (either kind) the first time they open
    the record. Idempotent; no-op (False) if the caller has no step."""
    book = _get_book_with_versions(db, book_id)
    version = _current_version(book)
    if version is None:
        return False
    for s in version.approval_steps:
        if s.assignee_user_id == user_id and s.seen_at is None:
            s.seen_at = datetime.now(UTC).replace(tzinfo=None)
            db.commit()
            return True
    return False


def add_reviewers(db: Session, book_id: int, *, user_ids: Sequence[int]) -> Book:
    """Append advisory reviewer steps to the current pending version. Skips the
    approver and existing reviewers; requires the book to be pending."""
    book = _get_book_with_versions(db, book_id)
    if book.approval_state != "pending":
        raise ValidationFailedError(
            "NOT_PENDING", "Reviewers can only be added to a pending record"
        )
    version = _current_version(book)
    assert version is not None
    if version.approval_context is None:
        timestamps = [step.created_at for step in version.approval_steps if step.created_at]
        version.approval_context = _approval_context(
            db, book, version, submitted_by_user_id=book.submitted_by_user_id,
            submitted_at=min(timestamps) if timestamps else None,
        )
    existing = {s.assignee_user_id for s in version.approval_steps}
    next_order = max((s.step_order for s in version.approval_steps), default=-1) + 1
    for uid in user_ids:
        if uid in existing:
            continue
        u = db.get(User, uid)
        if u is None or u.status != "active":
            raise ValidationFailedError(
                "REVIEWER_NOT_ELIGIBLE", f"Reviewer {uid} is not an active user"
            )
        version.approval_steps.append(
            BookApprovalStep(
                book_id=book.id,
                step_order=next_order,
                stage_label="Review",
                assignee_user_id=uid,
                kind="reviewer",
                state="pending",
            )
        )
        existing.add(uid)
        next_order += 1
    db.commit()
    db.refresh(book)
    return book


def remove_reviewer(db: Session, book_id: int, *, user_id: int) -> Book:
    """Drop a pending reviewer step (no-op if absent). Never touches the approver."""
    book = _get_book_with_versions(db, book_id)
    version = _current_version(book)
    if version is not None:
        for s in list(version.approval_steps):
            if s.kind == "reviewer" and s.assignee_user_id == user_id and s.state == "pending":
                version.approval_steps.remove(s)
        db.commit()
        db.refresh(book)
    return book


def list_reviewer_candidates(db: Session) -> list[ApproverOptionRead]:
    """Active accounts pickable as reviewers (any active user; no signature needed)."""
    users = (
        db.execute(select(User).where(User.status == "active").order_by(User.id)).scalars().all()
    )
    return [
        ApproverOptionRead(id=u.id, name=_resolve_user_name(db, u), is_default=False) for u in users
    ]


def resolve_doc_manager_user(db: Session, book: Book) -> tuple[int | None, str | None, bool]:
    """(user_id, display_name, has_signature) of the account linked to the doc's
    manager. has_signature drives the submit dialog's 'add a signature' warning."""
    if book.doc_manager_id is None:
        return None, None, False
    mgr = db.get(Manager, book.doc_manager_id)
    if mgr is None or mgr.user_id is None:
        return None, None, False
    user = db.get(User, mgr.user_id)
    # Same resolution as sign-time (_resolve_signer_signature): the uploaded
    # approval signature OR the linked employee's stored Submitter signature —
    # else the dialog warns about a signature the signer actually has.
    has_sig = user is not None and _resolve_signer_signature(db, user) is not None
    return mgr.user_id, resolve_user_name_by_id(db, mgr.user_id), has_sig


def build_step_read(db: Session, step: BookApprovalStep) -> BookApprovalStepRead:
    """Serialize a step with the assignee's resolved display name."""
    item = BookApprovalStepRead.model_validate(step)
    item.assignee_name = resolve_user_name_by_id(db, step.assignee_user_id)
    return item


# ---------------------------------------------------------------------------
# Attachment helpers (mirrors ledger_service)
# ---------------------------------------------------------------------------


def _safe_filename(raw: str) -> str:
    """Strip directory components and forbidden chars."""
    candidate = raw.replace("\\", "/").rsplit("/", 1)[-1]
    candidate = Path(candidate).name
    cleaned = _UNSAFE_CHARS.sub("_", candidate).strip(". ")
    if not cleaned:
        raise ValidationFailedError("BOOK_BAD_FILENAME", "Filename is empty or invalid", raw=raw)
    return cleaned


def _book_attachment_dir(book_id: int) -> Path:
    """Absolute path to the attachment folder for one book."""
    return get_settings().data_dir / "book_attachments" / str(book_id)


def resolve_attachment_path(relative_path: str) -> Path | None:
    """Resolve a stored attachment path (relative to ``data_dir``) to an
    absolute path on disk, with a containment check. Returns ``None`` when
    the resolved path is missing or escapes the data dir."""
    data_dir = get_settings().data_dir.resolve()
    candidate = (data_dir / relative_path).resolve()
    if data_dir not in candidate.parents and candidate != data_dir:
        return None
    if not candidate.is_file():
        return None
    return candidate


# ---------------------------------------------------------------------------
# Imported-record document resolution
#
# v3-imported books store the file's OLD absolute location in ``doc_path``
# (e.g. ``Y:\...\employee_files\G3289\leaves\LeaveApp_...docx`` or a UNC /
# per-user AppData path) and carry no generated Document/BookVersion. The
# importer already copied the file into the employee's vault, so we locate it
# there by (G-number + filename stem) and serve it in place — no DB rewrite,
# no second copy. A .pdf rendition (if present) is preferred for inline view.
# ---------------------------------------------------------------------------


@lru_cache(maxsize=4096)
def _resolve_imported_paths(
    doc_path: str, employee_id: str | None
) -> tuple[str | None, str, str] | None:
    """Find the local vault file for an imported record.

    Returns ``(pdf_rel, original_rel, filename)`` where ``*_rel`` are
    ``data_dir``-relative POSIX paths (``pdf_rel`` is ``None`` when no PDF
    rendition exists) and ``filename`` is the original file's name. Returns
    ``None`` when nothing matches in the employee's vault.

    Memoised: ``doc_path``/``employee_id`` are stable per book, so the first
    request warms the cache and later ones skip the filesystem walk.
    """
    if not employee_id:
        return None
    settings = get_settings()
    base = settings.vault_dir / employee_id
    if not base.is_dir():
        return None
    stem = PurePath(doc_path.replace("\\", "/")).stem
    matches = [p for p in base.rglob("*") if p.is_file() and p.stem == stem]
    if not matches:
        return None
    data_dir = settings.data_dir.resolve()

    def rel(p: Path) -> str:
        return p.resolve().relative_to(data_dir).as_posix()

    pdf = next((p for p in matches if p.suffix.lower() == ".pdf"), None)
    original = pdf or matches[0]
    return (rel(pdf) if pdf is not None else None, rel(original), original.name)


def imported_document_of(book: Book) -> ImportedDocRead | None:
    """Build the ``ImportedDocRead`` payload for a book, or ``None``.

    Only applies to imported records: a book with a stale ``doc_path`` and no
    current-version generated document. Books with a real generated Document
    are served by the normal ``/documents/{id}/download`` path and return
    ``None`` here so the client doesn't show a duplicate paper.
    """
    if not book.doc_path:
        return None
    current = book.versions[-1] if book.versions else None
    if current is not None and current.document_id is not None:
        return None
    resolved = _resolve_imported_paths(book.doc_path, book.employee_id)
    if resolved is None:
        return None
    pdf_rel, _original_rel, filename = resolved
    fmt = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    base = f"/api/v1/books/{book.id}/imported-document"
    return ImportedDocRead(
        pdf_url=(f"{base}?format=pdf" if pdf_rel is not None else None),
        download_url=f"{base}?format=original",
        filename=filename,
        format=fmt,
    )


def resolve_imported_file(book: Book, *, prefer: str) -> Path | None:
    """Resolve an imported record to the absolute vault file to serve.

    ``prefer='pdf'`` returns the PDF rendition (``None`` if absent);
    ``prefer='original'`` returns the best available file in its stored format.
    Reuses ``resolve_attachment_path`` for the containment + existence guard.
    """
    if not book.doc_path:
        return None
    resolved = _resolve_imported_paths(book.doc_path, book.employee_id)
    if resolved is None:
        return None
    pdf_rel, original_rel, _filename = resolved
    rel = pdf_rel if prefer == "pdf" else original_rel
    if rel is None:
        return None
    return resolve_attachment_path(rel)


def _image_to_pdf_bytes(data: bytes, ext: str) -> bytes:
    """Convert an uploaded image scan to a one-page PDF byte stream.

    The scan-back flip stores the upload as ``signed_pdf_path``, and every
    consumer of that column (the locked-document download, the film-strip
    signed frame) assumes a renderable PDF — a raw JPEG/PNG there would
    download as a corrupt renamed ``.pdf`` and fail pdf.js. Raises 422 when
    the bytes are not a readable image.
    """
    import fitz  # PyMuPDF — heavyweight; only the scan-back flip pays for it

    try:
        with fitz.open(stream=data, filetype=ext.lstrip(".")) as img:
            pdf_bytes: bytes = img.convert_to_pdf()
    except Exception as exc:
        raise ValidationFailedError(
            "BOOK_SCAN_CONVERT_FAILED",
            "Could not read the scanned image; upload a valid PDF, PNG or JPEG scan",
        ) from exc
    return pdf_bytes


def _unique_attachment_dest(target_dir: Path, name: str) -> Path:
    """First non-existing path for ``name`` (``name``, ``stem-2.ext``, ``stem-3.ext``…).

    An upload must never silently overwrite an earlier file's bytes: stored
    ``attachment_paths`` / ``signed_pdf_path`` entries keep pointing at the old
    name, so an overwrite would swap a filed paper's content — including the
    locked signed artifact — with no state change.
    """
    dest = target_dir / name
    if not dest.exists():
        return dest
    stem = Path(name).stem
    suffix = Path(name).suffix
    counter = 2
    while True:
        candidate = target_dir / f"{stem}-{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def add_attachment(
    db: Session,
    book_id: int,
    filename: str,
    data: bytes,
    *,
    user: User | None = None,
    as_signed: bool = False,
) -> Book:
    """Save ``data`` under ``data/book_attachments/<book_id>/`` and update the row.

    Scan-back flip (spec 2026-06-11 §4): when the book is a ``scan``-path form
    sitting in ``awaiting_scan``, the uploaded file IS the signed copy — it is
    written to the current version's ``signed_pdf_path`` (not appended to
    ``attachment_paths``), stamped with the uploading ``user``, and the book
    flips to ``approved``. The flipped artifact is always stored as a real PDF
    (image scans are converted) under a version-scoped name
    (``signed-v<n>.pdf``). Every other upload appends normally; filename
    collisions are de-duped so no upload overwrites an earlier file's bytes.
    """
    book = get_book(db, book_id)

    if len(data) == 0:
        raise ValidationFailedError("BOOK_EMPTY_FILE", "Uploaded file is empty")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ValidationFailedError(
            "BOOK_FILE_TOO_LARGE",
            f"File exceeds {MAX_ATTACHMENT_BYTES} bytes",
            max_bytes=MAX_ATTACHMENT_BYTES,
            size=len(data),
        )

    safe_name = _safe_filename(filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise ValidationFailedError(
            "BOOK_BAD_EXTENSION",
            f"File type {ext!r} is not allowed",
            allowed=sorted(ALLOWED_DOC_EXTS),
        )

    # Decide the branch BEFORE writing: the flip changes the file's on-disk name
    # and (for image scans) its format.
    version = _current_version(book)
    # awaiting_scan flips on ANY attach (the scan IS the signature for scan-path
    # forms). Draft (none) / Pending get the flip only on an explicit as_signed —
    # the user answered "yes, this is the signed copy" in the UI.
    flip_version = (
        version
        if version is not None
        and (
            book.approval_state == "awaiting_scan"
            or (as_signed and book.approval_state in ("none", "pending"))
        )
        else None
    )
    if flip_version is not None:
        # Recording a physically-signed paper. Authority is the route gate
        # (books.edit) — unified across all flip states; the real signature is
        # on the paper, the app user is recording it.
        if ext != ".pdf":
            data = _image_to_pdf_bytes(data, ext)
        # Deterministic version-scoped name; the collision de-dup below means no
        # later upload can overwrite the signed artifact's bytes.
        safe_name = f"signed-v{flip_version.version_no}.pdf"

    target_dir = _book_attachment_dir(book_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = _unique_attachment_dest(target_dir, safe_name)

    # Containment check: dest must be under data_dir.
    data_dir = get_settings().data_dir.resolve()
    dest_resolved = dest.resolve()
    if data_dir not in dest_resolved.parents:
        raise AppError(
            "BOOK_PATH_ESCAPE",
            "Resolved attachment path escaped the data directory",
            http_status=500,
        )
    dest.write_bytes(data)
    log.info("book attachment: book=%d -> %s (%d bytes)", book_id, dest.name, len(data))

    rel_path = dest_resolved.relative_to(data_dir).as_posix()

    if flip_version is not None:
        # Preserve the uploaded scan as the fixed signed base, then publish the
        # current included papers after it.
        from app.services import included_papers_service

        version = flip_version

        if version.document_id is not None:
            try:
                included_papers_service.publish_signed_package(
                    db,
                    book,
                    version,
                    dest_resolved,
                    physical_scan=True,
                )
            except Exception:
                with contextlib.suppress(OSError):
                    dest_resolved.unlink()
                raise
        else:
            version.signed_base_pdf_path = rel_path
            version.signed_pdf_path = rel_path
            version.signed_embedded_paper_ids = []
            included_papers_service.advance_package_revision(db, book)
        version.signed_by_user_id = user.id if user is not None else None
        version.signed_at = datetime.now(UTC).replace(tzinfo=None)
        # The scan IS the manager's signature → finalize the pending APPROVER
        # step only. Reviewer steps are advisory (reviewer-approvals, 2026-06-23)
        # and must NOT be flipped to approved by a scan; they freeze in place.
        for step in _approver_steps(version):
            if step.state == "pending":
                step.state = "approved"
                if user is not None and step.assignee_user_id == user.id:
                    step.decided_at = version.signed_at
                    retain_revision_access(db, version, step)
        version.status = "approved"
        book.approval_state = "approved"
        # The flip is a signing, so it files like one in the Correspondence Log.
        try:
            from app.services import correspondence_service

            correspondence_service.log_event(
                db,
                trigger="book_signed",
                source_kind="generated_doc",
                source_book_id=book.id,
                subject=(book.subject or book.ref_number)[:255],
                employee_id=book.employee_id,
                submitter=(user.employee_id if user is not None else None),
                entry_date=(version.signed_at.date() if version.signed_at else date.today()),
                condition_fields={"category": book.category_id},
                direction="outgoing",
            )
        except Exception:
            log.warning(
                "correspondence auto-log failed on scan-back sign for book %s",
                book.id,
                exc_info=True,
            )
    else:
        current_paths: list[str] = list(book.attachment_paths or [])
        current_paths.append(rel_path)
        book.attachment_paths = current_paths

        # ── Phase 3: file the stamped intake scan in the shared Correspondence Log. ──
        try:
            from app.services import correspondence_service

            correspondence_service.log_event(
                db,
                trigger="intake_classified",
                source_kind="intake_scan",
                source_book_id=book.id,
                subject=(book.subject or book.ref_number)[:255],
                employee_id=book.employee_id,
                submitter=None,
                entry_date=date.today(),
                condition_fields={"kind": "incoming"},
                direction="incoming",
            )
        except Exception:
            log.warning(
                "correspondence auto-log failed on intake attach for book %s",
                book.id,
                exc_info=True,
            )
    db.commit()
    db.refresh(book)
    return book


def replace_attachment(db: Session, book_id: int, index: int, filename: str, data: bytes) -> Book:
    """Swap the file at ``attachment_paths[index]`` for ``data`` (undo a wrong
    upload) while keeping the index stable. Validates like ``add_attachment``;
    unlinks the previous file. Raises ``NotFoundError`` on an out-of-range index."""
    book = get_book(db, book_id)
    paths = list(book.attachment_paths or [])
    if index < 0 or index >= len(paths):
        raise NotFoundError("ATTACHMENT_NOT_FOUND", "attachment not found", index=index)
    if len(data) == 0:
        raise ValidationFailedError("BOOK_EMPTY_FILE", "Uploaded file is empty")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ValidationFailedError(
            "BOOK_FILE_TOO_LARGE",
            f"File exceeds {MAX_ATTACHMENT_BYTES} bytes",
            max_bytes=MAX_ATTACHMENT_BYTES,
            size=len(data),
        )
    safe_name = _safe_filename(filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise ValidationFailedError(
            "BOOK_BAD_EXTENSION",
            f"File type {ext!r} is not allowed",
            allowed=sorted(ALLOWED_DOC_EXTS),
        )
    target_dir = _book_attachment_dir(book_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = _unique_attachment_dest(target_dir, safe_name)
    data_dir = get_settings().data_dir.resolve()
    dest_resolved = dest.resolve()
    if data_dir not in dest_resolved.parents:
        raise AppError(
            "BOOK_PATH_ESCAPE",
            "Resolved attachment path escaped the data directory",
            http_status=500,
        )
    dest.write_bytes(data)
    old_rel = paths[index]
    paths[index] = dest_resolved.relative_to(data_dir).as_posix()
    book.attachment_paths = paths  # reassign so the JSON column dirties
    old_abs = resolve_attachment_path(old_rel)
    if old_abs is not None:
        try:
            old_abs.unlink()
        except OSError:
            log.warning("replace_attachment: could not unlink %s", old_abs)
    db.commit()
    db.refresh(book)
    return book


def replace_signed_copy(
    db: Session, book_id: int, filename: str, data: bytes, *, user: User | None = None
) -> Book:
    """Swap the signed artifact's bytes without changing approval state — the
    "I filed the wrong signed scan" fix. Image scans are converted to PDF, as in
    the scan-back flip. Raises when the current version carries no signed copy."""
    book = get_book(db, book_id)
    version = _current_version(book)
    if version is None or not version.signed_pdf_path:
        raise ValidationFailedError("NO_SIGNED_COPY", "This record has no signed copy to replace")
    if len(data) == 0:
        raise ValidationFailedError("BOOK_EMPTY_FILE", "Uploaded file is empty")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ValidationFailedError(
            "BOOK_FILE_TOO_LARGE",
            f"File exceeds {MAX_ATTACHMENT_BYTES} bytes",
            max_bytes=MAX_ATTACHMENT_BYTES,
            size=len(data),
        )
    ext = Path(_safe_filename(filename)).suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise ValidationFailedError(
            "BOOK_BAD_EXTENSION",
            f"File type {ext!r} is not allowed",
            allowed=sorted(ALLOWED_DOC_EXTS),
        )
    if ext != ".pdf":
        data = _image_to_pdf_bytes(data, ext)
    target_dir = _book_attachment_dir(book_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = _unique_attachment_dest(target_dir, f"signed-v{version.version_no}.pdf")
    data_dir = get_settings().data_dir.resolve()
    dest_resolved = dest.resolve()
    if data_dir not in dest_resolved.parents:
        raise AppError(
            "BOOK_PATH_ESCAPE",
            "Resolved attachment path escaped the data directory",
            http_status=500,
        )
    from app.services import included_papers_service

    old_paths = {
        path.resolve()
        for path in (
            resolve_attachment_path(version.signed_pdf_path) if version.signed_pdf_path else None,
            resolve_attachment_path(version.signed_base_pdf_path)
            if version.signed_base_pdf_path
            else None,
        )
        if path is not None
    }
    new_paths = {dest_resolved}
    try:
        dest.write_bytes(data)
        if version.document_id is not None:
            included_papers_service.publish_signed_package(
                db,
                book,
                version,
                dest_resolved,
                physical_scan=True,
            )
        else:
            rel_path = dest_resolved.relative_to(data_dir).as_posix()
            version.signed_base_pdf_path = rel_path
            version.signed_pdf_path = rel_path
            version.signed_embedded_paper_ids = []
            included_papers_service.advance_package_revision(db, book)
        new_output = (
            resolve_attachment_path(version.signed_pdf_path) if version.signed_pdf_path else None
        )
        if new_output is not None:
            new_paths.add(new_output.resolve())
        if user is not None:
            version.signed_by_user_id = user.id
        version.signed_at = datetime.now(UTC).replace(tzinfo=None)
        db.commit()
    except Exception:
        db.rollback()
        for path in new_paths:
            with contextlib.suppress(OSError):
                path.unlink()
        raise
    for path in old_paths - new_paths:
        with contextlib.suppress(OSError):
            path.unlink()
    db.refresh(book)
    return book


def unfile_signed_copy(db: Session, book_id: int, *, user: User | None = None) -> Book:
    """Undo a filed signed copy: delete the artifact and revert the record to its
    pre-signed state. A scan-path form returns to ``awaiting_scan``; otherwise the
    approver steps the scan auto-approved (``decided_at == signed_at``) are reopened
    and the state recomputed, leaving earlier human approvals intact. Writes an
    ``unfile_signed_copy`` AuditLog row (the original scan-back sign entry is left
    in place — an audit trail of what happened)."""
    from app.core import form_policy
    from app.services import included_papers_service

    book = get_book(db, book_id)
    version = _current_version(book)
    if version is None or not version.signed_pdf_path:
        raise ValidationFailedError("NO_SIGNED_COPY", "This record has no signed copy to unfile")
    for step in version.approval_steps:
        retain_revision_access(db, version, step)
    flip_at = version.signed_at
    old_paths = {
        path.resolve()
        for path in (
            resolve_attachment_path(version.signed_pdf_path) if version.signed_pdf_path else None,
            resolve_attachment_path(version.signed_base_pdf_path)
            if version.signed_base_pdf_path
            else None,
        )
        if path is not None
    }
    version.signed_pdf_path = None
    version.signed_base_pdf_path = None
    version.signed_embedded_paper_ids = []
    version.signed_by_user_id = None
    version.signed_at = None
    included_papers_service.advance_package_revision(db, book)
    if form_policy.signing_path_of(version.template_id) == "scan":
        # scan-path forms carry no approver steps (the scan IS the signature).
        version.status = "awaiting_scan"
        book.approval_state = "awaiting_scan"
    else:
        # Reopen only the steps the scan flip auto-approved; human approvals
        # (decided earlier) are preserved. Then recompute the derived state.
        for step in _approver_steps(version):
            if step.state == "approved" and step.decided_at in (None, flip_at):
                step.state = "pending"
                step.decided_at = None
        _recompute_approval_state(book)
    db.add(
        AuditLog(
            actor=(user.employee_id if user is not None else None),
            action="unfile_signed_copy",
            entity_type="book",
            entity_id=str(book.id),
            payload=json.dumps({"ref_number": book.ref_number, "reverted_to": book.approval_state}),
        )
    )
    db.commit()
    for path in old_paths:
        with contextlib.suppress(OSError):
            path.unlink()
    db.refresh(book)
    return book


def detach_attachment(db: Session, book_id: int, rel_path: str) -> Book:
    """Remove a plain attachment (the inverse of the append branch of
    ``add_attachment``): drop ``rel_path`` from ``Book.attachment_paths`` and
    delete the file. Used to UNDO an auto-filed scan. Idempotent."""
    book = get_book(db, book_id)
    paths = list(book.attachment_paths or [])
    if rel_path in paths:
        paths.remove(rel_path)
        book.attachment_paths = paths  # reassign so the JSON column dirties
        abs_path = resolve_attachment_path(rel_path)
        if abs_path is not None:
            try:
                abs_path.unlink()
            except OSError:
                log.warning("detach_attachment: could not unlink %s", abs_path)
        db.commit()
        db.refresh(book)
    return book


def list_revision_access(db: Session, book_id: int) -> list[BookRevisionAccess]:
    """Every retained revision grant for a book, newest revision first."""
    return list(
        db.scalars(
            select(BookRevisionAccess)
            .join(BookVersion)
            .where(BookVersion.book_id == book_id)
            .order_by(BookVersion.version_no.desc(), BookRevisionAccess.id)
        )
    )


def revoke_revision_access(
    db: Session, *, book_id: int, access_id: int, reason: str, actor: User,
) -> list[BookRevisionAccess]:
    """Revoke every retained role grant a user holds on one revision.

    Revoking one responsibility (approver/reviewer) for a person on a
    revision revokes all of that person's grants on that same revision, so a
    different responsibility can't silently keep the same access alive.
    Already-revoked grants keep their original actor/time/reason (idempotent).
    """
    target = db.get(BookRevisionAccess, access_id)
    if target is None or target.version.book_id != book_id:
        raise NotFoundError(
            "REVISION_ACCESS_NOT_FOUND", f"Revision access {access_id} not found", id=access_id,
        )
    trimmed = (reason or "").strip()
    if not trimmed:
        raise ValidationFailedError("REASON_REQUIRED", "A reason is required to revoke access")
    siblings = list(
        db.scalars(
            select(BookRevisionAccess).where(
                BookRevisionAccess.version_id == target.version_id,
                BookRevisionAccess.user_id == target.user_id,
            )
        )
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    changed_ids: list[int] = []
    for grant in siblings:
        if grant.revoked_at is None:
            grant.revoked_at = now
            grant.revoked_by_user_id = actor.id
            grant.revocation_reason = trimmed
            changed_ids.append(grant.id)
    if changed_ids:
        db.add(
            AuditLog(
                actor=actor.employee_id,
                action="book_revision_access_revoked",
                entity_type="book",
                entity_id=str(book_id),
                payload=json.dumps(
                    {
                        "administrator_user_id": actor.id,
                        "target_user_id": target.user_id,
                        "version_id": target.version_id,
                        "access_ids": changed_ids,
                        "reason": trimmed,
                    }
                ),
            )
        )
        db.commit()
        for grant in siblings:
            db.refresh(grant)
    return siblings


# ---------------------------------------------------------------------------
# SMS helpers
# ---------------------------------------------------------------------------


def messages_for_book(db: Session, book: Book) -> list[OutboundMessage]:
    """Return outbound-message rows sent for this book, newest first.

    Queries the unified ``outbound_messages`` log (covers WhatsApp + SMS).
    Uses the current version's ``template_id`` to look up the event via
    ``notify_format.TEMPLATE_EVENTS``. Returns ``[]`` when the template is
    unmapped or the book has no versions.
    """
    current = book.versions[-1] if book.versions else None
    if current is None or current.template_id is None:
        return []
    event = nf.TEMPLATE_EVENTS.get(current.template_id)
    if event is None:
        return []
    stmt = (
        select(OutboundMessage)
        .where(OutboundMessage.event_ref == f"{event}:{book.id}")
        .order_by(OutboundMessage.id.desc())
    )
    return list(db.execute(stmt).scalars().all())


# Keep the old name as an alias for backward compatibility with legacy callers.
sms_for_book = messages_for_book


__all__ = [
    "LIST_DEFAULT_LIMIT",
    "LIST_MAX_LIMIT",
    "MAX_ATTACHMENT_BYTES",
    "add_attachment",
    "add_note",
    "add_reviewers",
    "assert_record_type_visible",
    "build_step_read",
    "create_book",
    "decide_step",
    "delete_book",
    "detach_attachment",
    "document_visibility_clause",
    "get_book",
    "get_book_by_ref",
    "get_book_detail",
    "is_document_signed_locked",
    "list_approver_candidates",
    "list_awaiting",
    "list_book_categories",
    "list_books",
    "list_reviewer_candidates",
    "list_revision_access",
    "mark_seen",
    "messages_for_book",
    "record_review",
    "remove_reviewer",
    "replace_attachment",
    "replace_signed_copy",
    "require_book_access",
    "require_record_type_access",
    "resolve_attachment_path",
    "resolve_doc_manager_user",
    "resolve_user_name_by_id",
    "revoke_revision_access",
    "service_clause",
    "sign_book",
    "sms_for_book",
    "submit_for_approval",
    "submitter_g_number",
    "unfile_signed_copy",
    "update_book",
    "user_visibility_clause",
]
