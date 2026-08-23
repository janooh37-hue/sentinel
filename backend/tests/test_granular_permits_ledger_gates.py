# backend/tests/test_granular_permits_ledger_gates.py
"""Atomic permits/ledger gates: permits.{create,edit,revoke,delete} and
ledger.{create,edit,delete} are independently denyable; smart folders ride
the ledger ids.

The pinpoint scenario: a manager with a ``deny`` override on one atomic child
keeps every other action. Operator (view-only) gets 403 everywhere writey.

Auth pattern mirrors test_granular_people_gates.py: shared ``api_db`` fixture
(temp-file SQLite, cross-thread safe), override get_db + get_current_user,
role presets seeded from the atomic catalog.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User, UserPermission
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


def test_operator_cannot_create_permit(api_db):
    u = _user(api_db, "operator", "pc@x.ae")
    r = _client(api_db, u).post("/api/v1/permits", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "permits.create"


def test_permit_edit_family_is_one_gate(api_db):
    """Deny permits.edit: every mutation-but-create/revoke/delete closes."""
    u = _user(api_db, "manager", "pe@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="permits.edit", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    edit_routes = [
        ("patch", "/api/v1/permits/999999", {}),
        ("post", "/api/v1/permits/999999/renew", {}),
        ("post", "/api/v1/permits/999999/submit-approval", None),
        ("post", "/api/v1/permits/999999/people", {}),
        ("delete", "/api/v1/permits/999999/people/1", None),
        ("post", "/api/v1/permits/999999/vehicles", {}),
        ("patch", "/api/v1/permits/999999/vehicles/1", {}),
        ("delete", "/api/v1/permits/999999/vehicles/1", None),
        ("delete", "/api/v1/permits/999999/document", None),
        ("post", "/api/v1/permits/999999/visits", {}),
    ]
    for method, url, body in edit_routes:
        r = getattr(c, method)(url, json=body) if body is not None else getattr(c, method)(url)
        assert r.status_code == 403, f"{method.upper()} {url}: {r.status_code}"
        assert r.json()["error"]["details"]["capability"] == "permits.edit", url
    # create is a different gate — unaffected by the edit deny (422 = validation reached)
    assert c.post("/api/v1/permits", json={}).status_code in (201, 422)


def test_permit_revoke_is_its_own_gate(api_db):
    u = _user(api_db, "manager", "pv@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="permits.revoke", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    r = c.post("/api/v1/permits/999999/revoke", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "permits.revoke"
    # delete is a different gate — passes here (404 = record lookup, gate cleared)
    assert c.delete("/api/v1/permits/999999").status_code in (204, 404)


def test_permit_delete_does_not_cover_create(api_db):
    u = _user(api_db, "operator", "pd@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="permits.create", effect="grant"))
    api_db.commit()
    c = _client(api_db, u)
    # create passes for the operator now…
    assert c.post("/api/v1/permits", json={}).status_code in (201, 422)
    # …but delete stays closed (the create grant doesn't reach it).
    r = c.delete("/api/v1/permits/999999")
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "permits.delete"


def test_scan_helpers_need_permits_edit(api_db):
    """OCR helpers moved off create: plain operator 403s on permits.edit."""
    u = _user(api_db, "operator", "ps@x.ae")
    c = _client(api_db, u)
    for url in ("/api/v1/permits/scan-vehicle-licence", "/api/v1/permits/scan-emirates-id"):
        r = c.post(url, files={"file": ("m.jpg", b"x", "image/jpeg")})
        assert r.status_code == 403, url
        assert r.json()["error"]["details"]["capability"] == "permits.edit", url


def test_ledger_creates_use_ledger_create(api_db):
    """Deny ledger.create: contacts/recipient-lists/drafts/entries POST close."""
    u = _user(api_db, "manager", "lc@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="ledger.create", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    create_routes = [
        "/api/v1/ledger/contacts",
        "/api/v1/ledger/recipient-lists",
        "/api/v1/ledger/drafts",
        "/api/v1/ledger",
    ]
    for url in create_routes:
        r = c.post(url, json={})
        assert r.status_code == 403, f"POST {url}: {r.status_code}"
        assert r.json()["error"]["details"]["capability"] == "ledger.create", url


def test_ledger_delete_is_its_own_gate(api_db):
    u = _user(api_db, "operator", "ld@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="ledger.create", effect="grant"))
    api_db.commit()
    c = _client(api_db, u)
    # create passes for the operator…
    assert c.post("/api/v1/ledger", json={}).status_code in (201, 422)
    # …but delete stays closed (operator has no ledger.delete).
    r = c.delete("/api/v1/ledger/999999")
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "ledger.delete"


def test_ledger_mutation_keeps_literal_edit_gate(api_db):
    """PATCH/flag/star/attachment routes still answer to ledger.edit itself."""
    u = _user(api_db, "operator", "le@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="ledger.edit", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    edit_routes = [
        ("patch", "/api/v1/ledger/recipient-lists/1", {}),
        ("patch", "/api/v1/ledger/drafts/1", {}),
        ("post", "/api/v1/ledger/1/flag", {}),
        ("post", "/api/v1/ledger/entries/1/star", None),
    ]
    for method, url, body in edit_routes:
        r = getattr(c, method)(url, json=body) if body is not None else getattr(c, method)(url)
        assert r.status_code == 403, f"{method.upper()} {url}: {r.status_code}"
        assert r.json()["error"]["details"]["capability"] == "ledger.edit", url
    # create untouched by the edit deny (operator holds ledger.create)
    assert c.post("/api/v1/ledger", json={}).status_code in (201, 422)


def test_smart_folder_create_uses_ledger_create(api_db):
    u = _user(api_db, "manager", "sf@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="ledger.create", effect="deny"))
    api_db.commit()
    r = _client(api_db, u).post("/api/v1/ledger/smart-folders", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "ledger.create"


def test_smart_folder_mutation_stays_on_ledger_edit(api_db):
    """Deny ledger.edit: rename/delete close while create stays open."""
    u = _user(api_db, "operator", "sfe@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="ledger.edit", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    r = c.patch("/api/v1/ledger/smart-folders/1", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "ledger.edit"
    r2 = c.delete("/api/v1/ledger/smart-folders/1")
    assert r2.status_code == 403
    assert r2.json()["error"]["details"]["capability"] == "ledger.edit"
    # create rides ledger.create — untouched by the edit deny (422 = validation)
    assert c.post("/api/v1/ledger/smart-folders", json={}).status_code in (201, 422)
