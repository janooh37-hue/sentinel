# backend/tests/test_permissions_api.py
"""API tests for permission-request routes (Task 9).

Mount prefix confirmed from main.py: /api/v1
Routes:
  POST   /api/v1/permissions/requests               (any signed-in user)
  GET    /api/v1/permissions/requests               (requires users.manage)
  POST   /api/v1/permissions/requests/{id}/decide   (requires users.manage)

The TestClient runs ASGI in a worker thread; SQLite forbids cross-thread
connection reuse by default.  We create a local engine with
``check_same_thread=False`` so the same in-memory DB is accessible from both
the main test thread (setup/assertions) and the ASGI worker thread (handlers).
"""
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

# ─── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    """
    SQLite session that works across threads AND across connections (for TestClient).

    Two requirements:
    1. ``check_same_thread=False`` — FastAPI/Starlette runs sync handlers in a
       thread-pool worker, not the test's main thread.
    2. A shared-cache in-memory URI (or a temp file) so that every new
       ``SessionLocal()`` opened by service code (e.g. lifespan seeding,
       admin_notify) sees the same tables and rows.  Plain ``sqlite://`` creates
       an isolated database per connection, which causes "no such table" errors
       inside the ASGI worker.

    We use a temp-file DB here; it's automatically cleaned up with tmp_path.
    """
    db_file = tmp_path / "test_api.db"
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


def _make_user(db: Session, *, role="operator", email="u@x.ae") -> User:
    u = User(email=email, password_hash="x", role=role, status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _client(db: Session, user: User) -> TestClient:
    """Build a TestClient with db and current-user dependency overrides."""
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


# ─── create request ────────────────────────────────────────────────────────────


def test_operator_can_create_request(api_db):
    """An operator can POST a permission request → 201 with expected fields."""
    u = _make_user(api_db, role="operator")
    c = _client(api_db, u)
    r = c.post("/api/v1/permissions/requests", json={"capability": "books.approve"})
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["capability"] == "books.approve"
    assert data["capability_label"] == "Approve / reject books"
    assert data["status"] == "pending"
    assert data["decision"] is None
    assert data["user_id"] == u.id


def test_create_request_unknown_capability_returns_400(api_db):
    """Requesting an unknown capability returns 400."""
    u = _make_user(api_db, role="operator", email="op2@x.ae")
    c = _client(api_db, u)
    r = c.post(
        "/api/v1/permissions/requests", json={"capability": "nonexistent.cap"}
    )
    assert r.status_code == 400


def test_create_request_already_held_returns_400(api_db):
    """Requesting a capability you already have returns 400 (operators have books.view)."""
    u = _make_user(api_db, role="operator", email="op3@x.ae")
    c = _client(api_db, u)
    r = c.post("/api/v1/permissions/requests", json={"capability": "books.view"})
    assert r.status_code == 400


# ─── list pending ─────────────────────────────────────────────────────────────


def test_admin_can_list_pending_requests(api_db):
    """An admin can GET the list of pending requests."""
    admin = _make_user(api_db, role="admin", email="admin@x.ae")
    op = _make_user(api_db, role="operator", email="op4@x.ae")

    # Create a request as operator
    op_client = _client(api_db, op)
    op_client.post(
        "/api/v1/permissions/requests", json={"capability": "books.approve"}
    )

    # List as admin
    admin_client = _client(api_db, admin)
    r = admin_client.get("/api/v1/permissions/requests")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert any(item["capability"] == "books.approve" for item in data)


# ─── decide ───────────────────────────────────────────────────────────────────


def test_admin_can_decide_grant_permanent(api_db):
    """Admin grants a request permanently; requester gains the capability."""
    admin = _make_user(api_db, role="admin", email="admin2@x.ae")
    op = _make_user(api_db, role="operator", email="op5@x.ae")

    # Operator creates a request
    op_client = _client(api_db, op)
    r_create = op_client.post(
        "/api/v1/permissions/requests", json={"capability": "books.approve"}
    )
    assert r_create.status_code == 201, r_create.text
    request_id = r_create.json()["id"]

    # Admin decides: grant permanent
    admin_client = _client(api_db, admin)
    r_decide = admin_client.post(
        f"/api/v1/permissions/requests/{request_id}/decide",
        json={"decision": "permanent"},
    )
    assert r_decide.status_code == 200, r_decide.text
    data = r_decide.json()
    assert data["status"] == "granted"
    assert data["decision"] == "permanent"

    # The operator now has books.approve
    api_db.expire_all()
    assert perm_service.has_capability(api_db, op, "books.approve")


def test_admin_can_decide_refuse(api_db):
    """Admin refuses a request; status becomes refused."""
    admin = _make_user(api_db, role="admin", email="admin3@x.ae")
    op = _make_user(api_db, role="operator", email="op6@x.ae")

    op_client = _client(api_db, op)
    r_create = op_client.post(
        "/api/v1/permissions/requests", json={"capability": "books.approve"}
    )
    assert r_create.status_code == 201
    request_id = r_create.json()["id"]

    admin_client = _client(api_db, admin)
    r_decide = admin_client.post(
        f"/api/v1/permissions/requests/{request_id}/decide",
        json={"decision": "refused", "note": "Not needed"},
    )
    assert r_decide.status_code == 200, r_decide.text
    data = r_decide.json()
    assert data["status"] == "refused"
    assert data["decision"] == "refused"


def test_decide_nonexistent_request_returns_404(api_db):
    """Deciding on a nonexistent request returns 404."""
    admin = _make_user(api_db, role="admin", email="admin4@x.ae")
    admin_client = _client(api_db, admin)
    r = admin_client.post(
        "/api/v1/permissions/requests/99999/decide",
        json={"decision": "permanent"},
    )
    assert r.status_code == 404
