"""ADR 0007 D5: legacy Personal review report and the admin restore action."""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import AuditLog, Book, BookCategory, Employee, User
from app.db.session import get_db
from app.main import create_app
from app.services import book_send_service
from tests.conftest import make_user


def _user(db: Session, role: str, email: str, employee_id: str) -> User:
    db.add(Employee(id=employee_id, name_en=email, name_ar=email))
    user = make_user(db, role=role, email=email)
    user.employee_id = employee_id
    db.commit()
    return user


def _named_book(db: Session, ref: str, creator: User) -> Book:
    book = Book(
        category_id="GS",
        ref_number=ref,
        subject=f"Legacy {ref}",
        grade="unclassified",
        distribution="named",
        created_by_user_id=creator.id,
    )
    db.add(book)
    db.flush()
    return book


def _audit(db: Session, action: str, book: Book, actor: str | None, **payload: object) -> None:
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            entity_type="book",
            entity_id=str(book.id),
            payload=json.dumps({"ref_number": book.ref_number, **payload}),
        )
    )


def test_report_lists_legacy_personal_records_and_flags_non_creator_setter(
    db_session: Session,
) -> None:
    db = db_session
    db.add(BookCategory(id="GS", prefix="GS"))
    writer = _user(db, "operator", "writer@test.ae", "G100")
    manager = _user(db, "manager", "manager@test.ae", "G200")
    created_personal = _named_book(db, "1/1/1", writer)
    relabelled = _named_book(db, "1/1/2", writer)
    _named_book(db, "1/1/3", writer)  # a new named General Book, never Personal
    for book in (created_personal, relabelled):
        _audit(db, "book_legacy_personal", book, None)
    _audit(db, "book_confidentiality_changed", relabelled, "G100", old="general", new="secret")
    _audit(db, "book_confidentiality_changed", relabelled, "G200", old="secret", new="personal")
    db.commit()

    rows = book_send_service.legacy_personal_report(db)

    assert [(r.book_id, r.ref_number, r.creator, r.set_by, r.set_by_not_creator) for r in rows] == [
        (created_personal.id, "1/1/1", "G100", "G100", False),
        (relabelled.id, "1/1/2", "G100", "G200", True),
    ]
    assert manager.employee_id == "G200"


@pytest.fixture()
def restore_api(api_db: Session) -> Iterator[tuple[TestClient, dict[str, User], Book]]:
    api_db.add(BookCategory(id="GS", prefix="GS"))
    users = {
        "writer": _user(api_db, "operator", "writer@test.ae", "G100"),
        "manager": _user(api_db, "manager", "manager@test.ae", "G200"),
        "admin": _user(api_db, "admin", "admin@test.ae", "G300"),
    }
    book = _named_book(api_db, "1/1/1", users["writer"])
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    holder = {"actor": users["admin"]}
    app.dependency_overrides[get_current_user] = lambda: holder["actor"]
    with TestClient(app, raise_server_exceptions=True) as client:
        client.holder = holder  # type: ignore[attr-defined]
        yield client, users, book


@pytest.mark.parametrize("actor", ("writer", "manager"))
def test_only_admin_restores_organization_distribution(
    restore_api: tuple[TestClient, dict[str, User], Book], actor: str
) -> None:
    client, users, book = restore_api
    client.holder["actor"] = users[actor]  # type: ignore[attr-defined]
    response = client.post(
        f"/api/v1/books/{book.id}/restore-distribution", json={"reason": "Review"}
    )
    assert response.status_code == 403, response.text


def test_admin_restore_is_audited_and_opens_the_record(
    restore_api: tuple[TestClient, dict[str, User], Book], api_db: Session
) -> None:
    client, users, book = restore_api
    response = client.post(
        f"/api/v1/books/{book.id}/restore-distribution", json={"reason": "D5 review"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["distribution"] == "organization"
    audit = api_db.scalars(
        select(AuditLog).where(AuditLog.action == "book_distribution_restored")
    ).one()
    assert audit.actor == "G300"
    assert json.loads(audit.payload or "{}")["reason"] == "D5 review"
    client.holder["actor"] = users["manager"]  # type: ignore[attr-defined]
    assert client.get(f"/api/v1/books/{book.id}").status_code == 200
    again = client.post(f"/api/v1/books/{book.id}/restore-distribution", json={"reason": "x"})
    client.holder["actor"] = users["admin"]  # type: ignore[attr-defined]
    assert again.status_code == 403
    repeat = client.post(f"/api/v1/books/{book.id}/restore-distribution", json={"reason": "x"})
    assert repeat.status_code == 409, repeat.text
