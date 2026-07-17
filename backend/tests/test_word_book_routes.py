"""TDD: Task 6 — classifications list + word-session route + BookRead additions.

RED → implement → GREEN.
"""

from __future__ import annotations

import secrets
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, BookCategory, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "routes.db"
    eng = create_engine(
        f"sqlite:///{db_file}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    yield db
    db.close()


def _make_user(db: Session, role: str = "operator", email: str | None = None) -> User:
    u = User(
        email=email or f"{secrets.token_hex(4)}@test.ae",
        password_hash="x",
        role=role,
        status="active",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _client(db: Session, user: User, monkeypatch, tmp_path: Path) -> TestClient:
    """Build a test client wired to db + user, with settings pointing at tmp_path."""
    from app.config import Settings
    from app.services import word_book_service

    settings = Settings(
        data_dir=tmp_path / "data",
        templates_dir=tmp_path / "templates",
    )
    # Place both templates so any classification create doesn't fail on TEMPLATE_MISSING
    (tmp_path / "templates").mkdir(parents=True, exist_ok=True)
    _write_minimal_docx(tmp_path / "templates" / "GSSG-GS_301-001_Classified_Standard.docx")
    _write_minimal_docx(tmp_path / "templates" / "GSSG-GS_300-003_General_Book.docx")

    monkeypatch.setattr(word_book_service, "get_settings", lambda: settings)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _write_minimal_docx(path: Path) -> None:
    import docx as _docx

    doc = _docx.Document()
    doc.add_paragraph("{{ ref }}")
    doc.add_paragraph("{{ subject }}")
    doc.add_paragraph("{{ recipient_name }}")
    doc.add_paragraph("{{ cc }}")
    doc.add_paragraph("{{ manager_name }}")
    doc.add_paragraph("{{ manager_title }}")
    doc.add_paragraph("{{ submitter_g }}")
    doc.add_paragraph("{{ date }}")
    doc.save(str(path))


def _seed_gs(db: Session) -> None:
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.commit()


# ---------------------------------------------------------------------------
# GET /books/classifications
# ---------------------------------------------------------------------------


def test_classifications_returns_15_items(api_db, monkeypatch, tmp_path):
    user = _make_user(api_db)
    c = _client(api_db, user, monkeypatch, tmp_path)
    resp = c.get("/api/v1/books/classifications")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "items" in body
    assert len(body["items"]) == 15


def test_classifications_shape(api_db, monkeypatch, tmp_path):
    user = _make_user(api_db)
    c = _client(api_db, user, monkeypatch, tmp_path)
    items = c.get("/api/v1/books/classifications").json()["items"]
    first = items[0]
    assert set(first.keys()) >= {"code", "tab", "name_ar", "name_en", "unit_ar"}


def test_classifications_requires_auth(api_db, monkeypatch, tmp_path):
    """Unauthenticated (anon) user gets 401. We test this by overriding to None."""
    from app.api.deps import get_optional_user

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_optional_user] = lambda: None
    c = TestClient(app, raise_server_exceptions=True)
    resp = c.get("/api/v1/books/classifications")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /books/word-sessions
# ---------------------------------------------------------------------------


def test_post_word_session_returns_201(api_db, monkeypatch, tmp_path):
    _seed_gs(api_db)
    user = _make_user(api_db, role="manager")
    c = _client(api_db, user, monkeypatch, tmp_path)
    resp = c.post(
        "/api/v1/books/word-sessions",
        json={"classification_code": "5/1", "subject": "Security permit test"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["word_url"].startswith("ms-word:ofe|u|")
    assert body["book_id"] is not None
    assert body["ref_number"]
    assert body["token"]
    assert body["filename"].endswith(".docx")
    assert body["dav_url"]


def test_post_word_session_plain_no_classification(api_db, monkeypatch, tmp_path):
    _seed_gs(api_db)
    user = _make_user(api_db, role="manager")
    c = _client(api_db, user, monkeypatch, tmp_path)
    resp = c.post(
        "/api/v1/books/word-sessions",
        json={"classification_code": None, "subject": "Plain book"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["ref_number"].startswith("GS-")


def test_post_word_session_requires_books_manage(api_db, monkeypatch, tmp_path):
    """Plain operator (no books.manage) → 403."""
    _seed_gs(api_db)
    user = _make_user(api_db, role="operator")
    c = _client(api_db, user, monkeypatch, tmp_path)
    resp = c.post(
        "/api/v1/books/word-sessions",
        json={"classification_code": "5/1", "subject": "Should fail"},
    )
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# BookRead additions: is_draft + classification_code + edit_session
# ---------------------------------------------------------------------------


def test_book_read_draft_fields(api_db, monkeypatch, tmp_path):
    """New word-session book has is_draft=True, classification_code set, edit_session set."""
    _seed_gs(api_db)
    user = _make_user(api_db, role="manager")
    c = _client(api_db, user, monkeypatch, tmp_path)

    # Create a word-session book
    create_resp = c.post(
        "/api/v1/books/word-sessions",
        json={"classification_code": "5/1", "subject": "Draft test"},
    )
    assert create_resp.status_code == 201, create_resp.text
    book_id = create_resp.json()["book_id"]

    # Fetch via GET /books/{id}
    # Need books.view permission — give user admin role which has all caps
    admin_user = _make_user(api_db, role="admin", email="admin@test.ae")
    c2 = _client(api_db, admin_user, monkeypatch, tmp_path)
    detail = c2.get(f"/api/v1/books/{book_id}").json()

    assert detail["is_draft"] is True
    assert detail["classification_code"] == "5/1"
    assert detail["voided_at"] is None
    assert detail["edit_session"] is not None
    assert detail["edit_session"]["user_id"] == user.id
    assert detail["edit_session"]["state"] == "active"
