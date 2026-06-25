# backend/tests/test_set_permission_expiry_api.py
"""API tests for the expires_at field on PUT /auth/users/{id}/permissions (Task 14a).

Two scenarios:
  1. Admin PUTs with expires_at → stored UserPermission.expires_at matches.
  2. Admin PUTs without expires_at → permanent grant (expires_at is None).
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, User, UserPermission
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service


# ─── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    """Temp-file SQLite session shared across threads (mirrors test_permissions_api.py)."""
    db_file = tmp_path / "test_expiry_api.db"
    eng = create_engine(
        f"sqlite:///{db_file}",
        future=True,
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


def _make_user(db: Session, *, role: str = "operator", email: str = "u@x.ae") -> User:
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


# ─── tests ────────────────────────────────────────────────────────────────────


def test_put_permission_with_expires_at_stores_expiry(api_db):
    """Admin sets a time-limited grant; stored row has the matching expires_at."""
    admin = _make_user(api_db, role="admin", email="admin@x.ae")
    op = _make_user(api_db, role="operator", email="op@x.ae")

    future_dt = datetime(2030, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    c = _client(api_db, admin)
    r = c.put(
        f"/api/v1/auth/users/{op.id}/permissions",
        json={
            "capability": "leaves.edit",
            "effect": "grant",
            "expires_at": future_dt.isoformat(),
        },
    )
    assert r.status_code == 200, r.text

    # Verify the DB row has expires_at set
    api_db.expire_all()
    row = api_db.get(UserPermission, (op.id, "leaves.edit"))
    assert row is not None, "UserPermission row was not created"
    assert row.expires_at is not None, "expires_at should be set, got None"
    # Compare as naive UTC (SQLite stores without tz)
    stored = row.expires_at
    if stored.tzinfo is not None:
        stored = stored.replace(tzinfo=None)
    expected_naive = future_dt.replace(tzinfo=None)
    assert stored == expected_naive, f"Expected {expected_naive}, got {stored}"


def test_put_permission_without_expires_at_is_permanent(api_db):
    """Admin sets a grant without expires_at; stored row has expires_at = None."""
    admin = _make_user(api_db, role="admin", email="admin2@x.ae")
    op = _make_user(api_db, role="operator", email="op2@x.ae")

    c = _client(api_db, admin)
    r = c.put(
        f"/api/v1/auth/users/{op.id}/permissions",
        json={"capability": "leaves.edit", "effect": "grant"},
    )
    assert r.status_code == 200, r.text

    api_db.expire_all()
    row = api_db.get(UserPermission, (op.id, "leaves.edit"))
    assert row is not None, "UserPermission row was not created"
    assert row.expires_at is None, f"Expected None for permanent grant, got {row.expires_at}"
