# backend/tests/test_passport_upload_hook.py
"""Upload hook tests for Task 6.

After a passport vault upload, the OCR hook should auto-fill passport_no.
For non-passport uploads, extract_passport_for_employee must not be called.

Auth pattern mirrors test_passport_extract_endpoint.py: temp-file SQLite DB
(cross-thread safe), override get_db + get_current_user, manager role for
employees.edit capability.
"""

from __future__ import annotations

import io

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
    db_file = tmp_path / "test_passport_upload_hook.db"
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


def test_passport_upload_autofills_on_mrz(api_db, monkeypatch):
    emp = Employee(id="G8100", name_en="Upload", status="Active")
    api_db.add(emp)
    api_db.commit()

    monkeypatch.setattr(
        svc,
        "extract_passport_for_employee",
        lambda db, g: svc.PassportExtractResult("N1234567", 0.95, "mrz", None, "pp.pdf"),
    )

    user = _manager_user(api_db)
    client = _client(api_db, user)
    files = {"file": ("pp.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")}
    r = client.post(
        "/api/v1/employees/G8100/vault/upload",
        data={"kind": "passport"},
        files=files,
    )
    assert r.status_code in (200, 201), r.text
    api_db.refresh(emp)
    assert emp.passport_no == "N1234567"
    assert emp.passport_no_source == "mrz"


def test_non_passport_upload_does_not_autofill(api_db, monkeypatch):
    emp = Employee(id="G8101", name_en="Upload2", status="Active")
    api_db.add(emp)
    api_db.commit()

    called = {"n": 0}
    monkeypatch.setattr(
        svc,
        "extract_passport_for_employee",
        lambda db, g: called.__setitem__("n", called["n"] + 1),
    )

    user = _manager_user(api_db, email="mgr2@x.ae")
    client = _client(api_db, user)
    files = {"file": ("id.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")}
    r = client.post(
        "/api/v1/employees/G8101/vault/upload",
        data={"kind": "uae_id"},
        files=files,
    )
    assert r.status_code in (200, 201), r.text
    assert called["n"] == 0
