# backend/tests/test_passport_extract_endpoint.py
"""API tests for POST /api/v1/employees/{employee_id}/passport/extract (Task 5).

Auth pattern: override get_db + get_current_user so require_capability can
resolve a real manager user (managers have employees.edit by default).
Uses a temp-file SQLite DB so the ASGI worker thread shares the same tables.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Employee, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import passport_ocr_service as svc
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    """Temp-file SQLite session accessible from the ASGI worker thread."""
    db_file = tmp_path / "test_passport_extract.db"
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


def _manager_user(db: Session, email: str = "mgr@x.ae") -> User:
    u = User(email=email, password_hash="x", role="manager", status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def test_extract_endpoint_returns_suggestion_without_writing(api_db, monkeypatch):
    emp = Employee(id="G8001", name_en="Endpoint", status="Active")
    api_db.add(emp)
    api_db.commit()

    monkeypatch.setattr(
        svc,
        "extract_passport_for_employee",
        lambda db, g: svc.PassportExtractResult("N1234567", 0.95, "mrz", None, "pp.pdf"),
    )

    user = _manager_user(api_db)
    c = _client(api_db, user)
    r = c.post("/api/v1/employees/G8001/passport/extract")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["number"] == "N1234567" and body["method"] == "mrz"

    api_db.refresh(emp)
    assert emp.passport_no is None  # endpoint never writes


def test_extract_endpoint_404_when_no_scan(api_db, monkeypatch):
    emp = Employee(id="G8002", name_en="NoScan", status="Active")
    api_db.add(emp)
    api_db.commit()

    monkeypatch.setattr(svc, "extract_passport_for_employee", lambda db, g: None)

    user = _manager_user(api_db, email="mgr2@x.ae")
    c = _client(api_db, user)
    r = c.post("/api/v1/employees/G8002/passport/extract")
    assert r.status_code == 404, r.text
