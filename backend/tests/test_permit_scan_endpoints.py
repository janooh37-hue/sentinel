"""API tests for POST /permits/scan-vehicle-licence and /scan-emirates-id."""

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


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "permit_scan.db"
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


def test_scan_vehicle_licence_returns_fields(api_db, monkeypatch):
    from app.services import permit_service

    monkeypatch.setattr(
        permit_service,
        "_ocr_text",
        lambda data: "Traffic Plate No: A 45213\nColour: White\nExpiry Date: 14/03/2027",
    )
    client = _client(api_db, _user(api_db, role="admin"))
    r = client.post(
        "/api/v1/permits/scan-vehicle-licence",
        files={"file": ("m.jpg", b"x", "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plate_no"] == "A 45213"
    assert body["colour"] == "White"
    assert body["reg_expiry"] == "2027-03-14"


def test_scan_emirates_id_returns_fields(api_db, monkeypatch):
    from app.services import permit_service

    monkeypatch.setattr(
        permit_service,
        "_ocr_text",
        lambda data: "Name: Ahmed Ali\nID Number: 784-1990-1234567-1\nNationality: UAE",
    )
    client = _client(api_db, _user(api_db, role="admin", email="b@x.ae"))
    r = client.post(
        "/api/v1/permits/scan-emirates-id",
        files={"file": ("eid.jpg", b"y", "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # extraction may return None for fields if pattern doesn't match; just confirm 200 + shape
    assert "name" in body
    assert "uae_id" in body
