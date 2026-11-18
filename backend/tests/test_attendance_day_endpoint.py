"""GET /workforce/attendance/day — the register payload.

Contract under test:
  * one row per person per scheduled shift for the operational date;
  * first_punch_at / last_punch_at / punch_count come from the punches the
    evaluator would accept as evidence, so the register can print "05:47" and
    "+17m" — NOT from attendance_punch_assignments, which stays empty on this
    build because no punch carries a direction;
  * a person with no punch reports no bounds and no lateness, never a zero;
  * on_leave is true only for an excused-leave evaluation, because a person on
    approved leave leaves the coverage denominator instead of reading as a gap;
  * the shift_code filter narrows to one window.

All arrangement goes through tests.factories.attendance: seed_workforce_roster
alone creates no memberships, occurrences or cases.
"""

from __future__ import annotations

from datetime import date, datetime, time

import pytest

from app.db.models import Leave
from app.db.workforce_models import AttendanceEvaluation
from app.services import (
    attendance_correction_service,
    attendance_evaluation_service,
    workforce_read_service,
)
from app.services.workforce_scope_service import resolve_workforce_scope
from tests.factories.attendance import build_attendance_day, local
from tests.test_workforce_api_permissions import _client

DAY = date(2026, 8, 19)


def test_day_rows_carry_punch_bounds(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("البوابة الرئيسية", 2)],
        punches={None: [time(4, 47), time(12, 6)]},
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    rows = workforce_read_service.list_attendance_day(db_session, scope=scope, operational_date=DAY)

    assert rows, "the factory day must produce rows"
    morning = [row for row in rows if row["shift_code"] == "morning"]
    assert morning, "19 Aug has a morning shift for this crew"
    row = morning[0]
    assert row["punch_count"] == 2
    assert row["first_punch_at"] is not None
    assert row["last_punch_at"] is not None
    assert row["first_punch_at"] < row["last_punch_at"]
    assert row["on_leave"] is False
    # 04:47 local is 13 minutes before a 05:00 start, so there is no lateness.
    assert row["late_minutes"] == 0


def test_late_arrival_reports_raw_minutes_past_the_scheduled_start(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("التفتيش", 1)],
        punches={None: [time(5, 47)]},
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    rows = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY, shift_code="morning"
    )

    assert len(rows) == 1
    # Raw lateness, grace NOT subtracted: the client owns that presentation.
    assert rows[0]["late_minutes"] == 47
    assert rows[0]["punch_count"] == 1


def test_a_person_with_no_punch_reports_no_bounds(db_session) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("التفتيش", 1)])
    scope = resolve_workforce_scope(db_session, fixture.admin)

    rows = workforce_read_service.list_attendance_day(db_session, scope=scope, operational_date=DAY)

    assert rows
    assert rows[0]["punch_count"] == 0
    assert rows[0]["first_punch_at"] is None
    assert rows[0]["last_punch_at"] is None
    assert rows[0]["late_minutes"] is None, "absent is not the same as on time"


def test_shift_code_filter_narrows_the_day(db_session) -> None:
    fixture = build_attendance_day(
        db_session, operational_date=DAY, posts=[("البوابة الرئيسية", 2)]
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    everything = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY
    )
    codes = {row["shift_code"] for row in everything}
    assert codes == {"morning", "night"}, "19 Aug is the rotation's double day"

    narrowed = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY, shift_code="morning"
    )

    assert narrowed
    assert {row["shift_code"] for row in narrowed} == {"morning"}
    assert len(narrowed) == len(everything) // 2


def test_double_shift_rows_publish_their_exact_case_ids(db_session) -> None:
    fixture = build_attendance_day(
        db_session, operational_date=DAY, posts=[("البوابة الرئيسية", 1)]
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    rows = workforce_read_service.list_attendance_day(db_session, scope=scope, operational_date=DAY)

    employee = fixture.employees[0]
    expected = {
        case.shift_code_snapshot: case.id
        for case in fixture.cases
        if case.employee_id == employee.id
    }
    assert expected.keys() == {"morning", "night"}
    actual = {
        row["shift_code"]: row["case_id"] for row in rows if row["employee_id"] == employee.id
    }
    assert actual == expected


def test_rows_group_by_the_duty_hierarchy_the_register_prints(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("البوابة الرئيسية", 2), ("برج المراقبة", 1)],
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    rows = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY, shift_code="morning"
    )

    assert {row["duty_unit"] for row in rows} == {"السرية الثانية"}
    assert {row["duty_post"] for row in rows} == {"البوابة الرئيسية", "برج المراقبة"}
    assert all(row["name_en"] for row in rows), "the register prints names"


@pytest.mark.parametrize("correction", ["none", "departure", "clear"])
def test_day_rows_expose_latest_and_corrected_final_out(api_db, correction) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    latest = AttendanceEvaluation(
        attendance_case_id=case.id,
        revision=2,
        presence_state="completed",
        reason_code="SHIFT_COMPLETED",
        final_out_at=datetime(2026, 8, 19, 9),
        algorithm_version="read-contract",
        input_fingerprint="latest-final-out",
    )
    api_db.add(latest)
    api_db.flush()
    expected = "2026-08-19T09:00:00Z"
    if correction != "none":
        departure = datetime(2026, 8, 19, 9, 30) if correction == "departure" else None
        attendance_correction_service.correct(
            api_db,
            scope=resolve_workforce_scope(api_db, fixture.admin),
            case_id=case.id,
            snapshot={
                "replacement_presence_state": "completed",
                "replacement_first_in_at": None,
                "replacement_latest_in_at": None,
                "replacement_final_out_at": departure,
                "replacement_late_minutes": None,
                "replacement_early_exit_minutes": None,
                "replacement_missing_checkout": False,
                "reason": "Verified departure against the supervisor register",
            },
            if_match=attendance_correction_service.case_etag(api_db, case.id),
            actor=fixture.admin,
        )
        expected = "2026-08-19T09:30:00Z" if departure else None
    api_db.commit()

    response = _client(api_db, fixture.admin).get(
        "/api/v1/workforce/attendance/day", params={"operational_date": DAY.isoformat()}
    )

    assert response.status_code == 200, response.text
    row = next(row for row in response.json()["items"] if row["case_id"] == case.id)
    assert row["final_out_at"] == expected
    assert row["leave_kind"] is None
    assert row["leave_label"] is None


def test_day_rows_expose_primary_duty_and_other_leave_labels(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 2)])
    duty, hajj = fixture.employees
    api_db.add_all(
        [
            Leave(
                employee_id=duty.id,
                leave_type="Duty Leave - إجازة مهمة رسمية",
                status="Approved",
                start_date=DAY,
                end_date=DAY,
            ),
            Leave(
                employee_id=duty.id,
                leave_type="Hajj Leave - إجازة حج",
                status="Approved",
                start_date=DAY,
                end_date=DAY,
            ),
            Leave(
                employee_id=hajj.id,
                leave_type="Hajj Leave - إجازة حج",
                status="Approved",
                start_date=DAY,
                end_date=DAY,
            ),
        ]
    )
    api_db.flush()
    for case in fixture.cases:
        attendance_evaluation_service.evaluate_case(
            api_db, case.id, evaluated_at=local(DAY, time(23, 59))
        )
    api_db.commit()

    response = _client(api_db, fixture.admin).get(
        "/api/v1/workforce/attendance/day", params={"operational_date": DAY.isoformat()}
    )

    assert response.status_code == 200, response.text
    rows = response.json()["items"]
    assert rows
    for row in rows:
        expected = (
            ("duty", "Duty Leave") if row["employee_id"] == duty.id else ("other", "Hajj Leave")
        )
        assert (row["leave_kind"], row["leave_label"]) == expected
        assert row["on_leave"] is True
