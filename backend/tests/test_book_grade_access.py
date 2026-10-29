"""ADR 0007 access matrix: grade x distribution x role x relation x clearance.

For every combination the SQL rule (``user_visibility_clause``), its Python
mirror (``resolve_book_read_access``) and the expected table below agree.
A record the caller cannot open is a 404. Admins see Top Secret and Addressee
Only records as list metadata only.

Break-glass grants (``book_access_grants``) arrive in Phase 2, so the
break-glass dimension holds only ``none`` until then. Phase 1 has no CC
addressee: every direct send is a To recipient.
"""

from __future__ import annotations

import itertools
from collections.abc import Iterator
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import NotFoundError
from app.db.models import (
    Book,
    BookApprovalStep,
    BookCategory,
    BookRecipient,
    BookRevisionAccess,
    BookVersion,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.services import book_service
from tests.conftest import make_user

ROLES = ("operator", "manager", "admin", "inmate_reporter")
GRADE_DISTRIBUTIONS = (
    ("unclassified", "organization"),
    ("unclassified", "named"),
    ("secret", "organization"),
    ("secret", "named"),
    ("top_secret", "named"),
    ("addressee_only", "named"),
)
RELATIONS = ("none", "creator", "to", "assignee", "retained")
CLEARANCE = (False, True)
BREAK_GLASS = ("none",)
RESTRICTED = {"top_secret", "addressee_only"}

COMBINATIONS = list(itertools.product(ROLES, RELATIONS, CLEARANCE, BREAK_GLASS))


def expected(role: str, grade: str, distribution: str, relation: str, cleared: bool) -> str:
    """The §3 access rule as a table: full | revision | metadata | none."""
    named = relation in ("creator", "to")
    assigned = relation in ("assignee", "retained")
    if role == "inmate_reporter":
        open_ = grade == "unclassified" and (
            distribution == "organization" or relation == "creator"
        )
        return "full" if open_ else "none"
    if role == "admin":
        if grade not in RESTRICTED or named:
            return "full"
        return "revision" if assigned else "metadata"
    if grade in RESTRICTED:
        allowed = named
    else:
        allowed = (grade == "unclassified" or cleared) and (distribution == "organization" or named)
    if allowed:
        return "full"
    return "revision" if assigned else "none"


def _book(
    db: Session, creator: User, grade: str, distribution: str, ref: str | None = None
) -> Book:
    record = Book(
        category_id="INV",
        ref_number=ref or f"INV-{grade}-{distribution}",
        subject=f"Matrix {grade} {distribution}",
        direction="outgoing",
        grade=grade,
        distribution=distribution,
        approval_state="pending",
        created_by_user_id=creator.id,
    )
    db.add(record)
    db.flush()
    db.add(
        BookVersion(
            book_id=record.id,
            version_no=1,
            # A form every role (inmate reporters too) may open by record type.
            template_id="Inmate Conduct Violations",
            fields={},
            status="pending",
            created_by_user_id=creator.id,
        )
    )
    db.flush()
    return record


def _relate(db: Session, book: Book, user: User, writer: User, relation: str) -> None:
    version = book.versions[-1]
    if relation == "to":
        db.add(
            BookRecipient(
                book_id=book.id,
                user_id=user.id,
                sent_by_user_id=writer.id,
                purpose="info",
                created_at=datetime(2026, 10, 1),
            )
        )
    elif relation == "assignee":
        db.add(
            BookApprovalStep(
                book_id=book.id,
                version_id=version.id,
                step_order=0,
                stage_label="Approve",
                assignee_user_id=user.id,
                state="pending",
                kind="approver",
            )
        )
    elif relation == "retained":
        db.add(
            BookRevisionAccess(
                version_id=version.id,
                user_id=user.id,
                kind="reviewer",
                state="reviewed",
                decided_at=datetime(2026, 10, 1),
            )
        )


def _scenario(
    db: Session, role: str, relation: str, cleared: bool
) -> tuple[User, dict[tuple[str, str], Book]]:
    db.add(BookCategory(id="INV", prefix="INV", requires_approval=False))
    caller = make_user(db, role=role, email=f"caller-{role}@test.ae")
    writer = make_user(db, role="operator", email="writer@test.ae")
    if cleared:
        db.add(UserPermission(user_id=caller.id, capability="books.secret", effect="grant"))
    creator = caller if relation == "creator" else writer
    books = {}
    for grade, distribution in GRADE_DISTRIBUTIONS:
        book = _book(db, creator, grade, distribution)
        _relate(db, book, caller, writer, relation)
        books[(grade, distribution)] = book
    db.commit()
    for book in books.values():
        db.refresh(book)
    return caller, books


def _verdict(db: Session, user: User, book: Book, listed: set[int]) -> str:
    try:
        access = book_service.resolve_book_read_access(db, user, book)
    except NotFoundError:
        return "metadata" if book.id in listed else "none"
    return "full" if access.full_access else "revision"


@pytest.mark.parametrize(("role", "relation", "cleared", "break_glass"), COMBINATIONS)
def test_grade_access_matrix(
    db_session: Session, role: str, relation: str, cleared: bool, break_glass: str
) -> None:
    db = db_session
    caller, books = _scenario(db, role, relation, cleared)
    clause = book_service.user_visibility_clause(db, caller)
    stmt = select(Book.id)
    open_ids = set(db.scalars(stmt if clause is None else stmt.where(clause)))
    listed_rows, _total, _snippets = book_service.list_books(db, user=caller)
    listed = {row.id for row in listed_rows}
    for (grade, distribution), book in books.items():
        want = expected(role, grade, distribution, relation, cleared)
        label = f"{role} {relation} cleared={cleared} {grade}/{distribution}"
        from app.services.action_guard_service import book_read_decision

        decision = book_read_decision(db, caller, book, version_id=book.versions[-1].id)
        assert decision.allowed == (want in ("full", "revision")), label
        if decision.allowed:
            assert decision.access.full_access == (want == "full"), label
        assert _verdict(db, caller, book, listed) == want, label
        assert (book.id in open_ids) == (want == "full"), label
        # Admins list every Top Secret / Addressee Only record (metadata rows).
        admin_metadata = role == "admin" and grade in RESTRICTED
        assert (book.id in listed) == (want in ("full", "metadata") or admin_metadata), label


def test_matrix_covers_every_combination() -> None:
    assert len(COMBINATIONS) * len(GRADE_DISTRIBUTIONS) == 240


# ---------------------------------------------------------------------------
# Admin metadata-only verdict over the API.
# ---------------------------------------------------------------------------


@pytest.fixture()
def admin_api(api_db: Session) -> Iterator[tuple[TestClient, Book, Book]]:
    api_db.add(BookCategory(id="INV", prefix="INV", requires_approval=False))
    writer = make_user(api_db, role="operator", email="writer@test.ae")
    admin = make_user(api_db, role="admin", email="admin@test.ae")
    secret = _book(api_db, writer, "top_secret", "named")
    open_book = _book(api_db, writer, "unclassified", "organization")
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: admin
    with TestClient(app, raise_server_exceptions=True) as client:
        yield client, secret, open_book


def test_admin_lists_restricted_record_as_metadata_only(
    admin_api: tuple[TestClient, Book, Book],
) -> None:
    client, secret, open_book = admin_api
    listing = client.get("/api/v1/books")
    assert listing.status_code == 200, listing.text
    items = {item["id"]: item for item in listing.json()["items"]}
    row = items[secret.id]
    assert row["metadata_only"] is True
    assert row["ref_number"] == secret.ref_number
    assert row["grade"] == "top_secret"
    assert row["subject"] is None
    assert items[open_book.id]["metadata_only"] is False
    assert items[open_book.id]["subject"] == open_book.subject


@pytest.mark.parametrize("path", ("", "/thread", "/recipients", "/attachments/0"))
def test_admin_restricted_content_is_not_found(
    admin_api: tuple[TestClient, Book, Book], path: str
) -> None:
    client, secret, _open_book = admin_api
    response = client.get(f"/api/v1/books/{secret.id}{path}")
    assert response.status_code == 404, response.text


# ---------------------------------------------------------------------------
# Legacy block: migrated levels keep their outcomes (formerly test_book_confidentiality, now test_book_grade).
# ---------------------------------------------------------------------------

LEGACY = {
    "general": ("unclassified", "organization"),
    "personal": ("unclassified", "named"),
    "secret": ("secret", "organization"),
    "directed": ("unclassified", "named"),
}
LEGACY_VISIBLE = {
    "A": {"general", "personal", "directed"},
    "B": {"general"},
    "C": {"general"},
    "C2": {"general", "secret"},
    "M": {"general"},
    "D": set(LEGACY),
}


def test_legacy_levels_keep_their_visibility(db_session: Session) -> None:
    db = db_session
    db.add(BookCategory(id="INV", prefix="INV", requires_approval=False))
    users = {
        name: make_user(db, role=role, email=f"legacy-{name}@test.ae")
        for name, role in (
            ("A", "operator"),
            ("B", "operator"),
            ("C", "operator"),
            ("C2", "operator"),
            ("M", "manager"),
            ("D", "admin"),
        )
    }
    db.add(UserPermission(user_id=users["C2"].id, capability="books.secret", effect="grant"))
    books = {}
    for level, (grade, distribution) in LEGACY.items():
        books[level] = _book(db, users["A"], grade, distribution, f"INV-legacy-{level}")
    db.commit()
    for name, user in users.items():
        clause = book_service.user_visibility_clause(db, user)
        stmt = select(Book.id)
        visible = set(db.scalars(stmt if clause is None else stmt.where(clause)))
        assert visible == {books[level].id for level in LEGACY_VISIBLE[name]}, name
