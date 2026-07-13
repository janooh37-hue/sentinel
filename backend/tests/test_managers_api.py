"""Manager management API + schema tests."""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.schemas.manager import ManagerCreate, ManagerUpdate
from app.services import manager_service, perm_service

# ---------------------------------------------------------------------------
# Schema / unit tests (pre-existing — Tasks 1 & 2)
# ---------------------------------------------------------------------------


def test_manager_create_requires_a_name():
    with pytest.raises(ValidationError):
        ManagerCreate(name_en="  ", name_ar=None, title="HR Director")


def test_manager_create_accepts_arabic_only_name():
    m = ManagerCreate(name_en=None, name_ar="مدير", title=None)
    assert m.name_ar == "مدير"
    assert m.active is True


def test_create_then_update_and_soft_delete(db_session):
    mgr = manager_service.create_manager(
        db_session, ManagerCreate(name_en="Ada Lovelace", title="Director")
    )
    assert mgr.id is not None
    assert mgr.active is True

    manager_service.update_manager(db_session, mgr.id, ManagerUpdate(title="Chief Director"))
    assert db_session.get(type(mgr), mgr.id).title == "Chief Director"
    # name untouched by partial patch
    assert db_session.get(type(mgr), mgr.id).name_en == "Ada Lovelace"

    manager_service.update_manager(db_session, mgr.id, ManagerUpdate(active=False))
    active = manager_service.list_managers(db_session)
    assert all(m.id != mgr.id for m in active)
    allm = manager_service.list_managers(db_session, include_inactive=True)
    assert any(m.id == mgr.id for m in allm)


# ---------------------------------------------------------------------------
# API fixtures (Task 3) — mirrors test_sms_api.py pattern
# ---------------------------------------------------------------------------


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "managers.db"
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


# ---------------------------------------------------------------------------
# API tests (Task 3)
# ---------------------------------------------------------------------------


def test_create_manager_via_api(api_db):
    c = _client(api_db, _user(api_db))
    resp = c.post("/api/v1/managers", json={"name_en": "Grace Hopper", "title": "Admiral"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name_en"] == "Grace Hopper"
    assert body["has_signature"] is False

    # deactivated manager is excluded from default list
    mid = body["id"]
    assert c.patch(f"/api/v1/managers/{mid}", json={"active": False}).status_code == 200
    listed = c.get("/api/v1/managers").json()
    assert all(m["id"] != mid for m in listed)


def test_create_manager_requires_capability(api_db):
    # manager role does NOT have settings.edit -> 403
    c = _client(api_db, _user(api_db, role="manager", email="mgr@x.ae"))
    resp = c.post("/api/v1/managers", json={"name_en": "X"})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Signature routes (Task 4)
# ---------------------------------------------------------------------------

_PNG_1x1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


@pytest.fixture()
def admin_client(api_db) -> TestClient:
    return _client(api_db, _user(api_db, role="admin", email="admin_sig@x.ae"))


def test_manager_signature_roundtrip(admin_client):
    mid = admin_client.post("/api/v1/managers", json={"name_en": "Sig Boss"}).json()["id"]

    up = admin_client.post(
        f"/api/v1/managers/{mid}/signature",
        files={"file": ("sig.png", _PNG_1x1, "image/png")},
    )
    assert up.status_code == 201, up.text
    assert admin_client.get("/api/v1/managers").json()  # sanity

    got = admin_client.get(f"/api/v1/managers/{mid}/signature?encoding=base64")
    assert got.status_code == 200 and got.text.strip()

    assert admin_client.delete(f"/api/v1/managers/{mid}/signature").status_code == 204
    assert admin_client.get(f"/api/v1/managers/{mid}/signature").status_code == 404
