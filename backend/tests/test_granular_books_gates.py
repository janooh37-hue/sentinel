# backend/tests/test_granular_books_gates.py
"""Atomic books gates: create/edit/submit/templates/delete are independently
denyable.

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


def test_books_gate_split(api_db):
    """Manager with books.delete denied: PATCH ok, DELETE 403, submit ok."""
    u = _user(api_db, "manager", "bk@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="books.delete", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    # create passes (422 = validation reached)
    assert c.post("/api/v1/books", json={}).status_code in (201, 422)
    # edit unaffected by the delete deny (404 = record lookup, gate passed)
    assert c.patch("/api/v1/books/999999", json={}).status_code in (200, 404)
    # ...while the denied delete is its own gate (403 before the record lookup)
    r = c.delete("/api/v1/books/999999")
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "books.delete"
    # submit gate is books.submit (manager default) — 404/422 acceptable, NOT 403
    r = c.post("/api/v1/books/999999/submit", json={})
    assert r.status_code in (404, 422)


def test_operator_cannot_create_book(api_db):
    u = _user(api_db, "operator", "opbk@x.ae")
    r = _client(api_db, u).post("/api/v1/books", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "books.create"


def test_word_templates_need_templates_cap(api_db):
    u = _user(api_db, "manager", "tpl@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="books.templates", effect="deny"))
    api_db.commit()
    r = _client(api_db, u).get("/api/v1/books/word-templates")
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "books.templates"


def test_scanback_filing_needs_books_edit(api_db):
    """Operator + grant books.edit can reach the scan-back list (was books.manage)."""
    u = _user(api_db, "operator", "sb@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="books.edit", effect="grant"))
    api_db.commit()
    r = _client(api_db, u).get("/api/v1/books/awaiting-scan")
    assert r.status_code == 200
