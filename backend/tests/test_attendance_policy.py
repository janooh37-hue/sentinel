from __future__ import annotations

from datetime import UTC, date, datetime

from app.db.models import Employee
from app.db.workforce_models import (
    AttendanceCase,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.services.attendance_policy import policy_for, policy_for_case

NOW = datetime(2026, 8, 17, 12, tzinfo=UTC)


def _policy(
    db_session,
    admin_user,
    *,
    effective_from: date,
    effective_to: date | None = None,
    approved: bool = True,
    shift_definition_id: int | None = None,
) -> WorkAttendancePolicy:
    policy = WorkAttendancePolicy(
        shift_definition_id=shift_definition_id,
        grace_minutes=10,
        absence_after_minutes=30,
        early_exit_grace_minutes=10,
        match_before_minutes=60,
        match_after_minutes=60,
        require_checkout=True,
        effective_from=effective_from,
        effective_to=effective_to,
        created_by_user_id=admin_user.id,
        approved_by_user_id=admin_user.id if approved else None,
        approved_at=NOW if approved else None,
    )
    db_session.add(policy)
    db_session.flush()
    return policy


def _shift(db_session, code: str) -> WorkShiftDefinition:
    shift = WorkShiftDefinition(
        code=code,
        start_local_time=datetime.min.time(),
        duration_minutes=480,
    )
    db_session.add(shift)
    db_session.flush()
    return shift


def _occurrence_case(
    db_session,
    admin_user,
    *,
    shift: WorkShiftDefinition,
) -> AttendanceCase:
    employee = Employee(id="G-POLICY-CASE", name_en="Policy Case", name_ar="حالة سياسة")
    pattern = WorkRotationPattern(
        code="policy-pattern",
        name="Policy pattern",
        cycle_minutes=7_200,
        timezone="Asia/Dubai",
    )
    crew = WorkCrew(code="policy-crew", name_en="Policy crew")
    db_session.add_all((employee, pattern, crew))
    db_session.flush()
    schedule = WorkCrewSchedule(
        crew_id=crew.id,
        pattern_id=pattern.id,
        anchor_at=NOW,
        effective_from=NOW,
        version=1,
        created_by_user_id=admin_user.id,
    )
    db_session.add(schedule)
    db_session.flush()
    occurrence = WorkShiftOccurrence(
        crew_id=crew.id,
        crew_schedule_id=schedule.id,
        shift_definition_id=shift.id,
        starts_at=NOW,
        ends_at=NOW.replace(hour=20),
        operational_date=NOW.date(),
        pattern_code_snapshot=pattern.code,
        crew_schedule_version_snapshot=1,
        source_anchor_at=NOW,
    )
    db_session.add(occurrence)
    db_session.flush()
    case = AttendanceCase(
        employee_id=employee.id,
        shift_occurrence_id=occurrence.id,
        employee_status_snapshot="Active",
        crew_code_snapshot=crew.code,
        crew_name_snapshot=crew.name_en,
        shift_code_snapshot=shift.code,
        scheduled_start_at=occurrence.starts_at,
        scheduled_end_at=occurrence.ends_at,
        operational_date=occurrence.operational_date,
        organization_snapshot_state="captured",
    )
    db_session.add(case)
    db_session.flush()
    return case


def test_policy_for_returns_only_an_approved_general_policy(db_session, admin_user):
    approved = _policy(
        db_session,
        admin_user,
        effective_from=date(2026, 1, 1),
    )
    _policy(
        db_session,
        admin_user,
        effective_from=date(2026, 2, 1),
        approved=False,
    )

    resolved = policy_for(
        db_session,
        operational_date=date(2026, 3, 1),
        shift_definition_id=None,
    )

    assert resolved is approved


def test_shift_policy_beats_newer_general_while_other_shifts_use_general(db_session, admin_user):
    selected_shift = _shift(db_session, "selected")
    other_shift = _shift(db_session, "other")
    shift_policy = _policy(
        db_session,
        admin_user,
        effective_from=date(2026, 1, 1),
        shift_definition_id=selected_shift.id,
    )
    general = _policy(
        db_session,
        admin_user,
        effective_from=date(2026, 2, 1),
    )

    assert (
        policy_for(
            db_session,
            operational_date=date(2026, 3, 1),
            shift_definition_id=selected_shift.id,
        )
        is shift_policy
    )
    assert (
        policy_for(
            db_session,
            operational_date=date(2026, 3, 1),
            shift_definition_id=other_shift.id,
        )
        is general
    )


def test_latest_effective_start_then_highest_id_breaks_policy_ties(db_session, admin_user):
    _policy(
        db_session,
        admin_user,
        effective_from=date(2025, 12, 1),
    )
    first_latest = _policy(
        db_session,
        admin_user,
        effective_from=date(2026, 1, 1),
    )
    second_latest = _policy(
        db_session,
        admin_user,
        effective_from=date(2026, 1, 1),
    )

    resolved = policy_for(
        db_session,
        operational_date=date(2026, 3, 1),
        shift_definition_id=None,
    )

    assert second_latest.id > first_latest.id
    assert resolved is second_latest


def test_effective_to_is_an_exclusive_policy_boundary(db_session, admin_user):
    expired = _policy(
        db_session,
        admin_user,
        effective_from=date(2026, 1, 1),
        effective_to=date(2026, 3, 1),
    )

    assert (
        policy_for(
            db_session,
            operational_date=date(2026, 2, 28),
            shift_definition_id=None,
        )
        is expired
    )
    assert (
        policy_for(
            db_session,
            operational_date=date(2026, 3, 1),
            shift_definition_id=None,
        )
        is None
    )


def test_occurrence_shift_overrides_a_supplied_fallback_for_a_case(
    db_session, admin_user, count_queries
):
    occurrence_shift = _shift(db_session, "occurrence")
    fallback_shift = _shift(db_session, "fallback")
    case = _occurrence_case(db_session, admin_user, shift=occurrence_shift)
    occurrence_policy = _policy(
        db_session,
        admin_user,
        effective_from=date(2026, 1, 1),
        shift_definition_id=occurrence_shift.id,
    )
    fallback_policy = _policy(
        db_session,
        admin_user,
        effective_from=date(2026, 1, 1),
        shift_definition_id=fallback_shift.id,
    )

    with count_queries() as queries:
        resolved = policy_for_case(
            db_session,
            case,
            override_shift_definition_id=fallback_shift.id,
        )

    assert resolved is occurrence_policy
    assert queries.count == 1

    override_case = AttendanceCase(
        operational_date=case.operational_date,
        shift_occurrence_id=None,
    )
    assert (
        policy_for_case(
            db_session,
            override_case,
            override_shift_definition_id=fallback_shift.id,
        )
        is fallback_policy
    )

    missing_occurrence_case = AttendanceCase(
        operational_date=case.operational_date,
        shift_occurrence_id=999_999,
    )
    assert (
        policy_for_case(
            db_session,
            missing_occurrence_case,
            override_shift_definition_id=fallback_shift.id,
        )
        is fallback_policy
    )
