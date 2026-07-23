"""TDD: POST /books/reports endpoint.

RED → add endpoint → GREEN.

Fixture pattern mirrors test_book_template_routes_m4.py (self-contained DB +
client, no global conftest dependency). The PDF chain and get_settings are
stubbed so Word COM is never invoked.
"""

from __future__ import annotations

import secrets
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, BookCategory, Employee, Submitter, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import document_service, perm_service, report_service

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_sig_png(path: Path) -> Path:
    """A minimal valid PNG with real ink so DocxEngine can embed it."""
    img = Image.new("RGBA", (400, 168), (255, 255, 255, 0))
    for x in range(40, 360):
        y = 20 + int((x - 40) * 120 / 320)
        for dy in (-1, 0, 1):
            img.putpixel((x, y + dy), (0, 0, 0, 255))
    img.save(path)
    return path


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def api_db(monkeypatch, tmp_path: Path) -> Session:
    db_file = tmp_path / "reports_api.db"
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
    # GS category required by report_service
    db.add(BookCategory(id="GS", prefix="GS"))
    db.commit()
    yield db
    db.close()


@pytest.fixture()
def report_env(api_db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Wire settings stubs so the render pipeline works without Word COM.

    Points both report_service.get_settings and document_service.get_settings
    at the same tmp Settings (data_dir = tmp; templates_dir = real
    backend/templates so report.docx is found). Stubs convert_docx_to_pdf
    → None.
    """
    from app.config import Settings
    from app.core.constants import TEMPLATE_FILES  # confirm "Report" key exists

    assert "Report" in TEMPLATE_FILES, "TEMPLATE_FILES missing 'Report' — check Task 1"

    # Real templates dir (read-only; output goes to data_dir)
    real_templates = Path(__file__).parent.parent / "templates"

    settings = Settings(
        data_dir=tmp_path / "data",
        templates_dir=real_templates,
    )
    monkeypatch.setattr(report_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(report_service, "convert_docx_to_pdf", lambda p: None)

    return api_db, tmp_path


def _make_user(db: Session, role: str = "admin") -> User:
    u = User(
        email=f"{secrets.token_hex(4)}@test.ae",
        password_hash="x",
        role=role,
        status="active",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _make_client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_post_reports_creates_signed_report(report_env, tmp_path: Path):
    db, _ = report_env
    user = _make_user(db)

    # Seed employee G1042 with a signature image
    sig_path = tmp_path / "sig.png"
    _make_sig_png(sig_path)

    db.add(Employee(id="G1042", name_ar="محمد أحمد", name_en="Mohammed Ahmed"))
    db.add(
        Submitter(
            employee_id="G1042",
            name="Mohammed Ahmed",
            stored_sig_path=str(sig_path),
        )
    )
    db.commit()

    client = _make_client(db, user)
    resp = client.post(
        "/api/v1/books/reports",
        headers={},
        json={
            "signer_employee_id": "G1042",
            "recipient_id": None,
            "subject": "النزيل محمد",
            "date": "23-07-2026",
            "body_html": "<p>نص التقرير</p>",
            "sign": True,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["classification_code"] is None
    assert body["ref_number"].startswith("REPORT-")
    assert body["current_template_id"] == "Report"


def test_post_reports_requires_books_manage(report_env, tmp_path: Path):
    """operator role has no books.manage → 403."""
    db, _ = report_env
    user = _make_user(db, role="operator")
    client = _make_client(db, user)
    resp = client.post(
        "/api/v1/books/reports",
        json={
            "signer_employee_id": "G9999",
            "subject": "test",
            "body_html": "<p>body</p>",
        },
    )
    assert resp.status_code == 403


def test_post_reports_unknown_employee_404(report_env):
    db, _ = report_env
    user = _make_user(db)
    client = _make_client(db, user)
    resp = client.post(
        "/api/v1/books/reports",
        json={
            "signer_employee_id": "GHOST",
            "subject": "test",
            "body_html": "<p>body</p>",
        },
    )
    assert resp.status_code == 404
