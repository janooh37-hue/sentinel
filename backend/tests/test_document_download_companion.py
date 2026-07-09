"""TDD: downloading a primary document's PDF appends its companion pages so the
record shows ONE merged PDF (form + Leave Undertaking), not separate papers.

The annual-leave companion is a separate Document sharing the primary's
submission_id. Rather than render it as a standalone paper, the download endpoint
merges companion PDF pages onto the end of the primary's served PDF.
"""

from __future__ import annotations

import fitz
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


def _pdf(path, n_pages: int) -> None:
    doc = fitz.open()
    for _ in range(n_pages):
        doc.new_page()
    doc.save(str(path))
    doc.close()


def _primary_with_companion(
    db: Session, tmp_path, *, comp_pages: int = 1
) -> tuple[Document, Document]:
    (tmp_path / "documents").mkdir(exist_ok=True)
    _pdf(tmp_path / "documents" / "primary.pdf", 2)
    _pdf(tmp_path / "documents" / "companion.pdf", comp_pages)
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
    )
    db.add_all([primary, companion])
    db.flush()
    db.add(BookVersion(book_id=book.id, version_no=1, status="approved", document_id=primary.id))
    db.commit()
    return primary, companion


def test_original_pdf_merges_companion_pages(api_db, tmp_path) -> None:
    primary, _companion = _primary_with_companion(api_db, tmp_path, comp_pages=1)
    c = _client(api_db, _user(api_db))

    resp = c.get(f"/api/v1/documents/{primary.id}/download?format=pdf&original=true")

    assert resp.status_code == 200
    merged = fitz.open("pdf", resp.content)
    assert merged.page_count == 3  # 2 primary + 1 companion


def test_companion_download_is_not_recursive(api_db, tmp_path) -> None:
    """Downloading the companion itself serves only its own page(s)."""
    _primary, companion = _primary_with_companion(api_db, tmp_path, comp_pages=1)
    c = _client(api_db, _user(api_db))

    resp = c.get(f"/api/v1/documents/{companion.id}/download?format=pdf&original=true")

    assert resp.status_code == 200
    assert fitz.open("pdf", resp.content).page_count == 1
