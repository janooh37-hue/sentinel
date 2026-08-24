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

from datetime import date, time

from app.services import workforce_read_service
from app.services.workforce_scope_service import resolve_workforce_scope
from tests.factories.attendance import build_attendance_day

DAY = date(2026, 8, 19)


def test_day_rows_carry_punch_bounds(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("البوابة الرئيسية", 2)],
        punches={None: [time(4, 47), time(12, 6)]},
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    rows = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY
    )

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
    fixture = build_attendance_day(
        db_session, operational_date=DAY, posts=[("التفتيش", 1)]
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    rows = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY
    )

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

    rows = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY
    )

    employee = fixture.employees[0]
    expected = {
        case.shift_code_snapshot: case.id
        for case in fixture.cases
        if case.employee_id == employee.id
    }
    assert expected.keys() == {"morning", "night"}
    actual = {
        row["shift_code"]: row["case_id"]
        for row in rows
        if row["employee_id"] == employee.id
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
