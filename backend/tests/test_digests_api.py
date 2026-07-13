"""Digest API tests — preview + send routes (Phase 2b Task 10)."""

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
from app.services import duty_supervisor_service as dsv
from app.services import perm_service

# ---------------------------------------------------------------------------
# Fixtures — mirrors test_duty_supervisors_api.py pattern (shared-session)
# ---------------------------------------------------------------------------


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "digests.db"
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


# Alias so test functions can use the name from the brief's spec.
@pytest.fixture()
def db_session(api_db: Session) -> Session:
    return api_db


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
def admin_client(api_db: Session) -> TestClient:
    return _client(api_db, _user(api_db, role="admin", email="admin_dig@x.ae"))


@pytest.fixture()
def client(api_db: Session) -> TestClient:
    return _client(api_db, _user(api_db, role="manager", email="mgr_dig@x.ae"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed(db: Session) -> None:
    dsv.add_mapping(db, "السرية الأولى", "مسؤول سرية")
    db.add(
        Employee(
            id="SUP",
            name_ar="س",
            name_en="Sup",
            status="Active",
            duty_unit="السرية الأولى",
            duty_post="مسؤول سرية",
            contact="0501112222",
            msg_language="ar",
        )
    )
    db.add(
        Employee(
            id="EMP",
            name_ar="ع",
            name_en="Emp",
            status="Active",
            duty_unit="السرية الأولى",
            duty_post="جندي",
            contact="0503334444",
            msg_language="ar",
        )
    )
    today = date.today()
    db.add(
        Leave(
            id=1,
            employee_id="EMP",
            leave_type="annual leave",
            start_date=today.replace(day=1),
            end_date=today.replace(day=1),
            status="Approved",
            days=1,
        )
    )
    db.commit()


# ---------------------------------------------------------------------------
# API tests
# ---------------------------------------------------------------------------


def test_preview_reports_count(admin_client: TestClient, db_session: Session) -> None:
    _seed(db_session)
    r = admin_client.get(
        "/api/v1/digests/leave/preview",
        params={"duty_unit": "السرية الأولى"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 1
    assert "السرية الأولى" in body["sample_ar"]


def test_send_all_returns_result(
    admin_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Enable a channel + stub the transport so no real send happens.
    from app.services import notify_dispatch

    monkeypatch.setattr(
        notify_dispatch,
        "get_settings",
        lambda: __import__("types").SimpleNamespace(
            openwa_enabled=False, sms_enabled=True, sms_country_code="971"
        ),
    )
    monkeypatch.setattr(
        notify_dispatch.sms_client,
        "send",
        lambda p, b: __import__("types").SimpleNamespace(ok=True, message_id="m", error=None),
    )
    _seed(db_session)
    r = admin_client.post(
        "/api/v1/digests/leave/send",
        json={"duty_unit": "السرية الأولى"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["sent"] == 1


def test_send_requires_settings_edit(client: TestClient) -> None:
    r = client.post("/api/v1/digests/leave/send", json={"duty_unit": None})
    assert r.status_code in (401, 403)
