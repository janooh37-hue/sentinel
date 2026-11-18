"""GET /workforce/employees/{id}/attendance — the per-employee month.

Contract under test:
  * every scheduled day in the window appears once, with its shift code,
    presence state, late minutes and its own punch list;
  * each punch carries its device but never a direction, because this provider
    reports none;
  * a user holding only workforce.self.view may read their OWN linked employee
    and nobody else's;
  * an over-wide or inverted window is refused as a 422, never a 500.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pytest

from app.api.errors import AppError, ValidationFailedError
from app.db.models import Leave
from app.db.workforce_models import AttendanceEvaluation, AttendancePunchProfile
from app.services import (
    attendance_correction_service,
    attendance_evaluation_service,
    perm_service,
    workforce_read_service,
)
from app.services.workforce_scope_service import (
    WorkforceScope,
    WorkforceScopeEntry,
    resolve_workforce_scope,
)
from tests.conftest import make_user
from tests.factories.attendance import build_attendance_day, local

# `api_db` is a file-backed SQLite session with check_same_thread=False and a
# monkeypatched SessionLocal, which is what lets TestClient's worker thread
# share the test's database. A conftest `db_session` cannot: SQLite objects are
# thread-affine, so API calls would raise ProgrammingError.
from tests.test_workforce_api_permissions import _client, _scope

DAY = date(2026, 8, 19)


def test_range_returns_one_entry_per_scheduled_day_with_its_punches(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("البوابة الرئيسية", 1)],
        punches={None: [time(4, 52), time(12, 40)]},
    )
    employee_id = fixture.employees[0].id
    scope = resolve_workforce_scope(db_session, fixture.admin)

    payload = workforce_read_service.employee_attendance_range(
        db_session,
        scope=scope,
        employee_id=employee_id,
        from_date=date(2026, 8, 1),
        to_date=date(2026, 8, 31),
    )

    assert payload["employee_id"] == employee_id
    assert payload["days"], "a rostered employee has scheduled days in August"
    keys = [(day["operational_date"], day["shift_code"]) for day in payload["days"]]
    assert len(keys) == len(set(keys)), "one entry per day per shift, never duplicated"
    for day in payload["days"]:
        assert day["shift_code"] in {"morning", "noon", "night", "office_day"}
        assert isinstance(day["punches"], list)

    punched = [day for day in payload["days"] if day["punch_count"] > 0]
    assert punched, "the punches the factory attached must appear"
    assert punched[0]["punches"][0]["device_name"] == "Main Gate Turnstile"
    assert "direction" not in punched[0]["punches"][0], (
        "this provider reports no direction, so the payload must not imply one"
    )


def test_each_day_publishes_the_grace_and_both_judgment_boundaries(db_session) -> None:
    """A client must judge by the policy, never by a constant of its own.

    `absence_due_at` is the earlier boundary — twice the grace past the start —
    and `judgment_due_at` the later one. Without both, a month grid cannot tell a
    duty still waiting for its arrival from a start that was never answered, and
    a hardcoded grace would draw the late line somewhere the evaluator does not.
    """
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("البوابة الرئيسية", 1)],
        punches={None: [time(4, 52)]},
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    payload = workforce_read_service.employee_attendance_range(
        db_session,
        scope=scope,
        employee_id=fixture.employees[0].id,
        from_date=DAY,
        to_date=DAY,
    )

    assert payload["days"], "the factory rosters this employee on the day under test"
    for day in payload["days"]:
        assert day["grace_minutes"] == 30
        assert day["absence_due_at"] == day["scheduled_start_at"] + timedelta(minutes=60)
        assert day["judgment_due_at"] == day["scheduled_end_at"] + timedelta(minutes=120)


def test_self_view_reads_own_record_only(api_db) -> None:
    """workforce.self.view is a self-scoped grant, not a roster grant."""
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("البوابة الرئيسية", 2)])
    mine, theirs = fixture.employees[0], fixture.employees[1]

    viewer = make_user(api_db, role="operator", email="self-view@test.ae")
    viewer.employee_id = mine.id
    perm_service.set_user_override(api_db, viewer.id, "workforce.self.view", "grant")
    api_db.commit()

    client = _client(api_db, viewer)
    params = {"from_date": "2026-08-01", "to_date": "2026-08-31"}

    ok = client.get(f"/api/v1/workforce/employees/{mine.id}/attendance", params=params)
    assert ok.status_code == 200, ok.text
    assert ok.json()["employee_id"] == mine.id

    denied = client.get(f"/api/v1/workforce/employees/{theirs.id}/attendance", params=params)
    assert denied.status_code == 403, denied.text


def test_foreign_range_denies_before_loading_punch_habits(db_session, monkeypatch) -> None:
    fixture = build_attendance_day(
        db_session, operational_date=DAY, posts=[("البوابة الرئيسية", 1)]
    )
    target = fixture.employees[0]
    target.department = "Finance"
    db_session.add(
        AttendancePunchProfile(
            employee_id=target.id,
            shift_code="morning",
            sample_days=10,
            arrival_early_offset=-30,
            arrival_typical_offset=5,
            departure_typical_offset=0,
            departure_late_offset=30,
            suggested_shift_code=None,
            window_days=30,
        )
    )
    db_session.commit()
    scope = WorkforceScope(
        entries=(WorkforceScopeEntry(scope_kind="department", department="Operations"),)
    )
    original_scalars = db_session.scalars
    profile_queries = []

    def recording_scalars(statement, *args, **kwargs):
        if "attendance_punch_profiles" in str(statement):
            profile_queries.append(statement)
        return original_scalars(statement, *args, **kwargs)

    monkeypatch.setattr(db_session, "scalars", recording_scalars)
    with pytest.raises(AppError) as denied:
        workforce_read_service.employee_attendance_range(
            db_session,
            scope=scope,
            employee_id=target.id,
            from_date=date(2026, 8, 1),
            to_date=date(2026, 8, 31),
        )
    assert denied.value.code == "FORBIDDEN"
    assert profile_queries == []


def test_roster_reader_needs_both_review_and_people_view(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("التفتيش", 1)])
    target = fixture.employees[0]

    half = make_user(api_db, role="operator", email="half-capability@test.ae")
    _scope(api_db, half, kind="organization")
    perm_service.set_user_override(api_db, half.id, "workforce.people.view", "grant")
    api_db.commit()

    response = _client(api_db, half).get(
        f"/api/v1/workforce/employees/{target.id}/attendance",
        params={"from_date": "2026-08-01", "to_date": "2026-08-31"},
    )
    assert response.status_code == 403, response.text

    perm_service.set_user_override(api_db, half.id, "workforce.attendance.review", "grant")
    api_db.commit()

    allowed = _client(api_db, half).get(
        f"/api/v1/workforce/employees/{target.id}/attendance",
        params={"from_date": "2026-08-01", "to_date": "2026-08-31"},
    )
    assert allowed.status_code == 200, allowed.text


@pytest.mark.parametrize(
    ("from_date", "to_date"),
    [
        (date(2026, 1, 1), date(2026, 12, 31)),  # wider than 92 days
        (date(2026, 8, 31), date(2026, 8, 1)),  # inverted
    ],
)
def test_invalid_windows_are_rejected(db_session, from_date: date, to_date: date) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("التفتيش", 1)])
    scope = resolve_workforce_scope(db_session, fixture.admin)

    with pytest.raises(ValidationFailedError):
        workforce_read_service.employee_attendance_range(
            db_session,
            scope=scope,
            employee_id=fixture.employees[0].id,
            from_date=from_date,
            to_date=to_date,
        )


def test_over_wide_window_is_a_422_through_the_api(api_db) -> None:
    """The bound must surface as 422, not as a 500 from the catch-all handler."""
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("التفتيش", 1)])

    response = _client(api_db, fixture.admin).get(
        f"/api/v1/workforce/employees/{fixture.employees[0].id}/attendance",
        params={"from_date": "2026-01-01", "to_date": "2026-12-31"},
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "ATTENDANCE_RANGE_TOO_WIDE"


@pytest.mark.parametrize(
    ("leave_type", "leave_kind", "leave_label"),
    [
        ("Duty Leave - إجازة مهمة رسمية", "duty", "Duty Leave"),
        ("Hajj Leave - إجازة حج", "other", "Hajj Leave"),
    ],
)
def test_employee_days_expose_case_and_primary_leave(
    api_db, leave_type, leave_kind, leave_label
) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    employee = fixture.employees[0]
    api_db.add(
        Leave(
            employee_id=employee.id,
            leave_type=leave_type,
            status="Approved",
            start_date=DAY,
            end_date=DAY,
        )
    )
    api_db.flush()
    for case in fixture.cases:
        attendance_evaluation_service.evaluate_case(
            api_db, case.id, evaluated_at=local(DAY, time(23, 59))
        )
    api_db.commit()

    response = _client(api_db, fixture.admin).get(
        f"/api/v1/workforce/employees/{employee.id}/attendance",
        params={"from_date": DAY.isoformat(), "to_date": DAY.isoformat()},
    )

    assert response.status_code == 200, response.text
    days = response.json()["days"]
    assert {day["case_id"] for day in days} == {case.id for case in fixture.cases}
    assert {(day["leave_kind"], day["leave_label"]) for day in days} == {(leave_kind, leave_label)}


@pytest.mark.parametrize("corrected", [False, True])
def test_employee_days_expose_correction_aware_first_in(api_db, corrected) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    employee = fixture.employees[0]
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    api_db.add(
        AttendanceEvaluation(
            attendance_case_id=case.id,
            revision=2,
            presence_state="completed",
            reason_code="SHIFT_COMPLETED",
            first_in_at=datetime(2026, 8, 19, 1, 10),
            algorithm_version="read-contract",
            input_fingerprint="employee-first-in",
        )
    )
    api_db.flush()
    if corrected:
        attendance_correction_service.correct(
            api_db,
            scope=resolve_workforce_scope(api_db, fixture.admin),
            case_id=case.id,
            snapshot={
                "replacement_presence_state": "completed",
                "replacement_first_in_at": datetime(2026, 8, 19, 1, 2),
                "replacement_latest_in_at": None,
                "replacement_final_out_at": None,
                "replacement_late_minutes": None,
                "replacement_early_exit_minutes": None,
                "replacement_missing_checkout": False,
                "reason": "Arrival verified against the gate register",
            },
            if_match=attendance_correction_service.case_etag(api_db, case.id),
            actor=fixture.admin,
        )
    api_db.commit()

    response = _client(api_db, fixture.admin).get(
        f"/api/v1/workforce/employees/{employee.id}/attendance",
        params={"from_date": DAY.isoformat(), "to_date": DAY.isoformat()},
    )

    assert response.status_code == 200, response.text
    day = next(day for day in response.json()["days"] if day["case_id"] == case.id)
    assert day["first_in_at"] == ("2026-08-19T01:02:00Z" if corrected else "2026-08-19T01:10:00Z")
    assert day["corrected"] is corrected
