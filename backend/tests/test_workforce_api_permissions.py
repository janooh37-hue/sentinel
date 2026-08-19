"""RED API contracts for workforce capability, scope, privacy, and secret boundaries."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Employee, User, UserWorkforceScope
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Iterator[Session]:
    """A file-backed SQLite database shared by API handlers and test setup."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'workforce_permissions.db'}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(engine, wal=False)
    Base.metadata.create_all(engine)
    test_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", engine)
    monkeypatch.setattr(session_mod, "SessionLocal", test_session)
    db = test_session()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()


def _employee(employee_id: str, *, department: str, duty_unit: str, name: str) -> Employee:
    return Employee(
        id=employee_id,
        name_en=name,
        department=department,
        duty_unit=duty_unit,
        duty_post="Gate 1",
    )


def _user(
    db: Session,
    *,
    email: str,
    role: str = "operator",
    employee_id: str | None = None,
) -> User:
    user = User(
        email=email,
        password_hash="x",
        role=role,
        status="active",
        employee_id=employee_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _scope(
    db: Session,
    user: User,
    *,
    kind: str,
    department: str | None = None,
    duty_unit: str | None = None,
    duty_post: str | None = None,
) -> None:
    db.add(
        UserWorkforceScope(
            user_id=user.id,
            scope_kind=kind,
            department=department,
            duty_unit=duty_unit,
            duty_post=duty_post,
            created_by_user_id=user.id,
        )
    )
    db.commit()


def _walk_keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | set().union(*(_walk_keys(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(_walk_keys(item) for item in value)) if value else set()
    return set()


def test_scope_assignment_requires_users_manage_and_replaces_normalized_scope_set_with_etag(
    api_db: Session,
) -> None:
    """Scope grants are audited admin work, canonicalized, and protected from stale replacement."""
    admin = _user(api_db, email="scope-admin@test.ae", role="admin")
    target = _user(api_db, email="scope-target@test.ae")
    unauthorized = _client(api_db, target)
    forbidden = unauthorized.put(
        f"/api/v1/workforce/access/users/{target.id}/scopes",
        json={"scopes": []},
        headers={"If-Match": '"initial"'},
    )
    assert forbidden.status_code == 403

    client = _client(api_db, admin)
    before = client.get(f"/api/v1/workforce/access/users/{target.id}/scopes")
    assert before.status_code == 200, before.text
    initial_etag = before.headers["etag"]
    assert before.json()["scopes"] == []

    replacement = {
        "scopes": [
            {
                "scope_kind": "duty_unit",
                "department": " Operations ",
                "duty_unit": " North ",
                "duty_post": None,
            }
        ]
    }
    updated = client.put(
        f"/api/v1/workforce/access/users/{target.id}/scopes",
        json=replacement,
        headers={"If-Match": initial_etag},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["scopes"] == [
        {
            "scope_kind": "duty_unit",
            "department": "Operations",
            "duty_unit": "North",
            "duty_post": None,
        }
    ]
    assert updated.headers["etag"] != initial_etag

    stale = client.put(
        f"/api/v1/workforce/access/users/{target.id}/scopes",
        json={"scopes": []},
        headers={"If-Match": initial_etag},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "WORKFORCE_VERSION_CONFLICT"

    duplicate = client.put(
        f"/api/v1/workforce/access/users/{target.id}/scopes",
        json={"scopes": replacement["scopes"] * 2},
        headers={"If-Match": updated.headers["etag"]},
    )
    assert duplicate.status_code == 422


def test_workforce_routes_fail_closed_for_an_operator_without_the_required_capability(
    api_db: Session,
) -> None:
    """Every aggregate, person, management, and integration surface denies missing capability."""
    user = _user(api_db, email="operator-denied@test.ae")
    client = _client(api_db, user)

    denied_requests = [
        ("get", "/api/v1/workforce/dashboard/analytics"),
        ("get", "/api/v1/workforce/dashboard/coverage?operational_date=2026-08-17"),
        ("get", "/api/v1/workforce/roster?operational_date=2026-08-17"),
        ("get", "/api/v1/workforce/duty-assignment-events"),
        ("get", "/api/v1/workforce/attendance/exceptions"),
        ("get", "/api/v1/workforce/attendance/cases/1"),
        ("post", "/api/v1/workforce/attendance/cases/1/adjustments"),
        ("get", "/api/v1/workforce/crews"),
        ("get", "/api/v1/workforce/policies"),
        ("get", "/api/v1/workforce/integration/status"),
        ("get", "/api/v1/workforce/configuration"),
    ]
    for method, path in denied_requests:
        response = (
            client.post(path, json={})
            if method == "post"
            else getattr(client, method)(path)
        )
        assert response.status_code == 403, f"{method.upper()} {path}: {response.text}"


def test_self_capability_can_read_only_its_self_snapshot_block(api_db: Session) -> None:
    """Self view remains usable but never acts as aggregate or person-level authorization."""
    employee = _employee(
        "G-SELF",
        department="Operations",
        duty_unit="North",
        name="Self Only",
    )
    api_db.add(employee)
    api_db.commit()
    user = _user(api_db, email="self-only@test.ae", employee_id=employee.id)
    client = _client(api_db, user)

    snapshot = client.get("/api/v1/workforce/dashboard/snapshot")
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()["self"]["employee_id"] == employee.id

    for path in (
        "/api/v1/workforce/dashboard/analytics",
        "/api/v1/workforce/dashboard/coverage?operational_date=2026-08-17",
        "/api/v1/workforce/roster?operational_date=2026-08-17",
    ):
        assert client.get(path).status_code == 403


def test_aggregate_scope_response_never_discloses_person_identities_or_provider_secrets(
    api_db: Session,
) -> None:
    """Aggregate-only access exposes neither employee identities nor environment-only provider data."""
    manager = _user(api_db, email="aggregate-manager@test.ae", role="admin")
    _scope(api_db, manager, kind="department", department="Operations")
    in_scope = _employee(
        "G-PRIVATE-ONE",
        department="Operations",
        duty_unit="North",
        name="Private Workforce Name",
    )
    foreign = _employee(
        "G-PRIVATE-TWO",
        department="Security",
        duty_unit="South",
        name="Foreign Workforce Name",
    )
    api_db.add_all([in_scope, foreign])
    api_db.commit()
    client = _client(api_db, manager)

    analytics = client.get("/api/v1/workforce/dashboard/analytics")
    assert analytics.status_code == 200, analytics.text
    serialized = analytics.text
    assert in_scope.id not in serialized
    assert foreign.id not in serialized
    assert in_scope.name_en not in serialized
    assert foreign.name_en not in serialized
    assert {"employee_id", "name_en", "name_ar"}.isdisjoint(_walk_keys(analytics.json()))

    integration = client.get("/api/v1/workforce/integration/status")
    assert integration.status_code == 200, integration.text
    configuration = client.get("/api/v1/workforce/configuration")
    assert configuration.status_code == 200, configuration.text
    forbidden_keys = {
        "provider_url",
        "provider_username",
        "provider_password",
        "provider_token",
        "raw_payload",
        "raw_response",
    }
    assert forbidden_keys.isdisjoint(_walk_keys(integration.json()))
    assert forbidden_keys.isdisjoint(_walk_keys(configuration.json()))
