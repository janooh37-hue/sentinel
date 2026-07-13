# backend/tests/test_notify_api.py
"""API tests for the channel-agnostic /notify routes.

Fixture pattern mirrors test_sms_api.py / test_whatsapp_api.py:
  - api_db  : isolated SQLite DB, session patched, role defaults seeded
  - _user() : creates a User row with the given role
  - _client(): TestClient with DB + auth overrides

Gates:
  - POST /notify/send requires employees.notify  (manager has it, operator does not)
  - GET  /notify/status requires employees.notify
  - POST /notify/{id}/refresh-delivery requires books.manage
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Employee, Leave, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    # Enable both channels so NotifyDisabledError is not raised in happy-path tests.
    monkeypatch.setenv("GSSG_OPENWA_ENABLED", "1")
    monkeypatch.setenv("GSSG_OPENWA_BASE_URL", "http://localhost:3000")
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", "http://192.168.1.50:8080")
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
    from app.config import get_settings

    get_settings.cache_clear()
    db_file = tmp_path / "notify.db"
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
        get_settings.cache_clear()


def _user(db: Session, role: str = "manager", email: str = "m@x.ae") -> User:
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


def _seed_leave(db: Session) -> None:
    db.add(
        Employee(id="G1", name_en="John", name_ar="جون", contact="0501234567", msg_language="en")
    )
    db.add(
        Leave(
            id=7,
            employee_id="G1",
            leave_type="Annual - سنوية",
            start_date=date(2026, 7, 5),
            end_date=date(2026, 7, 9),
            days=5,
            status="Approved",
        )
    )
    db.commit()


# ---------------------------------------------------------------------------
# capability gate tests
# ---------------------------------------------------------------------------


def test_send_requires_capability(api_db: Session) -> None:
    """operator role does NOT have employees.notify → must get 403."""
    _seed_leave(api_db)
    c = _client(api_db, _user(api_db, role="operator", email="op@x.ae"))
    r = c.post("/api/v1/notify/send", json={"event_type": "leave_approved", "record_id": 7})
    assert r.status_code == 403


def test_refresh_delivery_requires_capability(api_db: Session) -> None:
    """operator role does NOT have books.manage → must get 403."""
    c = _client(api_db, _user(api_db, role="operator", email="op2@x.ae"))
    r = c.post("/api/v1/notify/1/refresh-delivery")
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# status endpoint
# ---------------------------------------------------------------------------


def test_status_reports_enabled_flag(api_db: Session) -> None:
    """GET /notify/status returns 200 with 'enabled' + 'last' keys when no send has happened."""
    _seed_leave(api_db)
    c = _client(api_db, _user(api_db))
    r = c.get("/api/v1/notify/status", params={"event_type": "leave_approved", "record_id": 7})
    assert r.status_code == 200
    body = r.json()
    assert "enabled" in body
    assert "last" in body
    # No send yet → last is None; enabled should be True (channels configured in fixture)
    assert body["last"] is None
    assert body["enabled"] is True
