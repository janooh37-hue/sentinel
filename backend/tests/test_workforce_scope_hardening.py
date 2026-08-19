"""Regression contracts for the workforce authorization-boundary hardening.

Each test pins one finding from the security review. A capability alone must
never be sufficient for a surface the specification binds to workforce scope
(spec lines 895-900), and an aggregate block must never reach a self-only
caller (spec lines 949-950).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.db.base import Base
from app.db.models import AppSetting, Employee, User, UserPermission
from app.db.session import attach_sqlite_pragmas, get_db
from app.db.workforce_models import UserWorkforceScope
from app.main import app
from app.services import perm_service

NOW = datetime.now(UTC)


@pytest.fixture()
def api_db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    attach_sqlite_pragmas(engine, wal=False)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    db = factory()
    perm_service.seed_role_defaults(db)
    db.commit()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


def _user(db: Session, *, email: str, role: str = "operator") -> User:
    row = User(email=email, password_hash="x", role=role, status="active")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _grant(db: Session, user: User, capability: str) -> None:
    db.add(UserPermission(user_id=user.id, capability=capability, effect="grant"))
    db.commit()


def _scoped_to(db: Session, user: User, *, department: str, duty_unit: str | None = None) -> None:
    db.add(
        UserWorkforceScope(
            user_id=user.id,
            scope_kind="duty_unit" if duty_unit else "department",
            department=department,
            duty_unit=duty_unit,
            created_by_user_id=user.id,
        )
    )
    db.commit()


@contextmanager
def _client(db: Session, user: User) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def test_scoped_manager_cannot_write_an_override_for_a_foreign_employee(api_db):
    """WF-SEC-002: schedule.manage must not reach outside the resolved scope."""
    manager = _user(api_db, email="ops-manager@test.ae", role="manager")
    _grant(api_db, manager, "workforce.schedule.manage")
    _scoped_to(api_db, manager, department="Operations", duty_unit="Gate A")
    api_db.add(
        Employee(
            id="G-FOREIGN-1",
            name_en="Finance Person",
            name_ar="موظف",
            status="Active",
            department="Finance",
            duty_unit="Payroll",
        )
    )
    api_db.commit()

    with _client(api_db, manager) as client:
        response = client.post(
            "/api/v1/workforce/overrides",
            json={
                "employee_id": "G-FOREIGN-1",
                "assignment_kind": "off",
                "reason_kind": "other",
                "starts_at": (NOW + timedelta(hours=1)).isoformat(),
                "ends_at": (NOW + timedelta(hours=9)).isoformat(),
                "reason": "unauthorized cross-department override",
            },
        )

    assert response.status_code == 403, response.text


def test_scoped_manager_cannot_disable_the_organization_privacy_fold(api_db):
    """WF-SEC-003: organization-global configuration needs organization scope."""
    manager = _user(api_db, email="policy-manager@test.ae", role="manager")
    _grant(api_db, manager, "workforce.policy.manage")
    _scoped_to(api_db, manager, department="Operations")

    with _client(api_db, manager) as client:
        response = client.patch(
            "/api/v1/workforce/configuration",
            json={"nationality_fold_min_count": 1},
            headers={"If-Match": '"any"'},
        )

    assert response.status_code == 403, response.text
    # The organization-global setting is untouched.
    assert api_db.get(AppSetting, "workforce.nationality_fold_min_count") is None


def test_scoped_integration_manager_cannot_list_organization_wide_provider_people(api_db):
    """WF-SEC-004: provider reconciliation exposes org-wide names and ids."""
    manager = _user(api_db, email="integration-manager@test.ae", role="manager")
    _grant(api_db, manager, "workforce.integration.manage")
    _scoped_to(api_db, manager, department="Operations", duty_unit="Gate A")

    with _client(api_db, manager) as client:
        listing = client.get("/api/v1/workforce/integration/people")
        queue = client.get("/api/v1/workforce/integration/evaluation-queue")

    assert listing.status_code == 403, listing.text
    assert queue.status_code == 403, queue.text


def test_self_only_caller_never_receives_organization_aggregate_blocks(api_db):
    """WF-SEC-007: self.view alone must not expose org-wide health or readiness."""
    employee = Employee(
        id="G-SELF-1", name_en="Self Only", name_ar="ذاتي", status="Active", department="Operations"
    )
    api_db.add(employee)
    api_db.commit()
    operator = _user(api_db, email="self-only@test.ae")
    operator.employee_id = employee.id
    api_db.commit()
    _grant(api_db, operator, "workforce.self.view")

    with _client(api_db, operator) as client:
        response = client.get("/api/v1/workforce/dashboard/snapshot")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert "readiness" not in payload
    assert "sync_health" not in payload
    assert "aggregate" not in payload
    # The self block is exactly what this capability is for.
    assert payload["self"]["employee_id"] == employee.id


def test_nationality_other_bucket_is_suppressed_below_the_privacy_threshold(api_db):
    """WF-SEC-006: an Other bucket under the floor re-identifies its members."""
    admin = _user(api_db, email="fold-admin@test.ae", role="admin")
    for index, nationality in enumerate(("Elbonia", "Freedonia", "Latveria"), start=1):
        api_db.add(
            Employee(
                id=f"G-FOLD-{index}",
                name_en=f"Person {index}",
                name_ar="شخص",
                status="Active",
                department="Operations",
                nationality=nationality,
            )
        )
    api_db.add(AppSetting(key="workforce.nationality_fold_min_count", value=json.dumps(5)))
    api_db.commit()

    with _client(api_db, admin) as client:
        response = client.get("/api/v1/workforce/dashboard/analytics")

    assert response.status_code == 200, response.text
    distribution = response.json()["nationality_distribution"]
    # Every individual group is under the floor and their residual (3) is too,
    # so nothing identifying may be published at all.
    assert distribution == []


def test_inactive_employees_are_excluded_from_the_nationality_denominator(api_db):
    """WF-SEC-010: the widget's population is active employees in scope."""
    admin = _user(api_db, email="active-admin@test.ae", role="admin")
    for index in range(1, 3):
        api_db.add(
            Employee(
                id=f"G-ACTIVE-{index}",
                name_en=f"Active {index}",
                name_ar="نشط",
                status="Active",
                department="Operations",
                nationality="Elbonia",
            )
        )
    api_db.add(
        Employee(
            id="G-RESIGNED-1",
            name_en="Resigned",
            name_ar="مستقيل",
            status="Resigned",
            department="Operations",
            nationality="Elbonia",
        )
    )
    api_db.add(AppSetting(key="workforce.nationality_fold_min_count", value=json.dumps(2)))
    api_db.commit()

    with _client(api_db, admin) as client:
        response = client.get("/api/v1/workforce/dashboard/analytics")

    assert response.status_code == 200, response.text
    assert response.json()["nationality_distribution"] == [
        {"nationality": "Elbonia", "count": 2}
    ]


def test_swap_is_refused_when_either_leg_is_outside_the_managers_scope(api_db):
    """WF-SEC-002: a swap has two legs; BOTH must be inside the scope.

    Checking only the first leg would let a scoped manager move a foreign
    employee onto a shift they do not control.
    """
    manager = _user(api_db, email="swap-manager@test.ae", role="manager")
    _grant(api_db, manager, "workforce.schedule.manage")
    _scoped_to(api_db, manager, department="Operations", duty_unit="Gate A")
    api_db.add(
        Employee(
            id="G-SWAP-IN",
            name_en="Inside Scope",
            name_ar="داخل",
            status="Active",
            department="Operations",
            duty_unit="Gate A",
        )
    )
    api_db.add(
        Employee(
            id="G-SWAP-OUT",
            name_en="Outside Scope",
            name_ar="خارج",
            status="Active",
            department="Finance",
            duty_unit="Payroll",
        )
    )
    api_db.commit()

    body = {
        "starts_at": (NOW + timedelta(hours=1)).isoformat(),
        "ends_at": (NOW + timedelta(hours=9)).isoformat(),
        "shift_definition_id": 1,
        "reason": "cross-scope swap must be refused",
    }
    with _client(api_db, manager) as client:
        # The foreign employee as the *second* leg must not slip through.
        forward = client.post(
            "/api/v1/workforce/overrides/swap",
            json={**body, "from_employee_id": "G-SWAP-IN", "to_employee_id": "G-SWAP-OUT"},
        )
        # ...nor as the first.
        reverse = client.post(
            "/api/v1/workforce/overrides/swap",
            json={**body, "from_employee_id": "G-SWAP-OUT", "to_employee_id": "G-SWAP-IN"},
        )

    assert forward.status_code == 403, forward.text
    assert reverse.status_code == 403, reverse.text


def test_scoped_manager_cannot_set_a_staffing_target_for_a_foreign_hierarchy(api_db):
    """WF-SEC-009: the requirement target is client-authored, so it needs a gate."""
    manager = _user(api_db, email="target-manager@test.ae", role="manager")
    _grant(api_db, manager, "workforce.policy.manage")
    _scoped_to(api_db, manager, department="Operations")

    with _client(api_db, manager) as client:
        response = client.post(
            "/api/v1/workforce/requirements",
            json={
                "scope_kind": "department",
                "department": "Finance",
                "minimum_headcount": 4,
                "effective_from": NOW.date().isoformat(),
            },
        )

    assert response.status_code == 403, response.text


def test_access_me_reports_the_callers_own_tier_and_scopes(api_db):
    """The handler previously called a nonexistent method and raised at runtime.

    It has no other test, so this pins the serialized shape.
    """
    manager = _user(api_db, email="access-me@test.ae", role="manager")
    _grant(api_db, manager, "workforce.dashboard.view")
    _scoped_to(api_db, manager, department="Operations", duty_unit="Gate A")

    with _client(api_db, manager) as client:
        response = client.get("/api/v1/workforce/access/me")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["workforce_access_tier"] == "scoped"
    assert payload["scopes"] == [
        {
            "scope_kind": "duty_unit",
            "department": "Operations",
            "duty_unit": "Gate A",
            "duty_post": None,
        }
    ]
