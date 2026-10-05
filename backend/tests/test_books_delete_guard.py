"""DELETE /books/{id} is server-guarded: only records that are not voided, have
no approval in flight or completed, and have no live Word session can go."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Book, BookCategory, BookEditSession, User
from app.db.session import get_db
from app.main import create_app
from app.services import book_service
from tests.conftest import make_user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _book(
    db: Session,
    ref: str,
    *,
    state: str = "none",
    voided: bool = False,
    session_state: str | None = None,
    owner: User | None = None,
) -> Book:
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.flush()
    book = Book(
        ref_number=ref,
        category_id="GS",
        approval_state=state,
        voided_at=datetime.now(UTC).replace(tzinfo=None) if voided else None,
    )
    db.add(book)
    db.flush()
    if session_state is not None:
        db.add(
            BookEditSession(
                book_id=book.id,
                user_id=(owner.id if owner is not None else 1),
                token=secrets.token_hex(16),
                working_path="/tmp/does-not-matter.docx",
                state=session_state,
            )
        )
    db.commit()
    return book


@pytest.fixture()
def admin(api_db: Session) -> User:
    return make_user(api_db, role="admin", email="deleter@x.ae")


@pytest.mark.parametrize("state", ["none", "returned", "rejected"])
def test_delete_allowed_for_open_states(api_db: Session, admin: User, state: str) -> None:
    book = _book(api_db, f"D-{state}", state=state)

    res = _client(api_db, admin).delete(f"/api/v1/books/{book.id}")

    assert res.status_code == 204
    api_db.refresh(book)
    assert book.deleted_at is not None


def test_delete_allowed_when_the_word_session_is_finished(api_db: Session, admin: User) -> None:
    book = _book(api_db, "D-finished", session_state="finished", owner=admin)

    assert _client(api_db, admin).delete(f"/api/v1/books/{book.id}").status_code == 204


@pytest.mark.parametrize(
    ("label", "kwargs"),
    [
        ("pending", {"state": "pending"}),
        ("awaiting_scan", {"state": "awaiting_scan"}),
        ("approved", {"state": "approved"}),
        ("voided", {"state": "none", "voided": True}),
        ("active_session", {"state": "none", "session_state": "active"}),
    ],
)
def test_delete_refused_with_409_and_row_left_alone(
    api_db: Session, admin: User, label: str, kwargs: dict
) -> None:
    book = _book(api_db, f"X-{label}", owner=admin, **kwargs)

    res = _client(api_db, admin).delete(f"/api/v1/books/{book.id}")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "BOOK_NOT_DELETABLE"
    api_db.refresh(book)
    assert book.deleted_at is None


def test_permission_denial_precedes_the_state_conflict(api_db: Session) -> None:
    operator = make_user(api_db, role="operator", email="nodelete@x.ae")
    approved = _book(api_db, "P-approved", state="approved")

    res = _client(api_db, operator).delete(f"/api/v1/books/{approved.id}")

    assert res.status_code == 403
    assert res.json()["error"]["details"]["capability"] == "books.delete"
    api_db.refresh(approved)
    assert approved.deleted_at is None


def test_service_delete_raises_the_conflict_error(api_db: Session) -> None:
    from app.api.errors import AppError

    book = _book(api_db, "S-approved", state="approved")

    with pytest.raises(AppError) as exc:
        book_service.delete_book(api_db, book.id)

    assert exc.value.code == "BOOK_NOT_DELETABLE"
    assert exc.value.http_status == 409


@pytest.mark.parametrize(
    ("state", "voided", "session", "expected"),
    [
        ("none", False, False, True),
        ("returned", False, False, True),
        ("rejected", False, False, True),
        ("pending", False, False, False),
        ("awaiting_scan", False, False, False),
        ("approved", False, False, False),
        ("none", True, False, False),
        ("none", False, True, False),
    ],
)
def test_is_deletable_truth_table(state: str, voided: bool, session: bool, expected: bool) -> None:
    book = Book(
        ref_number="T",
        category_id="GS",
        approval_state=state,
        voided_at=datetime.now(UTC).replace(tzinfo=None) if voided else None,
    )
    assert book_service.is_deletable(book, session) is expected
