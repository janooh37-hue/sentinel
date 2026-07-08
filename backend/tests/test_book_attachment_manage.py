"""TDD: manage a record's plain attachments — delete and replace by index.

Covers the "mistake happened when uploading files" case: an operator filed the
wrong scan as a plain attachment and needs to remove or swap it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, BookVersion, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()
    eng = create_engine(
        f"sqlite:///{tmp_path / 't.db'}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TS = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TS)
    db = TS()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()
        get_settings.cache_clear()


def _user(db: Session, role: str = "manager") -> User:
    u = User(email=f"{role}@x.ae", password_hash="x", role=role, status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _book_with_attachments(db: Session, tmp_path) -> Book:
    (tmp_path / "book_attachments" / "1").mkdir(parents=True, exist_ok=True)
    for name in ("a.pdf", "b.pdf"):
        (tmp_path / "book_attachments" / "1" / name).write_bytes(b"%PDF-" + name.encode())
    db.add(BookCategory(id="HR", prefix="HR"))
    db.flush()
    book = Book(
        id=1,
        category_id="HR",
        ref_number="HR-1",
        approval_state="none",
        attachment_paths=["book_attachments/1/a.pdf", "book_attachments/1/b.pdf"],
    )
    db.add(book)
    db.flush()
    db.add(BookVersion(book_id=book.id, version_no=1, status="none"))
    db.commit()
    return book


def test_delete_attachment_removes_file_and_entry(api_db, tmp_path) -> None:
    _book_with_attachments(api_db, tmp_path)
    c = _client(api_db, _user(api_db))
    resp = c.request("DELETE", "/api/v1/books/1/attachments/0")
    assert resp.status_code == 200, resp.text
    assert resp.json()["attachment_paths"] == ["book_attachments/1/b.pdf"]
    assert not (tmp_path / "book_attachments" / "1" / "a.pdf").exists()


def test_delete_attachment_out_of_range_404(api_db, tmp_path) -> None:
    _book_with_attachments(api_db, tmp_path)
    c = _client(api_db, _user(api_db))
    assert c.request("DELETE", "/api/v1/books/1/attachments/9").status_code == 404


def test_delete_attachment_requires_manage(api_db, tmp_path) -> None:
    _book_with_attachments(api_db, tmp_path)
    c = _client(api_db, _user(api_db, role="operator"))
    assert c.request("DELETE", "/api/v1/books/1/attachments/0").status_code == 403
