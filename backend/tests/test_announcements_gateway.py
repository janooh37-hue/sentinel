"""Gateway status + QR endpoints — TDD tests for /announcements/status and /announcements/qr."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import openwa_client, perm_service

# ---------------------------------------------------------------------------
# Fixtures — mirrors test_announcements_api.py
# ---------------------------------------------------------------------------


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "announcements_gw.db"
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
    try:
        yield db
    finally:
        db.close()


def _user(db: Session, role: str = "admin", email: str = "a@x.ae") -> User:
    u = User(email=email, password_hash="x", role=role, status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def admin_client(api_db) -> TestClient:
    return _client(api_db, _user(api_db, role="admin", email="admin_gw@x.ae"))


@pytest.fixture()
def client(api_db) -> TestClient:
    return _client(api_db, _user(api_db, role="manager", email="mgr_gw@x.ae"))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_status(admin_client, monkeypatch):
    monkeypatch.setattr(openwa_client, "session_state", lambda: "connected")
    r = admin_client.get("/api/v1/announcements/status")
    assert r.status_code == 200 and r.json() == {"state": "connected"}


def test_qr_admin_only(admin_client, monkeypatch):
    monkeypatch.setattr(openwa_client, "fetch_qr", lambda: "data:image/png;base64,AAAA")
    r = admin_client.get("/api/v1/announcements/qr")
    assert r.status_code == 200 and r.json()["qr"].startswith("data:image")


def test_qr_requires_settings_edit(client):
    # `client` = manager role (has neither messages.broadcast nor settings.edit)
    r = client.get("/api/v1/announcements/qr")
    assert r.status_code in (401, 403)
