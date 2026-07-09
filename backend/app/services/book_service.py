"""Book reference service — Phase 05.

Provides list/get/create/update/soft-delete for Book rows, plus a helper
for listing BookCategory rows.  Ref-number allocation is atomic via SQLite's
``BEGIN IMMEDIATE`` serialisation — see ``create_book`` for details.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from pathlib import Path, PurePath
from typing import Any

from sqlalchemy import Integer, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.constants import ALLOWED_DOC_EXTS, STAMP_STYLES
from app.db.models import (
    AuditLog,
    Book,
    BookAnnotation,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Employee,
    Manager,
    SmsMessage,
    User,
)
from app.db.repos.refs_repo import allocate_ref_with_retry
from app.schemas.book import ApproverOptionRead, BookApprovalStepRead, BookCreate, BookUpdate
from app.services import notify_format as nf
from app.services import perm_service

log = logging.getLogger(__name__)

MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024  # 25 MiB

_UNSAFE_CHARS = re.compile(r"[\\/:\*\?\"<>\|\x00-\x1f]")

LIST_DEFAULT_LIMIT = 100
LIST_MAX_LIMIT = 500


# ---------------------------------------------------------------------------
# Category helpers
# ---------------------------------------------------------------------------


def list_book_categories(db: Session) -> list[BookCategory]:
    """Return all categories in natural numeric order ("1", "2", … "10", "11").

    ``id`` is a String PK that holds both numeric ("1".."12") and legacy alpha
    codes ("HR", "GS"). A plain string sort would yield "1","10","11","2",…;
    cast to INTEGER so numeric ids order naturally. Non-numeric codes cast to 0
    in SQLite and fall first, then tie-break on the raw id for stability.
    """
    stmt = select(BookCategory).order_by(func.cast(BookCategory.id, Integer), BookCategory.id)
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


def list_books(
    db: Session,
    *,
    category_id: str | None = None,
    direction: str | None = None,
    approval_state: str | None = None,
    q: str | None = None,
    from_date: datetime | None = None,
    to_date: date | None = None,
    limit: int = LIST_DEFAULT_LIMIT,
    offset: int = 0,
    include_deleted: bool = False,
) -> tuple[list[Book], int]:
    """Paginated list with optional filters.  Returns ``(rows, total)``."""
    limit = max(1, min(limit, LIST_MAX_LIMIT))
    offset = max(0, offset)

    stmt = select(Book)
    count_stmt = select(func.count()).select_from(Book)

    if not include_deleted:
        stmt = stmt.where(Book.deleted_at.is_(None))
        count_stmt = count_stmt.where(Book.deleted_at.is_(None))

    if category_id is not None:
        stmt = stmt.where(Book.category_id == category_id)
        count_stmt = count_stmt.where(Book.category_id == category_id)

    if direction is not None:
        stmt = stmt.where(Book.direction == direction)
        count_stmt = count_stmt.where(Book.direction == direction)

    if approval_state is not None:
        stmt = stmt.where(Book.approval_state == approval_state)
        count_stmt = count_stmt.where(Book.approval_state == approval_state)

    if q:
        needle = f"%{q.strip()}%"
        clause = or_(
            Book.subject.ilike(needle),
            Book.ref_number.ilike(needle),
        )
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
    return rows, total


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
    _recompute_approval_state(book)
    db.commit()
    db.refresh(book)
    return book


def decide_step(
    db: Session,
    book_id: int,
    *,
    user_id: int,
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
    current = _current_pending_step(book)
    if current is None:
        raise ValidationFailedError("NO_PENDING_STEP", "Book has no step awaiting a decision")
    if current.assignee_user_id != user_id:
        raise ValidationFailedError("NOT_YOUR_STEP", "This step is assigned to another user")
    if decision not in _DECISIONS:
        raise ValidationFailedError("BAD_DECISION", f"{decision!r} is not a valid decision")
    if decision in ("returned", "rejected") and not (note and note.strip()):
        version = _current_version(book)
        has_comment_mark = version is not None and any(
            a.comment and a.comment.strip() for a in version.annotations
        )
        if not has_comment_mark:
            raise ValidationFailedError(
                "REASON_REQUIRED",
                "A reason (a note, or a comment on the document) is required to return or reject",
            )
    current.state = decision
    current.note = note
    current.decided_at = datetime.now(UTC).replace(tzinfo=None)
    _recompute_approval_state(book)
    db.commit()
    db.refresh(book)
    return book


def sign_book(db: Session, book_id: int, *, user_id: int) -> Book:
    """Approve by signing: verify the caller is the pending signer, embed their
    signature into the current version's document, store the signed PDF, mark
    the book (and current version) approved.

    Mirrors ``decide_step``'s authorization + state machine, but instead of
    merely advancing the step it physically signs: ``render_signed_pdf``
    re-renders the version's document with the signer's signature injected.
    """
    from app.services import document_service

    book = _get_book_with_versions(db, book_id)
    current = _current_pending_step(book)
    if current is None:
        raise ValidationFailedError("NO_PENDING_STEP", "Book has no step awaiting a signature")
    if current.assignee_user_id != user_id:
        raise ValidationFailedError("NOT_YOUR_STEP", "This signature is assigned to another user")
    signer = db.get(User, user_id)
    if signer is None or not signer.signature_path:
        raise ValidationFailedError("NO_SIGNATURE", "You have no signature on file")
    abs_sig = Path(signer.signature_path)
    if not abs_sig.is_absolute():
        abs_sig = get_settings().data_dir / abs_sig
    if not abs_sig.is_file():
        raise ValidationFailedError("SIGNATURE_MISSING", "Your signature file is missing")

    version = _current_version(book)
    if version is None:
        raise ValidationFailedError("NO_VERSION", "Book has no version to sign")
    signed_rel = document_service.render_signed_pdf(
        db, version=version, signer_signature_path=str(abs_sig)
    )
    version.signed_pdf_path = signed_rel
    version.signed_by_user_id = user_id
    version.signed_at = datetime.now(UTC).replace(tzinfo=None)
    current.state = "approved"
    current.decided_at = version.signed_at
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


def is_document_signed_locked(db: Session, document_id: int) -> tuple[bool, str | None]:
    """Return ``(locked, signed_pdf_rel)`` if ``document_id`` belongs to a signed version.

    A document is locked once its linked ``BookVersion`` is ``approved`` (signed)
    and carries a ``signed_pdf_path``. Callers use this to deny DOCX download and
    serve the signed artifact instead. Returns ``(False, None)`` otherwise.
    """
    version = (
        db.execute(select(BookVersion).where(BookVersion.document_id == document_id))
        .scalars()
        .first()
    )
    if version is not None and version.status == "approved" and version.signed_pdf_path:
        return True, version.signed_pdf_path
    return False, None


def add_note(db: Session, book_id: int, *, user_id: int, note: str | None = None) -> Book:
    """Attach a note to the current pending step without changing its state.

    Only the current step's assignee may add a note.
    """
    if not note:
        raise ValidationFailedError("EMPTY_NOTE", "A note is required")
    book = _get_book_with_versions(db, book_id)
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
    """Books with a pending step (approver OR reviewer) assigned to ``user_id``."""
    stmt = (
        select(Book)
        .options(selectinload(Book.versions).selectinload(BookVersion.approval_steps))
        .where(Book.deleted_at.is_(None))
        .where(Book.approval_state == "pending")
        .order_by(Book.created_at.desc())
    )
    out: list[Book] = []
    for book in db.execute(stmt).scalars().all():
        if your_step_kind(book, user_id) is not None:
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
    db: Session, book_id: int, *, user_id: int, decision: str, note: str | None = None
) -> Book:
    """Record an advisory reviewer verdict. Never recomputes approval_state."""
    if decision not in _REVIEW_DECISIONS:
        raise ValidationFailedError("BAD_DECISION", f"{decision!r} is not a valid review decision")
    book = _get_book_with_versions(db, book_id)
    step = _my_pending_reviewer_step(book, user_id)
    if step is None:
        raise ValidationFailedError("NOT_A_REVIEWER", "You have no pending review on this record")
    if decision == "changes_requested" and not (note and note.strip()):
        raise ValidationFailedError("REASON_REQUIRED", "A note is required to request changes")
    step.state = decision
    step.note = note.strip() if note and note.strip() else None
    step.decided_at = datetime.now(UTC).replace(tzinfo=None)
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
    has_sig = bool(user is not None and user.signature_path)
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


def imported_document_of(book: Book) -> dict[str, Any] | None:
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
    return {
        "pdf_url": (f"{base}?format=pdf" if pdf_rel is not None else None),
        "download_url": f"{base}?format=original",
        "filename": filename,
        "format": fmt,
    }


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
        # (books.manage) — unified across all flip states; the real signature is
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
        # ── Scan-back flip: the scan IS the signed artifact (one paper, no
        # duplicate in attachment_paths). Mirrors sign_book's bookkeeping.
        version = flip_version
        version.signed_pdf_path = rel_path
        version.signed_by_user_id = user.id if user is not None else None
        version.signed_at = datetime.now(UTC).replace(tzinfo=None)
        # The scan IS the manager's signature → finalize the pending APPROVER
        # step only. Reviewer steps are advisory (reviewer-approvals, 2026-06-23)
        # and must NOT be flipped to approved by a scan; they freeze in place.
        for step in _approver_steps(version):
            if step.state == "pending":
                step.state = "approved"
                step.decided_at = version.signed_at
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
    dest.write_bytes(data)
    old_abs = resolve_attachment_path(version.signed_pdf_path)
    version.signed_pdf_path = dest_resolved.relative_to(data_dir).as_posix()
    if user is not None:
        version.signed_by_user_id = user.id
    version.signed_at = datetime.now(UTC).replace(tzinfo=None)
    if old_abs is not None:
        try:
            old_abs.unlink()
        except OSError:
            log.warning("replace_signed_copy: could not unlink %s", old_abs)
    db.commit()
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

    book = get_book(db, book_id)
    version = _current_version(book)
    if version is None or not version.signed_pdf_path:
        raise ValidationFailedError("NO_SIGNED_COPY", "This record has no signed copy to unfile")
    flip_at = version.signed_at
    old_abs = resolve_attachment_path(version.signed_pdf_path)
    version.signed_pdf_path = None
    version.signed_by_user_id = None
    version.signed_at = None
    if form_policy.signing_path_of(version.template_id) == "scan":
        # scan-path forms carry no approver steps (the scan IS the signature).
        version.status = "awaiting_scan"
        book.approval_state = "awaiting_scan"
    else:
        # Reopen only the steps the scan flip auto-approved; human approvals
        # (decided earlier) are preserved. Then recompute the derived state.
        for step in _approver_steps(version):
            if step.state == "approved" and step.decided_at == flip_at:
                step.state = "pending"
                step.decided_at = None
        _recompute_approval_state(book)
    if old_abs is not None:
        try:
            old_abs.unlink()
        except OSError:
            log.warning("unfile_signed_copy: could not unlink %s", old_abs)
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


# ---------------------------------------------------------------------------
# SMS helpers
# ---------------------------------------------------------------------------


def sms_for_book(db: Session, book: Book) -> list[SmsMessage]:
    """Return SMS rows sent for this book, newest first.

    Uses the current version's ``template_id`` to look up the SMS event via
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
        select(SmsMessage)
        .where(SmsMessage.event_ref == f"{event}:{book.id}")
        .order_by(SmsMessage.id.desc())
    )
    return list(db.execute(stmt).scalars().all())


__all__ = [
    "LIST_DEFAULT_LIMIT",
    "LIST_MAX_LIMIT",
    "MAX_ATTACHMENT_BYTES",
    "add_attachment",
    "add_note",
    "add_reviewers",
    "build_step_read",
    "create_book",
    "decide_step",
    "delete_book",
    "detach_attachment",
    "get_book",
    "get_book_by_ref",
    "get_book_detail",
    "is_document_signed_locked",
    "list_approver_candidates",
    "list_awaiting",
    "list_book_categories",
    "list_books",
    "list_reviewer_candidates",
    "mark_seen",
    "record_review",
    "remove_reviewer",
    "replace_attachment",
    "replace_signed_copy",
    "resolve_attachment_path",
    "resolve_doc_manager_user",
    "resolve_user_name_by_id",
    "sign_book",
    "sms_for_book",
    "submit_for_approval",
    "submitter_g_number",
    "unfile_signed_copy",
    "update_book",
]
