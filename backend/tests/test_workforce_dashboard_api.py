"""RED contracts for the scoped workforce dashboard HTTP API.

These tests deliberately exercise the real SQLite metadata, service layer, and mounted
FastAPI routes.  A dashboard request must only read Sentinel's persisted attendance
projection; it must not call an attendance provider on the request path.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import app
from app.services import (
    perm_service,
    workforce_admin_service,
    workforce_dashboard_service,
    workforce_read_service,
)
from app.services.workforce_scope_service import resolve_workforce_scope

# The snapshot route derives its operational date from the real clock, so the
# fixture anchors to "now" instead of a fixed calendar day. A hardcoded date
# silently stops matching the moment the suite runs on a later day.
NOW = datetime.now(UTC).replace(tzinfo=None)
TODAY = datetime.now(UTC).astimezone(ZoneInfo("Asia/Dubai")).date()


@pytest.fixture()
def workforce_api_db() -> Iterator[Session]:
    """Create the actual complete SQLite schema, including workforce metadata."""
    # Importing this module is part of the red contract: its models must register
    # before Base.metadata.create_all() just like production's model re-export.
    from app.db import workforce_models  # noqa: F401
    from app.db.models import Base

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    attach_sqlite_pragmas(engine, wal=False)
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


@contextmanager
def _client_for(db: Session, user: Any) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def _create_user(
    db: Session,
    *,
    email: str,
    role: str = "operator",
    employee_id: str | None = None,
):
    from app.db.models import User

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


def _grant(db: Session, user: Any, capability: str) -> None:
    from app.db.models import UserPermission

    db.add(UserPermission(user_id=user.id, capability=capability, effect="grant"))
    db.commit()


def _add_employee(
    db: Session,
    employee_id: str,
    *,
    name: str,
    department: str = "Operations",
    duty_unit: str | None = None,
    nationality: str | None = None,
    status: str = "Active",
):
    from app.db.models import Employee

    employee = Employee(
        id=employee_id,
        name_en=name,
        status=status,
        department=department,
        duty_unit=duty_unit,
        nationality=nationality,
    )
    db.add(employee)
    db.flush()
    return employee


def _seed_coverage_cases(db: Session, admin: Any) -> None:
    """Persist two evaluated children under one department through real ORM rows."""
    from app.db.workforce_models import (
        AttendanceCase,
        AttendanceEvaluation,
        AttendanceSyncState,
        WorkCrew,
        WorkCrewMembership,
        WorkCrewSchedule,
        WorkRotationPattern,
        WorkShiftDefinition,
        WorkShiftOccurrence,
    )

    morning = WorkShiftDefinition(
        code="morning",
        start_local_time=time(4),
        duration_minutes=480,
    )
    pattern = WorkRotationPattern(
        code="canonical_120h",
        name="Canonical 120-hour rotation",
        cycle_minutes=7200,
        timezone="Asia/Dubai",
    )
    crew = WorkCrew(code="alpha", name_en="Alpha")
    db.add_all([morning, pattern, crew])
    db.flush()

    schedule = WorkCrewSchedule(
        crew_id=crew.id,
        pattern_id=pattern.id,
        anchor_at=NOW - timedelta(days=5),
        effective_from=NOW - timedelta(days=5),
        version=1,
        created_by_user_id=admin.id,
    )
    db.add(schedule)
    db.flush()

    occurrence = WorkShiftOccurrence(
        crew_id=crew.id,
        crew_schedule_id=schedule.id,
        shift_definition_id=morning.id,
        starts_at=NOW - timedelta(hours=4),
        ends_at=NOW + timedelta(hours=4),
        operational_date=TODAY,
        pattern_code_snapshot=pattern.code,
        crew_schedule_version_snapshot=schedule.version,
        source_anchor_at=schedule.anchor_at,
    )
    db.add(occurrence)
    db.flush()

    employees = [
        _add_employee(
            db,
            "G-COVERAGE-A",
            name="Coverage A",
            duty_unit="Gate A",
            nationality="United Arab Emirates",
        ),
        _add_employee(
            db,
            "G-COVERAGE-B",
            name="Coverage B",
            duty_unit="Gate B",
            nationality="United Arab Emirates",
        ),
    ]
    for index, employee in enumerate(employees, start=1):
        membership = WorkCrewMembership(
            crew_id=crew.id,
            employee_id=employee.id,
            effective_from=NOW - timedelta(days=5),
            created_by_user_id=admin.id,
            updated_by_user_id=admin.id,
        )
        db.add(membership)
        db.flush()
        case = AttendanceCase(
            employee_id=employee.id,
            shift_occurrence_id=occurrence.id,
            employee_status_snapshot="Active",
            crew_code_snapshot=crew.code,
            crew_name_snapshot=crew.name_en,
            shift_code_snapshot=morning.code,
            department_snapshot=employee.department,
            duty_unit_snapshot=employee.duty_unit,
            duty_post_snapshot=f"Post {chr(64 + index)}",
            scheduled_start_at=occurrence.starts_at,
            scheduled_end_at=occurrence.ends_at,
            operational_date=TODAY,
            organization_snapshot_state="captured",
        )
        db.add(case)
        db.flush()
        db.add(
            AttendanceEvaluation(
                attendance_case_id=case.id,
                revision=1,
                presence_state="on_duty",
                reason_code="PUNCH_IN_ACTIVE",
                missing_checkout=False,
                sync_fresh_through=NOW + timedelta(hours=1),
                algorithm_version="v1",
                input_fingerprint=f"coverage-{index}",
                evaluated_at=NOW,
            )
        )
    db.add(
        AttendanceSyncState(
            provider="biotime",
            stream="punches",
            fresh_through=NOW + timedelta(hours=1),
            last_success_at=NOW,
            consecutive_failures=0,
            last_import_count=2,
        )
    )
    db.commit()

def test_correction_and_revocation_update_roster_and_every_dashboard_metric(
    workforce_api_db: Session,
) -> None:
    from app.db.models import AppSetting
    from app.db.workforce_models import AttendanceCase, AttendanceEvaluation

    admin = _create_user(workforce_api_db, email="correction-dashboard@test.ae", role="admin")
    _seed_coverage_cases(workforce_api_db, admin)
    workforce_api_db.add(AppSetting(key="workforce.stale_after_minutes", value=json.dumps(60)))
    workforce_api_db.commit()
    case = workforce_api_db.scalar(
        select(AttendanceCase).where(AttendanceCase.employee_id == "G-COVERAGE-A")
    )
    assert case is not None
    evaluation = workforce_api_db.scalar(
        select(AttendanceEvaluation).where(AttendanceEvaluation.attendance_case_id == case.id)
    )
    assert evaluation is not None
    scope = resolve_workforce_scope(workforce_api_db, admin)
    now = NOW.replace(tzinfo=UTC)

    correction = workforce_admin_service.apply_adjustment(
        workforce_api_db,
        case_id=case.id,
        payload={
            "replacement_presence_state": "absent",
            "replacement_first_in_at": evaluation.first_in_at,
            "replacement_latest_in_at": evaluation.latest_in_at,
            "replacement_final_out_at": evaluation.final_out_at,
            "replacement_late_minutes": evaluation.late_minutes,
            "replacement_early_exit_minutes": evaluation.early_exit_minutes,
            "replacement_missing_checkout": evaluation.missing_checkout,
            "reason": "Confirmed post absence",
        },
        if_match=workforce_admin_service.attendance_case_etag(workforce_api_db, case.id),
        actor=admin,
    )

    corrected_roster = next(
        row
        for row in workforce_read_service.list_roster(
            workforce_api_db, scope=scope, operational_date=TODAY
        )
        if row["employee_id"] == case.employee_id
    )
    corrected_snapshot = workforce_dashboard_service.get_workforce_snapshot(
        workforce_api_db,
        scope=scope,
        self_employee_id=case.employee_id,
        include_aggregate=True,
        now=now,
    ).value
    corrected_analytics = workforce_dashboard_service.get_workforce_analytics(
        workforce_api_db, scope=scope, now=now
    ).value
    corrected_coverage = workforce_dashboard_service.get_coverage_children(
        workforce_api_db,
        scope=scope,
        operational_date=TODAY,
        parent_kind="department",
        department="Operations",
        now=now,
    )

    assert corrected_roster["presence_state"] == "absent"
    assert corrected_snapshot["self"]["presence_state"] == "absent"
    assert corrected_snapshot["self"]["shift_code"] == "morning"
    assert corrected_snapshot["current_shift"]["working"] == 1
    assert corrected_analytics["department_coverage"][0]["working"] == 1
    assert {row["duty_unit"]: row["working"] for row in corrected_coverage} == {
        "Gate A": 0,
        "Gate B": 1,
    }

    workforce_admin_service.revoke_adjustment(
        workforce_api_db,
        case_id=case.id,
        adjustment_id=correction.id,
        reason="Automatic attendance restored",
        if_match=workforce_admin_service.attendance_case_etag(workforce_api_db, case.id),
        actor=admin,
    )
    workforce_api_db.flush()

    restored_roster = next(
        row
        for row in workforce_read_service.list_roster(
            workforce_api_db, scope=scope, operational_date=TODAY
        )
        if row["employee_id"] == case.employee_id
    )
    restored_snapshot = workforce_dashboard_service.get_workforce_snapshot(
        workforce_api_db,
        scope=scope,
        self_employee_id=case.employee_id,
        include_aggregate=True,
        now=now,
    ).value
    restored_analytics = workforce_dashboard_service.get_workforce_analytics(
        workforce_api_db, scope=scope, now=now
    ).value
    restored_coverage = workforce_dashboard_service.get_coverage_children(
        workforce_api_db,
        scope=scope,
        operational_date=TODAY,
        parent_kind="department",
        department="Operations",
        now=now,
    )

    assert restored_roster["presence_state"] == "on_duty"
    assert restored_snapshot["self"]["presence_state"] == "on_duty"
    assert restored_snapshot["self"]["shift_code"] == "morning"
    assert restored_snapshot["current_shift"]["working"] == 2
    assert restored_analytics["department_coverage"][0]["working"] == 2
    assert {row["duty_unit"]: row["working"] for row in restored_coverage} == {
        "Gate A": 1,
        "Gate B": 1,
    }


def _contains_value(value: Any, needle: str) -> bool:
    if isinstance(value, str):
        return value == needle
    if isinstance(value, dict):
        return any(_contains_value(item, needle) for item in value.values())
    if isinstance(value, list):
        return any(_contains_value(item, needle) for item in value)
    return False


# NOTE: `test_dashboard_totals_rename_false_presence_and_count_lifecycle_live_leave`
# is deliberately not ported. It asserts `DashboardTotals.active_not_on_current_leave`,
# a field belonging to the rejected dashboard rework (schemas/dashboard.py +
# dashboard_service.py), which this branch excludes. Its subject is the dashboard
# totals rename, not workforce attendance; every workforce assertion in this file
# is kept below.


def test_snapshot_keeps_self_data_but_omits_aggregate_without_dashboard_capability(
    workforce_api_db: Session,
) -> None:
    employee = _add_employee(workforce_api_db, "G-SELF", name="Self employee")
    user = _create_user(
        workforce_api_db,
        email="self-only@test.ae",
        employee_id=employee.id,
    )
    _grant(workforce_api_db, user, "workforce.self.view")

    with _client_for(workforce_api_db, user) as client:
        response = client.get("/api/v1/workforce/dashboard/snapshot")

    assert response.status_code == 200
    payload = response.json()
    assert payload["self"]["employee_id"] == employee.id
    assert "aggregate" not in payload
    assert not _contains_value(payload, "Self employee")


def test_aggregate_dashboard_routes_require_dashboard_capability(
    workforce_api_db: Session,
) -> None:
    user = _create_user(workforce_api_db, email="not-a-manager@test.ae")

    with _client_for(workforce_api_db, user) as client:
        analytics = client.get("/api/v1/workforce/dashboard/analytics")
        coverage = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={"operational_date": TODAY.isoformat(), "parent_kind": "organization"},
        )

    assert analytics.status_code == 403
    assert coverage.status_code == 403


def test_dashboard_scope_filters_can_narrow_but_never_widen_a_manager_scope(
    workforce_api_db: Session,
) -> None:
    from app.db.workforce_models import UserWorkforceScope

    manager = _create_user(workforce_api_db, email="scoped-manager@test.ae", role="manager")
    _grant(workforce_api_db, manager, "workforce.dashboard.view")
    _seed_coverage_cases(workforce_api_db, manager)
    workforce_api_db.add(
        UserWorkforceScope(
            user_id=manager.id,
            scope_kind="department",
            department="Operations",
            created_by_user_id=manager.id,
        )
    )
    workforce_api_db.commit()

    with _client_for(workforce_api_db, manager) as client:
        response = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={"operational_date": TODAY.isoformat(), "parent_kind": "organization"},
        )

    assert response.status_code == 200
    assert [row["department"] for row in response.json()["items"]] == ["Operations"]


@pytest.mark.parametrize(
    ("scope_kind", "duty_post"),
    [("duty_unit", None), ("duty_post", "Post A")],
)
def test_narrow_scope_managers_can_traverse_coverage_ancestors_without_leakage(
    workforce_api_db: Session,
    scope_kind: str,
    duty_post: str | None,
) -> None:
    from app.db.workforce_models import UserWorkforceScope

    manager = _create_user(workforce_api_db, email=f"{scope_kind}-coverage@test.ae", role="manager")
    _grant(workforce_api_db, manager, "workforce.dashboard.view")
    _seed_coverage_cases(workforce_api_db, manager)
    workforce_api_db.add(
        UserWorkforceScope(
            user_id=manager.id,
            scope_kind=scope_kind,
            department="Operations",
            duty_unit="Gate A",
            duty_post=duty_post,
            created_by_user_id=manager.id,
        )
    )
    workforce_api_db.commit()

    with _client_for(workforce_api_db, manager) as client:
        organization = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={"operational_date": TODAY.isoformat(), "parent_kind": "organization"},
        )
        department = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={"operational_date": TODAY.isoformat(), "parent_kind": "department", "department": "Operations"},
        )
        unit = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={
                "operational_date": TODAY.isoformat(),
                "parent_kind": "duty_unit",
                "department": "Operations",
                "duty_unit": "Gate A",
            },
        )

    assert organization.status_code == 200
    assert department.status_code == 200
    assert unit.status_code == 200
    assert [row["department"] for row in organization.json()["items"]] == ["Operations"]
    assert [row["duty_unit"] for row in department.json()["items"]] == ["Gate A"]
    assert [row["duty_post"] for row in unit.json()["items"]] == ["Post A"]
    rendered = json.dumps([organization.json(), department.json(), unit.json()])
    assert "Gate B" not in rendered
    assert "Post B" not in rendered
    assert "G-COVERAGE-A" not in rendered
    assert "Coverage A" not in rendered
    assert "G-COVERAGE-B" not in rendered
    assert "Coverage B" not in rendered


def test_coverage_normalizes_legacy_snapshot_whitespace_before_scope_intersection(
    workforce_api_db: Session,
) -> None:
    from app.db.workforce_models import AttendanceCase, UserWorkforceScope

    manager = _create_user(workforce_api_db, email="whitespace-coverage@test.ae", role="manager")
    _grant(workforce_api_db, manager, "workforce.dashboard.view")
    _seed_coverage_cases(workforce_api_db, manager)
    for case in workforce_api_db.scalars(select(AttendanceCase)).all():
        case.department_snapshot = f" {case.department_snapshot} "
        case.duty_unit_snapshot = f" {case.duty_unit_snapshot} "
        case.duty_post_snapshot = f" {case.duty_post_snapshot} "
    workforce_api_db.add(
        UserWorkforceScope(
            user_id=manager.id,
            scope_kind="duty_post",
            department="Operations",
            duty_unit="Gate A",
            duty_post="Post A",
            created_by_user_id=manager.id,
        )
    )
    workforce_api_db.commit()

    with _client_for(workforce_api_db, manager) as client:
        organization = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={"operational_date": TODAY.isoformat(), "parent_kind": "organization"},
        )
        department = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={"operational_date": TODAY.isoformat(), "parent_kind": "department", "department": " Operations "},
        )
        unit = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={
                "operational_date": TODAY.isoformat(),
                "parent_kind": "duty_unit",
                "department": " Operations ",
                "duty_unit": " Gate A ",
            },
        )

    assert organization.status_code == 200
    assert department.status_code == 200
    assert unit.status_code == 200
    assert [row["department"] for row in organization.json()["items"]] == ["Operations"]
    assert [row["duty_unit"] for row in department.json()["items"]] == ["Gate A"]
    assert [row["duty_post"] for row in unit.json()["items"]] == ["Post A"]


def test_coverage_children_are_bounded_paginated_and_never_person_records(
    workforce_api_db: Session,
) -> None:
    admin = _create_user(workforce_api_db, email="coverage-admin@test.ae", role="admin")
    _seed_coverage_cases(workforce_api_db, admin)

    with _client_for(workforce_api_db, admin) as client:
        rejected_limit = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={
                "operational_date": TODAY.isoformat(),
                "parent_kind": "department",
                "department": "Operations",
                "limit": 501,
            },
        )
        root = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={"operational_date": TODAY.isoformat(), "parent_kind": "organization"},
        )
        first = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={
                "operational_date": TODAY.isoformat(),
                "parent_kind": "department",
                "department": "Operations",
                "limit": 1,
            },
        )

        assert first.status_code == 200
        first_page = first.json()
        second = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={
                "operational_date": TODAY.isoformat(),
                "parent_kind": "department",
                "department": "Operations",
                "limit": 1,
                "cursor": first_page["next_cursor"],
            },
        )

    assert rejected_limit.status_code == 422
    assert root.status_code == 200
    assert [row["kind"] for row in root.json()["items"]] == ["department"]
    assert set(first_page) == {"items", "next_cursor"}
    assert len(first_page["items"]) == 1
    assert first_page["next_cursor"]
    assert second.status_code == 200
    assert len(second.json()["items"]) == 1
    assert second.json()["next_cursor"] is None
    rendered = json.dumps([first_page, second.json()])
    assert "G-COVERAGE-A" not in rendered
    assert "G-COVERAGE-B" not in rendered
    assert "Coverage A" not in rendered
    assert "Coverage B" not in rendered


def test_coverage_requires_the_matching_parent_filters(workforce_api_db: Session) -> None:
    admin = _create_user(workforce_api_db, email="coverage-validation@test.ae", role="admin")
    _seed_coverage_cases(workforce_api_db, admin)

    with _client_for(workforce_api_db, admin) as client:
        organization_with_parent = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={"operational_date": TODAY.isoformat(), "parent_kind": "organization", "department": "Operations"},
        )
        department_without_parent = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={"operational_date": TODAY.isoformat(), "parent_kind": "department"},
        )
        post_without_unit = client.get(
            "/api/v1/workforce/dashboard/coverage",
            params={"operational_date": TODAY.isoformat(), "parent_kind": "duty_unit", "department": "Operations"},
        )

    assert organization_with_parent.status_code == 422
    assert department_without_parent.status_code == 422
    assert post_without_unit.status_code == 422


def test_analytics_folds_small_nationality_groups_without_person_leakage(
    workforce_api_db: Session,
) -> None:
    from app.db.models import AppSetting

    admin = _create_user(workforce_api_db, email="analytics-admin@test.ae", role="admin")
    _add_employee(
        workforce_api_db,
        "G-NAT-1",
        name="UAE one",
        nationality="United Arab Emirates",
    )
    _add_employee(
        workforce_api_db,
        "G-NAT-2",
        name="UAE two",
        nationality="United Arab Emirates",
    )
    _add_employee(workforce_api_db, "G-NAT-3", name="Small group", nationality="Canada")
    _add_employee(workforce_api_db, "G-NAT-4", name="Missing nationality", nationality=None)
    workforce_api_db.add(
        AppSetting(key="workforce.nationality_fold_min_count", value=json.dumps(2))
    )
    workforce_api_db.commit()

    with _client_for(workforce_api_db, admin) as client:
        response = client.get("/api/v1/workforce/dashboard/analytics")

    assert response.status_code == 200
    payload = response.json()
    # With a floor of 2, the single Canadian cannot be published as "Other: 1" —
    # that bucket is itself below the threshold and identifies one person, so it
    # is suppressed. The disclosable UAE group is kept intact.
    assert payload["nationality_distribution"] == [
        {"nationality": "United Arab Emirates", "count": 2},
        {"nationality": "Not recorded", "count": 1},
    ]
    rendered = json.dumps(payload)
    assert "Canada" not in rendered
    assert "Small group" not in rendered
    assert "G-NAT-3" not in rendered


def test_stale_source_and_queued_recalculation_suppress_attendance_judgments(
    workforce_api_db: Session,
) -> None:
    from app.db.models import AppSetting
    from app.db.workforce_models import AttendanceEvaluationQueue, AttendanceSyncState

    admin = _create_user(workforce_api_db, email="health-admin@test.ae", role="admin")
    _seed_coverage_cases(workforce_api_db, admin)
    workforce_api_db.add(
        AppSetting(key="workforce.stale_after_minutes", value=json.dumps(30))
    )
    punches = workforce_api_db.get(AttendanceSyncState, {"provider": "biotime", "stream": "punches"})
    assert punches is not None
    punches.fresh_through = NOW - timedelta(hours=1)
    workforce_api_db.add(
        AttendanceEvaluationQueue(
            employee_id="G-COVERAGE-A",
            window_start_at=NOW - timedelta(hours=1),
            window_end_at=NOW + timedelta(hours=1),
            reason_codes=["PUNCH_IMPORTED"],
            available_at=NOW,
            attempts=0,
        )
    )
    workforce_api_db.commit()

    with _client_for(workforce_api_db, admin) as client:
        response = client.get("/api/v1/workforce/dashboard/snapshot")

    assert response.status_code == 200
    current_shift = response.json()["current_shift"]
    assert current_shift["scheduled"] == 2
    assert current_shift["evaluated_count"] == 0
    assert current_shift["pending_or_error_excluded_count"] == 1
    assert current_shift["working"] is None
    assert current_shift["verified_roster_gap"] is None
    assert current_shift["verified_coverage_percent"] is None
    assert current_shift["staffing_status"] is None
    assert response.json()["sync_health"]["punches"]["state"] == "stale"
