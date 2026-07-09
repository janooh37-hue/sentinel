"""TDD: GET /books/{id} surfaces companion documents in the record.

Annual-leave (and resignation) forms auto-generate a companion document that
shares the primary's ``submission_id`` but has ``leave_id=None`` and no book
version of its own. The record film-strip is built from the book's versions, so
the companion was invisible. The book detail payload now exposes ``companion_docs``
so the client can render the companion paper alongside the primary form.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, BookVersion, Document, User
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


def _user(db: Session, role: str = "admin") -> User:
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


def _book_with_companion(db: Session) -> tuple[Book, Document, Document]:
    """A book whose current version is the primary Leave Application Form, plus a
    companion Leave Undertaking sharing the same submission_id (leave_id=None)."""
    db.add(BookCategory(id="HR", prefix="HR"))
    db.flush()
    book = Book(category_id="HR", ref_number="HR-1", approval_state="approved")
    db.add(book)
    db.flush()
    primary = Document(
        template_id="Leave Application Form",
        ref_number="HR-1",
        docx_path="documents/primary.docx",
        pdf_path="documents/primary.pdf",
        submission_id="sub-1",
        role="primary",
    )
    companion = Document(
        template_id="Leave Undertaking",
        ref_number="HR-1",
        docx_path="documents/companion.docx",
        pdf_path="documents/companion.pdf",
        submission_id="sub-1",
        role="companion",
        leave_id=None,
    )
    db.add_all([primary, companion])
    db.flush()
    db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            status="approved",
            document_id=primary.id,
        )
    )
    db.commit()
    return book, primary, companion


def test_book_detail_exposes_companion_docs(api_db) -> None:
    book, _primary, companion = _book_with_companion(api_db)
    c = _client(api_db, _user(api_db))

    resp = c.get(f"/api/v1/books/{book.id}")

    assert resp.status_code == 200
    body = resp.json()
    ids = [d["document_id"] for d in body["companion_docs"]]
    assert ids == [companion.id]


def test_book_list_exposes_companion_docs(api_db) -> None:
    """The records list (GET /books) — which feeds the desktop record pane — must
    also carry companion_docs, not just the detail endpoint."""
    book, _primary, companion = _book_with_companion(api_db)
    c = _client(api_db, _user(api_db))

    resp = c.get("/api/v1/books?limit=500")

    assert resp.status_code == 200
    item = next(b for b in resp.json()["items"] if b["id"] == book.id)
    ids = [d["document_id"] for d in item["companion_docs"]]
    assert ids == [companion.id]


def test_book_detail_no_companion_when_none(api_db) -> None:
    """A book with only a primary document reports an empty companion list."""
    api_db.add(BookCategory(id="HR", prefix="HR"))
    api_db.flush()
    book = Book(category_id="HR", ref_number="HR-2", approval_state="approved")
    api_db.add(book)
    api_db.flush()
    primary = Document(
        template_id="Leave Application Form",
        ref_number="HR-2",
        docx_path="documents/only.docx",
        pdf_path="documents/only.pdf",
        submission_id="sub-2",
        role="primary",
    )
    api_db.add(primary)
    api_db.flush()
    api_db.add(
        BookVersion(book_id=book.id, version_no=1, status="approved", document_id=primary.id)
    )
    api_db.commit()

    c = _client(api_db, _user(api_db))
    resp = c.get(f"/api/v1/books/{book.id}")

    assert resp.status_code == 200
    assert resp.json()["companion_docs"] == []
