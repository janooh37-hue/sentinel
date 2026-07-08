"""TDD: manage a record's signed copy — replace bytes (keep approval) and unfile
(delete + revert approval state).

Replace covers "I filed the wrong signed scan" without un-approving. Unfile undoes
the scan-back flip: scan-path forms revert to ``awaiting_scan``; a copy filed as
signed on a digital record reopens only the step the flip auto-approved.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import (
    Base,
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    User,
)
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import book_service, perm_service


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


def _user(db: Session, role: str = "manager", email: str | None = None) -> User:
    u = User(email=email or f"{role}@x.ae", password_hash="x", role=role, status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _signed_scanback_book(db: Session, tmp_path, *, template_id: str = "Violation Form") -> Book:
    """A scan-path form flipped to approved by a filed signed copy."""
    (tmp_path / "book_attachments" / "1").mkdir(parents=True, exist_ok=True)
    (tmp_path / "book_attachments" / "1" / "signed-v1.pdf").write_bytes(b"%PDF-SIGNED")
    db.add(BookCategory(id="HR", prefix="HR"))
    db.flush()
    signer = _user(db, email="signer@x.ae")
    book = Book(id=1, category_id="HR", ref_number="HR-1", approval_state="approved")
    db.add(book)
    db.flush()
    db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            status="approved",
            template_id=template_id,
            signed_pdf_path="book_attachments/1/signed-v1.pdf",
            signed_by_user_id=signer.id,
            signed_at=datetime(2026, 7, 8, 10, 0, 0),
        )
    )
    db.commit()
    db.refresh(book)
    return book


def _assigned_signed_book(db: Session, tmp_path) -> Book:
    """A digital (in_app) record with one human approval + one flip approval,
    filed as signed via as_signed=true. flip_at == version.signed_at."""
    (tmp_path / "book_attachments" / "1").mkdir(parents=True, exist_ok=True)
    (tmp_path / "book_attachments" / "1" / "signed-v1.pdf").write_bytes(b"%PDF-SIGNED")
    db.add(BookCategory(id="HR", prefix="HR"))
    db.flush()
    approver = _user(db, email="appr@x.ae")
    flip_at = datetime(2026, 7, 8, 10, 0, 0)
    earlier = flip_at - timedelta(hours=2)
    book = Book(id=1, category_id="HR", ref_number="HR-1", approval_state="approved")
    db.add(book)
    db.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        status="approved",
        template_id="Material Request Form",
        signed_pdf_path="book_attachments/1/signed-v1.pdf",
        signed_by_user_id=approver.id,
        signed_at=flip_at,
    )
    db.add(version)
    db.flush()
    # step 1: approved earlier by a human (decided_at != flip_at) -> must stay approved
    db.add(
        BookApprovalStep(
            book_id=book.id,
            version_id=version.id,
            step_order=1,
            stage_label="Reviewer",
            assignee_user_id=approver.id,
            state="approved",
            kind="approver",
            decided_at=earlier,
        )
    )
    # step 2: approved by the scan flip (decided_at == flip_at) -> must reopen
    db.add(
        BookApprovalStep(
            book_id=book.id,
            version_id=version.id,
            step_order=2,
            stage_label="Manager",
            assignee_user_id=approver.id,
            state="approved",
            kind="approver",
            decided_at=flip_at,
        )
    )
    db.commit()
    db.refresh(book)
    return book


# ---------------------------------------------------------------------------
# Task 4 — replace signed copy (keep approval)
# ---------------------------------------------------------------------------


def test_replace_signed_copy_swaps_bytes_keeps_approved(api_db, tmp_path) -> None:
    book = _signed_scanback_book(api_db, tmp_path)
    user = _user(api_db, email="mgr2@x.ae")
    book_service.replace_signed_copy(api_db, book.id, "fixed.pdf", b"%PDF-FIXED", user=user)
    api_db.refresh(book)
    v = book.versions[-1]
    assert book.approval_state == "approved"
    assert v.signed_pdf_path is not None
    assert (tmp_path / v.signed_pdf_path).read_bytes() == b"%PDF-FIXED"


def test_replace_signed_copy_route(api_db, tmp_path) -> None:
    _signed_scanback_book(api_db, tmp_path)
    c = _client(api_db, _user(api_db, email="mgr3@x.ae"))
    resp = c.put(
        "/api/v1/books/1/signed-copy",
        files={"file": ("fixed.pdf", b"%PDF-FIXED", "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["approval_state"] == "approved"
