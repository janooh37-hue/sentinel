# backend/tests/test_whatsapp_api.py
"""API tests — mount prefix /api/v1; auth + db overridden like test_permissions_api."""
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
from app.services import perm_service, whatsapp_client


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    monkeypatch.setenv("GSSG_WHATSAPP_ENABLED", "1")
    monkeypatch.setenv("GSSG_WHATSAPP_TOKEN", "tok")
    monkeypatch.setenv("GSSG_WHATSAPP_PHONE_NUMBER_ID", "PNID")
    from app.config import get_settings
    get_settings.cache_clear()
    db_file = tmp_path / "wa.db"
    eng = create_engine(f"sqlite:///{db_file}", future=True,
                        connect_args={"check_same_thread": False})
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False,
                              expire_on_commit=False, future=True)
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
    db.add(u); db.commit(); db.refresh(u)
    return u


def _client(db, user):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _leave(db):
    db.add(Employee(id="G1", name_en="John", name_ar="جون",
                    contact="0501234567", msg_language="ar"))
    db.add(Leave(id=7, employee_id="G1", leave_type="Annual - سنوية",
                 start_date=date(2026, 7, 5), end_date=date(2026, 7, 9),
                 days=5, status="Approved"))
    db.commit()


def test_send_returns_sent(api_db, monkeypatch):
    _leave(api_db)
    monkeypatch.setattr(whatsapp_client, "send_text",
                        lambda *a, **k: whatsapp_client.SendResult(ok=True, message_id="wamid.1"))
    c = _client(api_db, _user(api_db))
    r = c.post("/api/v1/whatsapp/send",
               json={"event_type": "leave_approved", "record_id": 7})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "sent"
    # status endpoint now reflects it
    s = c.get("/api/v1/whatsapp/status",
              params={"event_type": "leave_approved", "record_id": 7})
    assert s.json()["last"]["status"] == "sent"


def test_send_requires_capability(api_db, monkeypatch):
    _leave(api_db)
    c = _client(api_db, _user(api_db, role="operator", email="op@x.ae"))
    r = c.post("/api/v1/whatsapp/send",
               json={"event_type": "leave_approved", "record_id": 7})
    assert r.status_code == 403


def test_send_unknown_record_404(api_db):
    c = _client(api_db, _user(api_db))
    r = c.post("/api/v1/whatsapp/send",
               json={"event_type": "leave_approved", "record_id": 9999})
    assert r.status_code == 404


def test_status_null_when_never_sent(api_db):
    _leave(api_db)
    c = _client(api_db, _user(api_db))
    s = c.get("/api/v1/whatsapp/status",
              params={"event_type": "leave_approved", "record_id": 7})
    assert s.status_code == 200
    assert s.json()["last"] is None
