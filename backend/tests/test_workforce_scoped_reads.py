from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import event

from app.db.models import Employee
from app.db.workforce_models import (
    AttendanceEvaluation,
    DutyAssignmentEvent,
    WorkCrew,
    WorkCrewMembership,
    WorkShiftOverride,
)
from app.services import perm_service, workforce_read_service
from app.services.workforce_access_service import organization_scope
from app.services.workforce_scope_service import WorkforceScope, WorkforceScopeEntry
from tests.test_workforce_api_permissions import _client, _scope, _user


def _employee(employee_id: str, *, department: str) -> Employee:
    return Employee(
        id=employee_id,
        name_en=employee_id,
        status="Active",
        department=department,
        duty_unit="Gate 1",
        duty_post="North",
    )


def test_override_visibility_is_filtered_before_limit_and_pagination(api_db) -> None:
    manager = _user(api_db, email="override-scope@test.ae")
    perm_service.set_user_override(api_db, manager.id, "workforce.schedule.manage", "grant")
    _scope(api_db, manager, kind="department", department="Operations")
    allowed_employee = _employee("G-OVERRIDE-ALLOWED", department="Operations")
    foreign_employee = _employee("G-OVERRIDE-FOREIGN", department="Finance")
    api_db.add_all([allowed_employee, foreign_employee])
    api_db.flush()
    start = datetime(2026, 8, 1, 4)
    allowed = [
        WorkShiftOverride(
            employee_id=allowed_employee.id,
            assignment_kind="off",
            reason_kind="other",
            starts_at=start + timedelta(days=index),
            ends_at=start + timedelta(days=index, hours=8),
            reason="Allowed",
            created_by_user_id=manager.id,
        )
        for index in range(3)
    ]
    api_db.add_all(allowed)
    api_db.flush()
    allowed_ids = [row.id for row in allowed]
    api_db.add_all(
        [
            WorkShiftOverride(
                employee_id=foreign_employee.id,
                assignment_kind="off",
                reason_kind="other",
                starts_at=start + timedelta(days=10 + index),
                ends_at=start + timedelta(days=10 + index, hours=8),
                reason="Foreign",
                created_by_user_id=manager.id,
            )
            for index in range(500)
        ]
    )
    api_db.commit()

    client = _client(api_db, manager)
    first = client.get("/api/v1/workforce/overrides?limit=2")
    assert first.status_code == 200, first.text
    assert [row["id"] for row in first.json()["items"]] == [
        allowed_ids[2],
        allowed_ids[1],
    ]
    second = client.get(
        "/api/v1/workforce/overrides",
        params={"limit": 2, "cursor": first.json()["next_cursor"]},
    )
    assert second.status_code == 200, second.text
    assert [row["id"] for row in second.json()["items"]] == [allowed_ids[0]]

    assert (
        len(workforce_read_service.list_shift_overrides(api_db, scope=organization_scope())) == 503
    )
    assert workforce_read_service.list_shift_overrides(api_db, scope=WorkforceScope()) == []
    self_scope = WorkforceScope(
        entries=(WorkforceScopeEntry(scope_kind="self", employee_id=allowed_employee.id),)
    )
    assert [
        row.id for row in workforce_read_service.list_shift_overrides(api_db, scope=self_scope)
    ] == list(reversed(allowed_ids))


def test_crew_memberships_batch_employee_visibility_and_return_visible_etag(
    db_session, monkeypatch
) -> None:
    actor = _user(db_session, email="membership-read@test.ae")
    crew = WorkCrew(code="read-scope", name_en="Read Scope", active=True)
    allowed = _employee("G-MEMBER-ALLOWED", department="Operations")
    foreign = _employee("G-MEMBER-FOREIGN", department="Finance")
    db_session.add_all([crew, allowed, foreign])
    db_session.flush()
    starts = datetime(2026, 8, 1, 4)
    db_session.add_all(
        [
            WorkCrewMembership(
                crew_id=crew.id,
                employee_id=employee.id,
                effective_from=starts,
                created_by_user_id=actor.id,
                updated_by_user_id=actor.id,
            )
            for employee in (allowed, foreign)
        ]
    )
    db_session.commit()
    crew_id = crew.id
    allowed_id = allowed.id
    scope = WorkforceScope(
        entries=(WorkforceScopeEntry(scope_kind="department", department="Operations"),)
    )
    original_get = db_session.get

    def reject_per_employee_get(model, identity, *args, **kwargs):
        if model is Employee:
            raise AssertionError("membership visibility must batch employee lookup")
        return original_get(model, identity, *args, **kwargs)

    monkeypatch.setattr(db_session, "get", reject_per_employee_get)

    def read_with_statement_counts():
        selects: list[str] = []

        def record_select(_connection, _cursor, statement, _parameters, _context, _many):
            normalized = " ".join(statement.lower().split())
            if normalized.startswith("select"):
                selects.append(normalized)

        bind = db_session.get_bind()
        event.listen(bind, "before_cursor_execute", record_select)
        db_session.expire_all()
        try:
            result = workforce_read_service.list_crew_memberships(
                db_session, crew_id=crew_id, scope=scope
            )
        finally:
            event.remove(bind, "before_cursor_execute", record_select)
        counts = {
            "crew": sum(" from work_crews " in statement for statement in selects),
            "memberships": sum(
                " from work_crew_memberships " in statement for statement in selects
            ),
            "employees": sum(" from employees " in statement for statement in selects),
        }
        assert len(selects) == sum(counts.values()), selects
        return result, counts

    (rows, etag), initial_counts = read_with_statement_counts()

    assert [row.employee_id for row in rows] == [allowed_id]
    assert etag.startswith('"') and etag.endswith('"')
    assert initial_counts == {"crew": 1, "memberships": 1, "employees": 1}
    organization_rows, _ = workforce_read_service.list_crew_memberships(
        db_session, crew_id=crew_id, scope=organization_scope()
    )
    empty_rows, _ = workforce_read_service.list_crew_memberships(
        db_session, crew_id=crew_id, scope=WorkforceScope()
    )
    self_rows, _ = workforce_read_service.list_crew_memberships(
        db_session,
        crew_id=crew_id,
        scope=WorkforceScope(
            entries=(WorkforceScopeEntry(scope_kind="self", employee_id=allowed_id),)
        ),
    )
    assert [row.employee_id for row in organization_rows] == [allowed_id, foreign.id]
    assert empty_rows == []
    assert [row.employee_id for row in self_rows] == [allowed_id]

    extra_employees = [
        _employee(
            f"G-MEMBER-{index:03d}",
            department="Operations" if index % 2 == 0 else "Finance",
        )
        for index in range(30)
    ]
    db_session.add_all(extra_employees)
    db_session.flush()
    db_session.add_all(
        [
            WorkCrewMembership(
                crew_id=crew_id,
                employee_id=employee.id,
                effective_from=starts,
                created_by_user_id=actor.id,
                updated_by_user_id=actor.id,
            )
            for employee in extra_employees
        ]
    )
    db_session.commit()

    (grown_rows, grown_etag), grown_counts = read_with_statement_counts()
    assert len(grown_rows) == 16
    assert grown_etag != etag
    assert grown_counts == initial_counts


def test_exception_sorting_uses_literal_severity_then_employee_and_case(db_session) -> None:
    from datetime import date

    from tests.factories.attendance import build_attendance_day

    fixture = build_attendance_day(
        db_session, operational_date=date(2026, 8, 19), posts=[("Gate 1", 5)]
    )
    cases = sorted(fixture.cases, key=lambda row: row.employee_id)[:5]
    assert len(cases) == 5
    values = [
        ("unknown", 0, 0, False),
        ("completed", 0, 5, False),
        ("completed", 5, 0, False),
        ("completed", 0, 0, True),
        ("absent", 0, 0, False),
    ]
    for case, (presence, late, early, missing) in zip(cases, values, strict=True):
        evaluation = (
            db_session.query(AttendanceEvaluation)
            .filter_by(attendance_case_id=case.id, revision=1)
            .one()
        )
        evaluation.presence_state = presence
        evaluation.reason_code = presence.upper()
        evaluation.late_minutes = late
        evaluation.early_exit_minutes = early
        evaluation.missing_checkout = missing
    db_session.commit()

    rows = workforce_read_service.list_exceptions(
        db_session,
        scope=organization_scope(),
        operational_date=date(2026, 8, 19),
    )
    target_ids = {case.id for case in cases}
    assert [row["case_id"] for row in rows if row["case_id"] in target_ids] == [
        cases[4].id,
        cases[3].id,
        cases[2].id,
        cases[1].id,
        cases[0].id,
    ]


def test_duty_event_reads_filter_captured_destination_for_all_scope_tiers(db_session) -> None:
    actor = _user(db_session, email="duty-events@test.ae")
    operations = _employee("G-EVENT-OPS", department="Operations")
    finance = _employee("G-EVENT-FIN", department="Finance")
    db_session.add_all([operations, finance])
    db_session.flush()
    when = datetime(2026, 8, 1, 4)
    db_session.add_all(
        [
            DutyAssignmentEvent(
                employee_id=employee.id,
                event_type="manual_change",
                to_department=employee.department,
                to_unit=employee.duty_unit,
                to_post=employee.duty_post,
                effective_at=when,
                actor_user_id=actor.id,
            )
            for employee in (operations, finance)
        ]
    )
    db_session.commit()
    operations_scope = WorkforceScope(
        entries=(WorkforceScopeEntry(scope_kind="department", department="Operations"),)
    )
    self_scope = WorkforceScope(
        entries=(WorkforceScopeEntry(scope_kind="self", employee_id=operations.id),)
    )

    assert [
        row["employee_id"]
        for row in workforce_read_service.list_duty_assignment_events(
            db_session, scope=operations_scope
        )
    ] == [operations.id]
    assert [
        row["employee_id"]
        for row in workforce_read_service.list_duty_assignment_events(db_session, scope=self_scope)
    ] == [operations.id]
    assert (
        workforce_read_service.list_duty_assignment_events(db_session, scope=WorkforceScope()) == []
    )
    assert (
        len(
            workforce_read_service.list_duty_assignment_events(
                db_session, scope=organization_scope()
            )
        )
        == 2
    )
