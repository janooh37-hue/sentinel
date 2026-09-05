"""RED API contracts for workforce capability, scope, privacy, and secret boundaries."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Employee, User, UserWorkforceScope
from app.db.session import get_db
from app.db.workforce_models import AttendanceEvaluationQueue, WorkCrew
from app.main import create_app
from app.services import attendance_sync_service, perm_service, scheduler_service, settings_service
from tests.factories.attendance import build_attendance_day


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
        response = client.post(path, json={}) if method == "post" else getattr(client, method)(path)
        assert response.status_code == 403, f"{method.upper()} {path}: {response.text}"


def test_crew_get_etag_is_valid_for_create_when_display_and_id_order_differ(
    api_db: Session,
) -> None:
    fixture = build_attendance_day(
        api_db, operational_date=date(2026, 8, 19), posts=[("Gate 1", 1)]
    )
    crews = list(api_db.scalars(select(WorkCrew).order_by(WorkCrew.id).limit(2)))
    assert len(crews) == 2
    crews[0].code = "zz-etag-order"
    crews[1].code = "aa-etag-order"
    api_db.commit()
    client = _client(api_db, fixture.admin)

    listed = client.get("/api/v1/workforce/crews?limit=500")
    assert listed.status_code == 200, listed.text
    displayed_codes = [item["code"] for item in listed.json()["items"]]
    assert displayed_codes == sorted(displayed_codes)
    assert displayed_codes.index("aa-etag-order") < displayed_codes.index("zz-etag-order")

    created = client.post(
        "/api/v1/workforce/crews",
        headers={"If-Match": listed.headers["etag"]},
        json={"code": "etag-new", "name_en": "ETag New Crew", "active": True},
    )
    assert created.status_code == 201, created.text


def test_department_manager_retains_capability_global_metadata_reads(
    api_db: Session,
) -> None:
    build_attendance_day(api_db, operational_date=date(2026, 8, 19), posts=[("Gate 1", 1)])
    manager = _user(api_db, email="global-metadata@test.ae")
    for capability in (
        "workforce.schedule.manage",
        "workforce.policy.manage",
        "workforce.integration.manage",
    ):
        perm_service.set_user_override(api_db, manager.id, capability, "grant")
    _scope(api_db, manager, kind="department", department="Operations")
    client = _client(api_db, manager)

    definitions = client.get("/api/v1/workforce/schedule/definitions")
    rotation = client.get("/api/v1/workforce/schedule/rotation")
    crews = client.get("/api/v1/workforce/crews")
    policies = client.get("/api/v1/workforce/policies")
    integration = client.get("/api/v1/workforce/integration/status")
    for response in (definitions, rotation, crews, policies, integration):
        assert response.status_code == 200, response.text

    crew_id = crews.json()["items"][0]["id"]
    crew = client.get(f"/api/v1/workforce/crews/{crew_id}")
    schedules = client.get(f"/api/v1/workforce/crews/{crew_id}/schedules")
    assert crew.status_code == 200, crew.text
    assert schedules.status_code == 200, schedules.text
    schedule_id = schedules.json()["items"][0]["id"]
    detail = client.get(f"/api/v1/workforce/crews/{crew_id}/schedules/{schedule_id}")
    assert detail.status_code == 200, detail.text


def test_department_manager_retains_capability_global_integration_actions(
    api_db: Session, monkeypatch
) -> None:
    fixture = build_attendance_day(
        api_db, operational_date=date(2026, 8, 19), posts=[("Gate 1", 1)]
    )
    manager = _user(api_db, email="global-integration@test.ae")
    perm_service.set_user_override(api_db, manager.id, "workforce.integration.manage", "grant")
    _scope(api_db, manager, kind="department", department="Operations")
    now = datetime(2026, 8, 20, tzinfo=UTC)
    failed = AttendanceEvaluationQueue(
        employee_id=fixture.employees[0].id,
        window_start_at=now - timedelta(days=1),
        window_end_at=now,
        reason_codes=["TEST"],
        available_at=now,
        failed_at=now,
        attempts=5,
        last_error_code="TEST_FAILURE",
    )
    api_db.add(failed)
    api_db.commit()

    class Provider:
        def test_connection(self):
            return SimpleNamespace(status="ok", summary="Synthetic provider")

    monkeypatch.setattr(
        scheduler_service, "_resolve_verified_attendance_provider", lambda: Provider()
    )
    monkeypatch.setattr(
        settings_service,
        "get_workforce_configuration",
        lambda _db: SimpleNamespace(initial_backfill_start_at=now - timedelta(days=30)),
    )
    monkeypatch.setattr(attendance_sync_service, "sync_people", lambda *args, **kwargs: 2)
    monkeypatch.setattr(attendance_sync_service, "sync_punches", lambda *args, **kwargs: 3)
    client = _client(api_db, manager)

    tested = client.post("/api/v1/workforce/integration/test")
    synced = client.post("/api/v1/workforce/integration/sync")
    retried = client.post(f"/api/v1/workforce/integration/evaluation-queue/{failed.id}/retry")

    assert tested.status_code == 200, tested.text
    assert tested.json() == {"status": "ok", "summary": "Synthetic provider"}
    assert synced.status_code == 202, synced.text
    assert synced.json() == {"imported_people": 2, "imported_punches": 3}
    assert retried.status_code == 200, retried.text
    assert retried.json()["id"] == failed.id


def test_double_shift_attendance_responses_publish_exact_case_ids(api_db: Session) -> None:
    operational_date = date(2026, 8, 19)
    fixture = build_attendance_day(
        api_db, operational_date=operational_date, posts=[("البوابة الرئيسية", 1)]
    )
    client = _client(api_db, fixture.admin)
    employee = fixture.employees[0]
    expected = {
        case.shift_code_snapshot: case.id
        for case in fixture.cases
        if case.employee_id == employee.id
    }
    assert expected.keys() == {"morning", "night"}

    day = client.get(
        "/api/v1/workforce/attendance/day",
        params={"operational_date": operational_date.isoformat()},
    )
    assert day.status_code == 200, day.text
    day_case_ids = {
        row["shift_code"]: row["case_id"]
        for row in day.json()["items"]
        if row["employee_id"] == employee.id
    }
    assert day_case_ids == expected

    exceptions = client.get(
        "/api/v1/workforce/attendance/exceptions",
        params={"operational_date": operational_date.isoformat()},
    )
    assert exceptions.status_code == 200, exceptions.text
    exception_case_ids = {
        row["shift_code"]: row["case_id"]
        for row in exceptions.json()["items"]
        if row["employee_id"] == employee.id
    }
    assert exception_case_ids == expected


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
