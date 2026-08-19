from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select

from app.db.models import Employee, User
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendancePunchAssignment,
    WorkAttendancePolicy,
    WorkShiftDefinition,
    WorkShiftOverride,
)
from app.services.attendance_evaluation_service import resolve_assignment

NOW = datetime(2026, 8, 17, 12, tzinfo=UTC)


def _employee(db_session, employee_id: str) -> Employee:
    row = Employee(id=employee_id, name_en=employee_id, name_ar=employee_id)
    db_session.add(row)
    db_session.flush()
    return row


def _provider_person(
    db_session,
    *,
    employee_id: str | None,
    mapping_state: str,
    suffix: str,
    admin_user=None,
) -> AttendanceProviderPerson:
    verified_at = NOW if mapping_state == "verified" else None
    row = AttendanceProviderPerson(
        provider="biotime",
        external_person_id=f"person-{suffix}",
        external_employee_code=employee_id,
        display_name_snapshot=f"Person {suffix}",
        employee_id=employee_id,
        mapping_state=mapping_state,
        verified_by_user_id=admin_user.id if mapping_state == "verified" else None,
        verified_at=verified_at,
        active=True,
        first_seen_at=NOW,
        last_seen_at=NOW,
    )
    db_session.add(row)
    db_session.flush()
    return row


def _punch(
    db_session,
    *,
    person: AttendanceProviderPerson,
    occurred_at: datetime,
    direction: str,
    suffix: str,
) -> AttendancePunch:
    row = AttendancePunch(
        provider="biotime",
        external_event_id=f"event-{suffix}",
        provider_person_id=person.id,
        occurred_at=occurred_at,
        direction=direction,
        device_id="gate-a",
        device_name="Test gate",
        source_updated_at=occurred_at,
        imported_at=NOW,
        normalized_payload_hash=f"hash-{suffix}",
    )
    db_session.add(row)
    db_session.flush()
    return row


def _case(
    db_session,
    *,
    employee: Employee,
    starts_at: datetime,
    ends_at: datetime,
    suffix: str,
) -> AttendanceCase:
    actor_id = db_session.scalar(select(User.id))
    assert actor_id is not None
    shift = WorkShiftDefinition(
        code=f"fixture-{suffix}",
        start_local_time=starts_at.time().replace(tzinfo=None),
        duration_minutes=int((ends_at - starts_at).total_seconds() // 60),
    )
    db_session.add(shift)
    db_session.flush()
    override = WorkShiftOverride(
        employee_id=employee.id,
        assignment_kind="work",
        reason_kind="other",
        starts_at=starts_at,
        ends_at=ends_at,
        shift_definition_id=shift.id,
        reason="Punch allocation test fixture",
        created_by_user_id=actor_id,
    )
    db_session.add(override)
    db_session.flush()
    row = AttendanceCase(
        employee_id=employee.id,
        shift_override_id=override.id,
        scheduled_start_at=starts_at,
        scheduled_end_at=ends_at,
        operational_date=starts_at.date(),
        employee_status_snapshot="Active",
        organization_snapshot_state="captured",
        crew_code_snapshot=f"crew-{suffix}",
        crew_name_snapshot=f"Crew {suffix}",
        shift_code_snapshot="day",
    )
    db_session.add(row)
    db_session.flush()
    return row


def _approved_policy(db_session, admin_user) -> None:
    db_session.add(
        WorkAttendancePolicy(
            shift_definition_id=None,
            grace_minutes=15,
            absence_after_minutes=60,
            early_exit_grace_minutes=15,
            match_before_minutes=180,
            match_after_minutes=180,
            require_checkout=True,
            effective_from=date(2026, 8, 1),
            effective_to=None,
            created_by_user_id=admin_user.id,
            approved_by_user_id=admin_user.id,
            approved_at=NOW,
        )
    )
    db_session.flush()


def _assignment(db_session, punch: AttendancePunch) -> AttendancePunchAssignment | None:
    return db_session.get(AttendancePunchAssignment, punch.id)


def _revision_count(db_session, case: AttendanceCase) -> int:
    return db_session.scalar(
        select(func.count())
        .select_from(AttendanceEvaluation)
        .where(AttendanceEvaluation.attendance_case_id == case.id)
    )


def test_unmapped_provider_person_punch_is_excluded_from_allocation(db_session, admin_user):
    employee = _employee(db_session, "G400")
    _approved_policy(db_session, admin_user)
    _case(
        db_session,
        employee=employee,
        starts_at=NOW,
        ends_at=NOW + timedelta(hours=8),
        suffix="unmapped",
    )
    person = _provider_person(
        db_session, employee_id=None, mapping_state="unmapped", suffix="unmapped"
    )
    punch = _punch(
        db_session,
        person=person,
        occurred_at=NOW + timedelta(minutes=5),
        direction="in",
        suffix="unmapped",
    )
    db_session.commit()

    result = resolve_assignment(db_session, punch_id=punch.id, now=NOW)

    assert result is None
    assert _assignment(db_session, punch) is None


def test_unknown_provider_direction_is_never_assigned_as_an_in_or_out_punch(
    db_session, admin_user
):
    employee = _employee(db_session, "G401")
    _approved_policy(db_session, admin_user)
    _case(
        db_session,
        employee=employee,
        starts_at=NOW,
        ends_at=NOW + timedelta(hours=8),
        suffix="unknown-direction",
    )
    person = _provider_person(
        db_session,
        employee_id=employee.id,
        mapping_state="verified",
        suffix="unknown-direction",
        admin_user=admin_user,
    )
    punch = _punch(
        db_session,
        person=person,
        occurred_at=NOW + timedelta(minutes=5),
        direction="unknown",
        suffix="unknown-direction",
    )
    db_session.commit()

    result = resolve_assignment(db_session, punch_id=punch.id, now=NOW)

    assert result is None
    assert _assignment(db_session, punch) is None


def test_in_punch_tie_uses_earlier_scheduled_start_and_persists_one_choice(
    db_session, admin_user
):
    employee = _employee(db_session, "G402")
    _approved_policy(db_session, admin_user)
    earlier = _case(
        db_session,
        employee=employee,
        starts_at=NOW - timedelta(hours=4),
        ends_at=NOW + timedelta(hours=4),
        suffix="earlier",
    )
    _case(
        db_session,
        employee=employee,
        starts_at=NOW - timedelta(hours=2),
        ends_at=NOW + timedelta(hours=6),
        suffix="later",
    )
    person = _provider_person(
        db_session,
        employee_id=employee.id,
        mapping_state="verified",
        suffix="in-tie",
        admin_user=admin_user,
    )
    punch = _punch(
        db_session,
        person=person,
        occurred_at=NOW - timedelta(hours=3),
        direction="in",
        suffix="in-tie",
    )
    db_session.commit()

    assignment = resolve_assignment(db_session, punch_id=punch.id, now=NOW)

    assert assignment.attendance_case_id == earlier.id
    persisted = _assignment(db_session, punch)
    assert persisted is not None
    assert persisted.attendance_case_id == earlier.id
    assert persisted.algorithm_version


def test_out_punch_prefers_the_nearest_scheduled_end(db_session, admin_user):
    employee = _employee(db_session, "G403")
    _approved_policy(db_session, admin_user)
    _case(
        db_session,
        employee=employee,
        starts_at=NOW - timedelta(hours=8),
        ends_at=NOW,
        suffix="early-end",
    )
    nearest_end = _case(
        db_session,
        employee=employee,
        starts_at=NOW - timedelta(hours=6),
        ends_at=NOW + timedelta(hours=2),
        suffix="nearest-end",
    )
    person = _provider_person(
        db_session,
        employee_id=employee.id,
        mapping_state="verified",
        suffix="out-nearest",
        admin_user=admin_user,
    )
    punch = _punch(
        db_session,
        person=person,
        occurred_at=NOW + timedelta(hours=1, minutes=45),
        direction="out",
        suffix="out-nearest",
    )
    db_session.commit()

    assignment = resolve_assignment(db_session, punch_id=punch.id, now=NOW)

    assert assignment.attendance_case_id == nearest_end.id


def test_replaying_the_same_punch_cannot_create_a_second_current_assignment(
    db_session, admin_user
):
    employee = _employee(db_session, "G404")
    _approved_policy(db_session, admin_user)
    case = _case(
        db_session,
        employee=employee,
        starts_at=NOW,
        ends_at=NOW + timedelta(hours=8),
        suffix="replay",
    )
    person = _provider_person(
        db_session,
        employee_id=employee.id,
        mapping_state="verified",
        suffix="replay",
        admin_user=admin_user,
    )
    punch = _punch(
        db_session,
        person=person,
        occurred_at=NOW + timedelta(minutes=1),
        direction="in",
        suffix="replay",
    )
    db_session.commit()

    first = resolve_assignment(db_session, punch_id=punch.id, now=NOW)
    replay = resolve_assignment(db_session, punch_id=punch.id, now=NOW)

    assert first.attendance_case_id == case.id
    assert replay.attendance_case_id == case.id
    assert (
        db_session.scalar(select(func.count()).select_from(AttendancePunchAssignment)) == 1
    )


def test_reassignment_moves_the_current_choice_and_reevaluates_both_cases(
    db_session, admin_user
):
    employee = _employee(db_session, "G405")
    _approved_policy(db_session, admin_user)
    old_case = _case(
        db_session,
        employee=employee,
        starts_at=NOW - timedelta(hours=4),
        ends_at=NOW + timedelta(hours=4),
        suffix="old",
    )
    person = _provider_person(
        db_session,
        employee_id=employee.id,
        mapping_state="verified",
        suffix="reassignment",
        admin_user=admin_user,
    )
    punch = _punch(
        db_session,
        person=person,
        occurred_at=NOW - timedelta(hours=2, minutes=15),
        direction="in",
        suffix="reassignment",
    )
    db_session.commit()

    first = resolve_assignment(db_session, punch_id=punch.id, now=NOW)
    assert first.attendance_case_id == old_case.id
    old_revisions_before = _revision_count(db_session, old_case)
    new_case = _case(
        db_session,
        employee=employee,
        starts_at=NOW - timedelta(hours=2),
        ends_at=NOW + timedelta(hours=6),
        suffix="new",
    )
    db_session.commit()
    new_revisions_before = _revision_count(db_session, new_case)

    reassigned = resolve_assignment(db_session, punch_id=punch.id, now=NOW)

    assert reassigned.attendance_case_id == new_case.id
    assert _assignment(db_session, punch).attendance_case_id == new_case.id
    assert _revision_count(db_session, old_case) == old_revisions_before + 1
    assert _revision_count(db_session, new_case) == new_revisions_before + 1
