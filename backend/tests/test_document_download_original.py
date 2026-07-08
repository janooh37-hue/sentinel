"""TDD: GET /documents/{id}/download?original=true serves the pre-signature
generated PDF even when the version is signed-locked.

Regression guard for the "original form hidden after a signed copy is filed"
bug: the generated Document and its signed copy share one document_id, and the
default download swaps in the signed artifact once the version is locked, so the
original form was unreachable. `original=true` restores access to it.
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


def _signed_book(db: Session, tmp_path) -> tuple[Book, Document]:
    """A book whose current version is signed-locked: pdf_path = the original
    generated form, signed_pdf_path = the scanned signed copy."""
    (tmp_path / "documents").mkdir(exist_ok=True)
    (tmp_path / "book_attachments").mkdir(exist_ok=True)
    (tmp_path / "documents" / "orig.pdf").write_bytes(b"%PDF-ORIGINAL")
    (tmp_path / "documents" / "orig.docx").write_bytes(b"DOCX")
    (tmp_path / "book_attachments" / "signed-v1.pdf").write_bytes(b"%PDF-SIGNED-SCAN")
    db.add(BookCategory(id="HR", prefix="HR"))
    db.flush()
    book = Book(category_id="HR", ref_number="HR-1", approval_state="approved")
    db.add(book)
    db.flush()
    doc = Document(
        template_id="tmpl",
        ref_number="HR-1",
        docx_path="documents/orig.docx",
        pdf_path="documents/orig.pdf",
        submission_id="sub-1",
    )
    db.add(doc)
    db.flush()
    db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            status="approved",
            document_id=doc.id,
            signed_pdf_path="book_attachments/signed-v1.pdf",
        )
    )
    db.commit()
    return book, doc


def test_default_download_serves_signed_scan(api_db, tmp_path) -> None:
    _book, doc = _signed_book(api_db, tmp_path)
    c = _client(api_db, _user(api_db))
    resp = c.get(f"/api/v1/documents/{doc.id}/download?format=pdf")
    assert resp.status_code == 200
    assert resp.content == b"%PDF-SIGNED-SCAN"


def test_original_true_serves_pre_signature_pdf(api_db, tmp_path) -> None:
    _book, doc = _signed_book(api_db, tmp_path)
    c = _client(api_db, _user(api_db))
    resp = c.get(f"/api/v1/documents/{doc.id}/download?format=pdf&original=true")
    assert resp.status_code == 200
    assert resp.content == b"%PDF-ORIGINAL"
