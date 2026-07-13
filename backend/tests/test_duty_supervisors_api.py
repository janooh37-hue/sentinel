"""Duty-supervisor mappings API tests."""

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
from app.services import perm_service

# ---------------------------------------------------------------------------
# Fixtures — mirrors test_managers_api.py pattern
# ---------------------------------------------------------------------------


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "duty_supervisors.db"
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
    return _client(api_db, _user(api_db, role="admin", email="admin_ds@x.ae"))


@pytest.fixture()
def client(api_db) -> TestClient:
    return _client(api_db, _user(api_db, role="manager", email="mgr_ds@x.ae"))


# ---------------------------------------------------------------------------
# API tests
# ---------------------------------------------------------------------------


def test_create_list_delete_mapping(admin_client):
    r = admin_client.post(
        "/api/v1/duty-supervisors/",
        json={"duty_unit": "السرية الأولى", "recipient_duty_post": "مسؤول سرية"},
    )
    assert r.status_code == 201, r.text
    mid = r.json()["id"]

    r = admin_client.get("/api/v1/duty-supervisors/")
    assert r.status_code == 200
    assert any(m["id"] == mid for m in r.json())

    r = admin_client.delete(f"/api/v1/duty-supervisors/{mid}")
    assert r.status_code == 204
    assert all(m["id"] != mid for m in admin_client.get("/api/v1/duty-supervisors/").json())


def test_create_requires_settings_edit(client):
    # `client` = manager role does NOT have settings.edit -> 403
    r = client.post(
        "/api/v1/duty-supervisors/",
        json={"duty_unit": "x", "recipient_duty_post": "y"},
    )
    assert r.status_code in (401, 403)
