# backend/tests/test_sms_api.py
"""API tests for SMS notification routes — mirrors test_whatsapp_api.py structure.

Fixtures follow the exact pattern used by test_whatsapp_api.py:
  - api_db  : creates an isolated SQLite DB, patches session_mod, seeds role defaults
  - _user() : creates a User row with the given role
  - _client(): builds a TestClient with DB + auth overrides

client_with_notify  → _client(api_db, _user(api_db, role="manager"))
client_without_notify → _client(api_db, _user(api_db, role="operator", email="op@x.ae"))
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
from app.services import perm_service, sms_client


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", "http://192.168.1.50:8080")
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
    from app.config import get_settings
    get_settings.cache_clear()
    db_file = tmp_path / "sms.db"
    eng = create_engine(
        f"sqlite:///{db_file}", future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(
        bind=eng, autoflush=False, expire_on_commit=False, future=True
    )
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()
        get_settings.cache_clear()


def _user(db, role="manager", email="m@x.ae"):
    u = User(email=email, password_hash="x", role=role, status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _client(db, user):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _seed_leave(db):
    db.add(Employee(id="G1", name_en="John", name_ar="جون",
                    contact="0501234567", msg_language="en"))
    db.add(Leave(id=7, employee_id="G1", leave_type="Annual - سنوية",
                 start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5,
                 status="Approved"))
    db.commit()


def test_send_requires_capability(api_db):
    _seed_leave(api_db)
    # operator role does NOT have employees.notify
    c = _client(api_db, _user(api_db, role="operator", email="op@x.ae"))
    resp = c.post(
        "/api/v1/sms/send", json={"event_type": "leave_approved", "record_id": 7}
    )
    assert resp.status_code == 403


def test_send_happy_path(api_db, monkeypatch):
    _seed_leave(api_db)
    monkeypatch.setattr(
        sms_client, "send",
        lambda *a, **k: sms_client.SendResult(ok=True, message_id="sms-1"),
    )
    c = _client(api_db, _user(api_db))
    resp = c.post(
        "/api/v1/sms/send", json={"event_type": "leave_approved", "record_id": 7}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "sent"
    assert body["message_id"] == "sms-1"


def test_status_reports_enabled_and_last(api_db, monkeypatch):
    _seed_leave(api_db)
    monkeypatch.setattr(
        sms_client, "send",
        lambda *a, **k: sms_client.SendResult(ok=True, message_id="sms-1"),
    )
    c = _client(api_db, _user(api_db))
    c.post(
        "/api/v1/sms/send", json={"event_type": "leave_approved", "record_id": 7}
    )
    resp = c.get(
        "/api/v1/sms/status",
        params={"event_type": "leave_approved", "record_id": 7},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is True
    assert body["last"]["status"] == "sent"


def test_send_disabled_returns_409(api_db, monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "0")
    from app.config import get_settings
    get_settings.cache_clear()
    _seed_leave(api_db)
    c = _client(api_db, _user(api_db))
    resp = c.post(
        "/api/v1/sms/send", json={"event_type": "leave_approved", "record_id": 7}
    )
    assert resp.status_code == 409


def test_send_missing_record_returns_404(api_db):
    c = _client(api_db, _user(api_db))
    resp = c.post(
        "/api/v1/sms/send", json={"event_type": "leave_approved", "record_id": 9999}
    )
    assert resp.status_code == 404
