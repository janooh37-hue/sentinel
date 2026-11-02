"""Scan Inbox filing authorizes the *target*, not just the ``documents.scan`` route gate.

``documents.scan`` lets a user triage their inbox. Filing a scan onto a book is a
book edit (``books.edit`` + full access to that book, as ``POST /books/{id}/attachments``
requires) and filing onto an employee is a vault write (``employees.vault.manage``, as
the employee document routes require). A denied request must leave the item, the
target book and the vault untouched; an authorized actor still files.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import get_settings
from app.db.models import Book, BookCategory, Employee, ScanInbox, User, UserPermission, VaultFile
from app.db.session import get_db
from app.main import create_app

_PDF = b"%PDF-1.4 synthetic scan"


@pytest.fixture()
def data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _user(db: Session, *, email: str, role: str, deny: tuple[str, ...] = ()) -> User:
    u = User(email=email, password_hash="x", display_name=email, role=role, status="active")
    db.add(u)
    db.flush()
    for cap in deny:
        db.add(UserPermission(user_id=u.id, capability=cap, effect="deny"))
    db.commit()
    return u


def _book(db: Session) -> Book:
    db.add(BookCategory(id="GS", name_en="General", name_ar="عام", prefix="GS"))
    book = Book(
        category_id="GS",
        ref_number="GS-0901",
        subject="Synthetic",
        approval_state="approved",
        attachment_paths=[],
    )
    db.add(book)
    db.add(Employee(id="G-AUTHZ-1", name_en="SYNTHETIC PERSON"))
    db.commit()
    return book


def _item(
    db: Session, data_dir: Path, owner: User, *, state: str = "awaiting_confirmation", **kw
) -> ScanInbox:
    rel = f"scan_inbox/{owner.id}-{state}.pdf"
    (data_dir / rel).parent.mkdir(parents=True, exist_ok=True)
    (data_dir / rel).write_bytes(_PDF)
    item = ScanInbox(
        source="email_attachment",
        owner_user_id=owner.id,
        file_path=rel,
        filename=Path(rel).name,
        state=state,
        **kw,
    )
    db.add(item)
    db.commit()
    return item


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _snapshot(db: Session, item_id: int, book_id: int) -> dict[str, object]:
    db.expire_all()
    item = db.get(ScanInbox, item_id)
    book = db.get(Book, book_id)
    assert item is not None and book is not None
    return {
        "state": item.state,
        "route": item.proposed_route,
        "book": item.proposed_book_id,
        "employee": item.proposed_employee_id,
        "undo": item.undo_token,
        "attachments": list(book.attachment_paths or []),
        "vault_rows": db.scalar(select(func.count()).select_from(VaultFile)),
    }


# Both roles hold books.edit and employees.vault.manage by default, so each row
# denies the capability under test: the check is the capability, not the role
# name.
_NO_BOOK_EDIT = [("operator", ("books.edit",)), ("manager", ("books.edit",))]
_NO_VAULT = [("operator", ("employees.vault.manage",)), ("manager", ("employees.vault.manage",))]


@pytest.mark.parametrize(("role", "deny"), _NO_BOOK_EDIT)
def test_route_to_book_without_book_edit_is_forbidden_and_unchanged(
    api_db: Session, data_dir: Path, role: str, deny: tuple[str, ...]
) -> None:
    actor = _user(api_db, email="a@x.ae", role=role, deny=deny)
    book = _book(api_db)
    item = _item(api_db, data_dir, actor)
    before = _snapshot(api_db, item.id, book.id)

    r = _client(api_db, actor).post(
        f"/api/v1/scan-inbox/{item.id}/route", json={"book_id": book.id}
    )

    assert r.status_code == 403
    assert _snapshot(api_db, item.id, book.id) == before


@pytest.mark.parametrize(("role", "deny"), _NO_VAULT)
def test_route_to_employee_without_vault_manage_is_forbidden_and_unchanged(
    api_db: Session, data_dir: Path, role: str, deny: tuple[str, ...]
) -> None:
    actor = _user(api_db, email="a@x.ae", role=role, deny=deny)
    book = _book(api_db)
    item = _item(api_db, data_dir, actor)
    before = _snapshot(api_db, item.id, book.id)

    r = _client(api_db, actor).post(
        f"/api/v1/scan-inbox/{item.id}/route", json={"employee_id": "G-AUTHZ-1"}
    )

    assert r.status_code == 403
    assert _snapshot(api_db, item.id, book.id) == before


@pytest.mark.parametrize(("role", "deny"), _NO_BOOK_EDIT)
def test_confirm_proposed_book_without_book_edit_is_forbidden_and_unchanged(
    api_db: Session, data_dir: Path, role: str, deny: tuple[str, ...]
) -> None:
    actor = _user(api_db, email="a@x.ae", role=role, deny=deny)
    book = _book(api_db)
    item = _item(api_db, data_dir, actor, proposed_route="book_attach", proposed_book_id=book.id)
    before = _snapshot(api_db, item.id, book.id)

    r = _client(api_db, actor).post(f"/api/v1/scan-inbox/{item.id}/confirm")

    assert r.status_code == 403
    assert _snapshot(api_db, item.id, book.id) == before


@pytest.mark.parametrize(("role", "deny"), _NO_VAULT)
def test_confirm_proposed_employee_without_vault_manage_is_forbidden_and_unchanged(
    api_db: Session, data_dir: Path, role: str, deny: tuple[str, ...]
) -> None:
    actor = _user(api_db, email="a@x.ae", role=role, deny=deny)
    book = _book(api_db)
    item = _item(
        api_db, data_dir, actor, proposed_route="employee_doc", proposed_employee_id="G-AUTHZ-1"
    )
    before = _snapshot(api_db, item.id, book.id)

    r = _client(api_db, actor).post(f"/api/v1/scan-inbox/{item.id}/confirm")

    assert r.status_code == 403
    assert _snapshot(api_db, item.id, book.id) == before


@pytest.mark.parametrize(("role", "deny"), _NO_BOOK_EDIT)
def test_undo_book_filing_without_book_edit_is_forbidden_and_unchanged(
    api_db: Session, data_dir: Path, role: str, deny: tuple[str, ...]
) -> None:
    actor = _user(api_db, email="a@x.ae", role=role, deny=deny)
    book = _book(api_db)
    filed = f"book_attachments/{book.id}/filed.pdf"
    (data_dir / filed).parent.mkdir(parents=True)
    (data_dir / filed).write_bytes(_PDF)
    book.attachment_paths = [filed]
    api_db.commit()
    item = _item(
        api_db,
        data_dir,
        actor,
        state="auto_filed",
        proposed_route="book_attach",
        proposed_book_id=book.id,
        undo_token=f"book:{book.id}:{filed}",
    )
    before = _snapshot(api_db, item.id, book.id)

    r = _client(api_db, actor).post(f"/api/v1/scan-inbox/{item.id}/undo")

    assert r.status_code == 403
    assert _snapshot(api_db, item.id, book.id) == before
    assert (data_dir / filed).exists()


def test_authorized_actor_still_files_to_book_and_employee(api_db: Session, data_dir: Path) -> None:
    actor = _user(api_db, email="m@x.ae", role="manager")
    book = _book(api_db)
    to_book = _item(api_db, data_dir, actor)
    to_emp = _item(api_db, data_dir, actor, state="unrouted")
    client = _client(api_db, actor)

    r_book = client.post(f"/api/v1/scan-inbox/{to_book.id}/route", json={"book_id": book.id})
    r_emp = client.post(f"/api/v1/scan-inbox/{to_emp.id}/route", json={"employee_id": "G-AUTHZ-1"})

    assert (r_book.status_code, r_book.json()["state"]) == (200, "filed")
    assert (r_emp.status_code, r_emp.json()["state"]) == (200, "filed")
    after = _snapshot(api_db, to_book.id, book.id)
    assert len(after["attachments"]) == 1  # type: ignore[arg-type]
    assert after["vault_rows"] == 1
