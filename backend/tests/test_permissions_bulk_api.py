# backend/tests/test_permissions_bulk_api.py
"""Bulk override endpoint: PUT /auth/users/{id}/permissions/bulk.

All-or-nothing batch of per-user override changes: every item is validated
(known capability, valid effect, no sensitive grants, not self-targeted)
BEFORE any row is written, so a bad item refuses the whole batch.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.main import create_app
from app.services import perm_service


def _user(db: Session, role: str, email: str) -> User:
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


def test_bulk_set_and_clear_overrides(api_db):
    admin = _user(api_db, "admin", "ad@x.ae")
    target = _user(api_db, "manager", "tgt@x.ae")
    c = _client(api_db, admin)
    r = c.put(
        f"/api/v1/auth/users/{target.id}/permissions/bulk",
        json={
            "items": [
                {"capability": "books.delete", "effect": "deny"},
                {"capability": "books.override_state", "effect": "grant"},
                {"capability": "permits.revoke", "effect": None},
            ]
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["overrides"]["books.delete"] == "deny"
    assert data["overrides"]["books.override_state"] == "grant"
    assert "permits.revoke" not in data["overrides"]


def test_bulk_is_all_or_nothing(api_db):
    admin = _user(api_db, "admin", "ad2@x.ae")
    target = _user(api_db, "manager", "tgt2@x.ae")
    c = _client(api_db, admin)
    r = c.put(
        f"/api/v1/auth/users/{target.id}/permissions/bulk",
        json={
            "items": [
                {"capability": "books.delete", "effect": "deny"},
                {"capability": "not.a.cap", "effect": "grant"},  # invalid → whole batch refused
            ]
        },
    )
    assert r.status_code == 400
    # nothing applied
    assert perm_service.get_user_overrides(api_db, target.id) == {}


def test_bulk_cannot_grant_sensitive(api_db):
    admin = _user(api_db, "admin", "ad3@x.ae")
    target = _user(api_db, "manager", "tgt3@x.ae")
    r = _client(api_db, admin).put(
        f"/api/v1/auth/users/{target.id}/permissions/bulk",
        json={"items": [{"capability": "users.manage", "effect": "grant"}]},
    )
    assert r.status_code == 400


def test_bulk_rejects_self_target(api_db):
    """An admin can't change their own overrides, even via the bulk route."""
    admin = _user(api_db, "admin", "ad4@x.ae")
    r = _client(api_db, admin).put(
        f"/api/v1/auth/users/{admin.id}/permissions/bulk",
        json={"items": [{"capability": "books.delete", "effect": "deny"}]},
    )
    assert r.status_code == 400
