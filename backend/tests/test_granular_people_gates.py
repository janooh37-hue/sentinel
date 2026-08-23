# backend/tests/test_granular_people_gates.py
"""Atomic people-domain gates: create/edit/vault/delete are independently denyable.

The pinpoint scenario: a manager with a ``deny`` override on one atomic child
keeps every other action. Operator (view-only) gets 403 everywhere writey.

Auth pattern mirrors test_workforce_api_permissions.py: shared ``api_db``
fixture (temp-file SQLite, cross-thread safe), override get_db +
get_current_user, role presets seeded from the atomic catalog.
"""

from __future__ import annotations

import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Employee, User, UserPermission
from app.db.session import get_db
from app.main import create_app


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


def _employee(db: Session, emp_id: str = "E1") -> Employee:
    e = Employee(id=emp_id, name_en="Test Person")
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


def test_operator_cannot_create_employee(api_db):
    u = _user(api_db, "operator", "op@x.ae")
    r = _client(api_db, u).post("/api/v1/employees", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "employees.create"


def test_manager_can_create_employee(api_db):
    u = _user(api_db, "manager", "mgr@x.ae")
    r = _client(api_db, u).post("/api/v1/employees", json={})
    assert r.status_code in (201, 422)  # 422 = reached validation, gate passed


def test_deny_vault_manage_blocks_vault_write_only(api_db):
    """Pinpoint: deny employees.vault.manage, everything else still works."""
    u = _user(api_db, "manager", "mgr2@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="employees.vault.manage", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    e = _employee(api_db)
    # vault write blocked
    files = {"file": ("id.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")}
    r = c.post(
        f"/api/v1/employees/{e.id}/vault/upload",
        data={"kind": "uae_id"},
        files=files,
    )
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "employees.vault.manage"
    # profile edit still allowed
    r2 = c.patch(f"/api/v1/employees/{e.id}", json={})
    assert r2.status_code in (200, 422)


def test_violations_split_into_three_gates(api_db):
    u = _user(api_db, "manager", "mgr3@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="violations.delete", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    e = _employee(api_db)
    # create passes the gate (422 = body validation, not 403)
    r = c.post(f"/api/v1/employees/{e.id}/violations", json={})
    assert r.status_code in (201, 422)
    # ...while the denied delete is its own gate (403 before the record lookup)
    r2 = c.delete("/api/v1/violations/999999")
    assert r2.status_code == 403
    assert r2.json()["error"]["details"]["capability"] == "violations.delete"


def test_leaves_delete_is_its_own_gate(api_db):
    u = _user(api_db, "operator", "op4@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="leaves.create", effect="grant"))
    api_db.commit()
    c = _client(api_db, u)
    r = c.post("/api/v1/leaves", json={})
    assert r.status_code in (201, 422)  # granted create passes despite operator role
    # ...but delete stays gated on its own atomic id, not covered by the grant
    r2 = c.delete("/api/v1/leaves/999999")
    assert r2.status_code == 403
    assert r2.json()["error"]["details"]["capability"] == "leaves.delete"
