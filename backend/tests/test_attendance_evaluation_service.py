"""RED contracts for append-only workforce attendance evaluation."""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.api.errors import ConflictError
from app.db.models import Employee, Leave, User
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationPunchSource,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendanceSyncState,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.services import attendance_correction_service
from app.services.attendance_evaluation_service import evaluate_case, materialize_scheduled_cases
from app.services.workforce_access_service import organization_scope

UTC_NOW = datetime(2026, 8, 17, 12, tzinfo=UTC)
SHIFT_START = datetime(2026, 8, 17, 4, tzinfo=UTC)
SHIFT_END = SHIFT_START + timedelta(hours=8)


def _seed_case(db_session, *, employee_id: str = "G-ATT-1") -> AttendanceCase:
    employee = Employee(id=employee_id, name_en="Attendance Tester", name_ar="مختبر الحضور")
    actor = User(
        email=f"{employee_id.lower()}@attendance.test",
        password_hash="x",
        role="admin",
        status="active",
    )
    db_session.add_all((employee, actor))
    db_session.flush()
    shift = WorkShiftDefinition(
        code=f"shift-{employee_id.lower()}",
        start_local_time=SHIFT_START.time(),
        duration_minutes=480,
    )
    pattern = WorkRotationPattern(
        code=f"pattern-{employee_id.lower()}",
        name="Attendance test pattern",
        cycle_minutes=7_200,
        timezone="Asia/Dubai",
    )
    crew = WorkCrew(code=f"crew-{employee_id.lower()}", name_en="Alpha")
    db_session.add_all((shift, pattern, crew))
    db_session.flush()
    schedule = WorkCrewSchedule(
        crew_id=crew.id,
        pattern_id=pattern.id,
        anchor_at=SHIFT_START,
        effective_from=SHIFT_START - timedelta(days=1),
        version=1,
        created_by_user_id=actor.id,
    )
    db_session.add(schedule)
    db_session.flush()
    provider_person = AttendanceProviderPerson(
        provider="biotime",
        external_person_id=f"P-{employee_id}",
        employee_id=employee_id,
        mapping_state="verified",
        verified_at=UTC_NOW,
        verified_by_user_id=actor.id,
        active=True,
        first_seen_at=UTC_NOW,
        last_seen_at=UTC_NOW,
    )
    occurrence = WorkShiftOccurrence(
        crew_id=crew.id,
        crew_schedule_id=schedule.id,
        shift_definition_id=shift.id,
        starts_at=SHIFT_START,
        ends_at=SHIFT_END,
        operational_date=date(2026, 8, 17),
        pattern_code_snapshot="five-team-120h",
        crew_schedule_version_snapshot=1,
        source_anchor_at=SHIFT_START,
    )
    policy = WorkAttendancePolicy(
        grace_minutes=10,
        absence_after_minutes=30,
        early_exit_grace_minutes=10,
        match_before_minutes=30,
        match_after_minutes=30,
        require_checkout=True,
        effective_from=date(2026, 1, 1),
        created_by_user_id=actor.id,
        approved_at=UTC_NOW,
        approved_by_user_id=actor.id,
    )
    db_session.add_all(
        (
            provider_person,
            occurrence,
            policy,
            AttendanceSyncState(
                provider="biotime",
                stream="punches",
                fresh_through=UTC_NOW + timedelta(days=1),
            ),
        )
    )
    db_session.flush()
    case = AttendanceCase(
        employee_id=employee.id,
        shift_occurrence_id=occurrence.id,
        employee_status_snapshot="active",
        crew_code_snapshot=crew.code,
        crew_name_snapshot="Alpha",
        shift_code_snapshot=shift.code,
        scheduled_start_at=SHIFT_START,
        scheduled_end_at=SHIFT_END,
        operational_date=date(2026, 8, 17),
        organization_snapshot_state="captured",
    )
    db_session.add(case)
    db_session.flush()
    return case


def _punch(db_session, case: AttendanceCase, *, event_id: str, at: datetime, direction: str) -> AttendancePunch:
    person = db_session.scalar(
        select(AttendanceProviderPerson).where(AttendanceProviderPerson.employee_id == case.employee_id)
    )
    assert person is not None
    punch = AttendancePunch(
        provider="biotime",
        external_event_id=event_id,
        provider_person_id=person.id,
        occurred_at=at,
        direction=direction,
        imported_at=UTC_NOW,
        normalized_payload_hash=f"hash-{event_id}",
    )
    db_session.add(punch)
    db_session.flush()
    return punch


def test_evaluator_keeps_presence_precedence_grace_boundaries_and_exception_facts_orthogonal(db_session):
    case = _seed_case(db_session)
    _punch(db_session, case, event_id="in-at-grace", at=SHIFT_START + timedelta(minutes=10), direction="in")

    active = evaluate_case(db_session, case.id, evaluated_at=SHIFT_START + timedelta(minutes=20))
    assert active.presence_state == "on_duty"
    assert active.reason_code == "PUNCH_IN_ACTIVE"
    assert active.late_minutes == 0
    assert active.early_exit_minutes is None
    assert active.missing_checkout is False

    _punch(db_session, case, event_id="out-early", at=SHIFT_END - timedelta(minutes=11), direction="out")
    completed = evaluate_case(db_session, case.id, evaluated_at=SHIFT_END + timedelta(minutes=31))
    assert completed.presence_state == "completed"
    assert completed.reason_code == "PUNCH_OUT_RECORDED"
    assert completed.late_minutes == 0
    assert completed.early_exit_minutes == 1
    assert completed.missing_checkout is False


def test_late_arrival_and_missing_checkout_coexist_with_completed_presence(db_session):
    case = _seed_case(db_session, employee_id="G-ATT-MISSING")
    _punch(
        db_session,
        case,
        event_id="in-late-no-out",
        at=SHIFT_START + timedelta(minutes=11),
        direction="in",
    )

    evaluated = evaluate_case(db_session, case.id, evaluated_at=SHIFT_END + timedelta(minutes=31))

    assert evaluated.presence_state == "completed"
    assert evaluated.reason_code == "SHIFT_ENDED"
    assert evaluated.late_minutes == 1
    assert evaluated.missing_checkout is True
    assert evaluated.early_exit_minutes is None


def test_evaluation_start_cutoff_leaves_pre_go_live_occurrence_without_case_or_revision(db_session):
    case = _seed_case(db_session)
    case.scheduled_start_at = SHIFT_START - timedelta(days=1)
    case.scheduled_end_at = SHIFT_END - timedelta(days=1)
    case.operational_date = date(2026, 8, 16)
    _punch(db_session, case, event_id="pre-go-live", at=case.scheduled_start_at, direction="in")

    skipped = evaluate_case(
        db_session,
        case.id,
        evaluated_at=UTC_NOW,
        evaluation_start_at=SHIFT_START,
    )
    assert skipped is None
    assert db_session.scalar(select(AttendanceEvaluation).where(AttendanceEvaluation.attendance_case_id == case.id)) is None


def test_started_assignment_materialization_omits_future_occurrences_and_preserves_prior_snapshot(db_session):
    case = _seed_case(db_session)
    source = db_session.get(WorkShiftOccurrence, case.shift_occurrence_id)
    assert source is not None
    future = WorkShiftOccurrence(
        crew_id=source.crew_id,
        crew_schedule_id=source.crew_schedule_id,
        shift_definition_id=source.shift_definition_id,
        starts_at=SHIFT_START + timedelta(days=1),
        ends_at=SHIFT_END + timedelta(days=1),
        operational_date=date(2026, 8, 18),
        pattern_code_snapshot="five-team-120h",
        crew_schedule_version_snapshot=source.crew_schedule_version_snapshot,
        source_anchor_at=SHIFT_START,
    )
    db_session.add(future)
    db_session.flush()

    materialize_scheduled_cases(db_session, employee_id=case.employee_id, horizon=UTC_NOW)
    cases = db_session.scalars(select(AttendanceCase).where(AttendanceCase.employee_id == case.employee_id)).all()
    assert [row.shift_occurrence_id for row in cases] == [case.shift_occurrence_id]

    employee = db_session.get(Employee, case.employee_id)
    assert employee is not None
    original_snapshot = (case.crew_name_snapshot, case.department_snapshot, case.duty_unit_snapshot)
    employee.department = "Changed after shift start"
    employee.duty_unit = "Changed unit"
    db_session.flush()
    materialize_scheduled_cases(db_session, employee_id=case.employee_id, horizon=UTC_NOW)
    preserved = db_session.get(AttendanceCase, case.id)
    assert (preserved.crew_name_snapshot, preserved.department_snapshot, preserved.duty_unit_snapshot) == original_snapshot


def test_unchanged_fingerprint_returns_existing_revision_and_changed_source_appends_never_rewrites(db_session):
    case = _seed_case(db_session)
    first_punch = _punch(db_session, case, event_id="in-1", at=SHIFT_START + timedelta(minutes=11), direction="in")

    first = evaluate_case(db_session, case.id, evaluated_at=SHIFT_START + timedelta(minutes=40))
    same = evaluate_case(db_session, case.id, evaluated_at=SHIFT_START + timedelta(minutes=40))
    assert same.id == first.id
    assert same.revision == 1

    _punch(db_session, case, event_id="out-1", at=SHIFT_END, direction="out")
    changed = evaluate_case(db_session, case.id, evaluated_at=SHIFT_END + timedelta(minutes=31))
    assert changed.revision == 2
    assert db_session.get(AttendanceEvaluation, first.id).presence_state == "on_duty"
    assert db_session.get(AttendancePunch, first_punch.id).direction == "in"
    assert db_session.scalars(
        select(AttendanceEvaluationPunchSource).where(AttendanceEvaluationPunchSource.evaluation_id == first.id)
    ).all()


def test_approved_leave_wins_precedence_and_stores_canonical_source_links(db_session):
    case = _seed_case(db_session)
    punch = _punch(db_session, case, event_id="source-in", at=SHIFT_START + timedelta(minutes=1), direction="in")
    leave = Leave(
        employee_id=case.employee_id,
        leave_type="Annual Leave",
        start_date=date(2026, 8, 17),
        end_date=date(2026, 8, 17),
        days=1,
        status="Approved",
    )
    db_session.add(leave)
    db_session.flush()

    evaluated = evaluate_case(db_session, case.id, evaluated_at=UTC_NOW)
    assert evaluated.presence_state == "excused_leave"
    assert evaluated.reason_code == "LEAVE_ANNUAL"
    assert [(link.punch_id, link.ordinal) for link in evaluated.punch_sources] == [(punch.id, 1)]
    assert [(link.leave_id, link.is_primary) for link in evaluated.leave_sources] == [(leave.id, True)]


def test_adjustments_have_one_effective_leaf_reject_stale_versions_and_preserve_raw_evidence(db_session):
    case = _seed_case(db_session)
    actor = db_session.scalar(select(User))
    assert actor is not None
    raw = _punch(db_session, case, event_id="in-1", at=SHIFT_START, direction="in")
    automatic = evaluate_case(db_session, case.id, evaluated_at=SHIFT_START + timedelta(minutes=31))
    assert automatic is not None
    snapshot = {
        "replacement_presence_state": automatic.presence_state,
        "replacement_first_in_at": automatic.first_in_at,
        "replacement_latest_in_at": automatic.latest_in_at,
        "replacement_final_out_at": automatic.final_out_at,
        "replacement_late_minutes": automatic.late_minutes,
        "replacement_early_exit_minutes": automatic.early_exit_minutes,
        "replacement_missing_checkout": automatic.missing_checkout,
        "reason": "verified paper checkout",
    }
    first_snapshot = {
        **snapshot,
        "replacement_presence_state": "completed",
        "replacement_missing_checkout": False,
    }

    first = attendance_correction_service.correct(
        db_session,
        scope=organization_scope(),
        case_id=case.id,
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        snapshot=first_snapshot,
        actor=actor,
    )
    second = attendance_correction_service.correct(
        db_session,
        scope=organization_scope(),
        case_id=case.id,
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        snapshot={
            **snapshot,
            "replacement_presence_state": "on_duty",
            "reason": "later correction",
        },
        actor=actor,
    )
    assert second.supersedes_adjustment_id == first.id
    assert (
        attendance_correction_service.active_corrections(db_session, [case.id])[case.id].id
        == second.id
    )
    assert db_session.get(AttendancePunch, raw.id).direction == "in"

    with pytest.raises(ConflictError) as stale:
        attendance_correction_service.correct(
            db_session,
            scope=organization_scope(),
            case_id=case.id,
            if_match='"stale"',
            snapshot={
                **snapshot,
                "replacement_presence_state": "absent",
                "reason": "stale reviewer",
            },
            actor=actor,
        )
    assert stale.value.code == "ATTENDANCE_CASE_VERSION_CONFLICT"


def test_revoking_active_adjustment_reveals_latest_active_predecessor(db_session):
    case = _seed_case(db_session)
    actor = db_session.scalar(select(User))
    assert actor is not None
    _punch(db_session, case, event_id="in-revoke", at=SHIFT_START, direction="in")
    automatic = evaluate_case(db_session, case.id, evaluated_at=SHIFT_START + timedelta(minutes=31))
    assert automatic is not None
    snapshot = {
        "replacement_presence_state": automatic.presence_state,
        "replacement_first_in_at": automatic.first_in_at,
        "replacement_latest_in_at": automatic.latest_in_at,
        "replacement_final_out_at": automatic.final_out_at,
        "replacement_late_minutes": automatic.late_minutes,
        "replacement_early_exit_minutes": automatic.early_exit_minutes,
        "replacement_missing_checkout": automatic.missing_checkout,
        "reason": "initial correction",
    }

    predecessor = attendance_correction_service.correct(
        db_session,
        scope=organization_scope(),
        case_id=case.id,
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        snapshot={**snapshot, "replacement_presence_state": "completed"},
        actor=actor,
    )
    current = attendance_correction_service.correct(
        db_session,
        scope=organization_scope(),
        case_id=case.id,
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        snapshot={
            **snapshot,
            "replacement_presence_state": "on_duty",
            "reason": "replacement correction",
        },
        actor=actor,
    )

    attendance_correction_service.revoke(
        db_session,
        scope=organization_scope(),
        case_id=case.id,
        adjustment_id=current.id,
        reason="Replacement correction was wrong",
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=actor,
    )
    assert (
        attendance_correction_service.active_corrections(db_session, [case.id])[case.id].id
        == predecessor.id
    )
