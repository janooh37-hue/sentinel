"""Deterministic allocation of immutable attendance punches to current cases."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.workforce_models import (
    AttendanceCase,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendancePunchAssignment,
    WorkShiftOverride,
)
from app.services.attendance_policy import policy_for_case

ALLOCATION_ALGORITHM_VERSION = "attendance-punch-allocation-v1"


def _aware_utc(value: datetime) -> datetime:
    """Interpret repository-persisted naive datetimes as UTC at the service boundary."""

    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _naive_utc(value: datetime) -> datetime:
    return _aware_utc(value).replace(tzinfo=None)


def _eligible_case_candidates(
    db: Session, *, punch: AttendancePunch, employee_id: str
) -> list[AttendanceCase]:
    """Find cases whose effective policy match window contains the directional punch."""

    occurred_at = _aware_utc(punch.occurred_at)
    case_sources = db.execute(
        select(
            AttendanceCase,
            WorkShiftOverride.shift_definition_id,
        )
        .outerjoin(
            WorkShiftOverride,
            AttendanceCase.shift_override_id == WorkShiftOverride.id,
        )
        .where(AttendanceCase.employee_id == employee_id)
    ).all()
    candidates: list[AttendanceCase] = []
    for case, override_shift_definition_id in case_sources:
        policy = policy_for_case(
            db,
            case,
            override_shift_definition_id=override_shift_definition_id,
        )
        if policy is None:
            continue
        starts_at = _aware_utc(case.scheduled_start_at)
        ends_at = _aware_utc(case.scheduled_end_at)
        if (
            starts_at - timedelta(minutes=policy.match_before_minutes)
            <= occurred_at
            <= (ends_at + timedelta(minutes=policy.match_after_minutes))
        ):
            candidates.append(case)
    return candidates


def select_punch_case(db: Session, *, punch: AttendancePunch) -> AttendanceCase | None:
    """Select one case by the published deterministic directional tie-break rules."""

    person = db.get(AttendanceProviderPerson, punch.provider_person_id)
    if (
        person is None
        or not person.active
        or person.mapping_state != "verified"
        or person.employee_id is None
        or punch.direction not in {"in", "out"}
    ):
        return None

    candidates = _eligible_case_candidates(db, punch=punch, employee_id=person.employee_id)
    if not candidates:
        return None

    occurred_at = _aware_utc(punch.occurred_at)
    if punch.direction == "in":
        return min(
            candidates,
            key=lambda case: (
                abs(occurred_at - _aware_utc(case.scheduled_start_at)),
                _aware_utc(case.scheduled_start_at),
                case.id,
            ),
        )
    return min(
        candidates,
        key=lambda case: (
            abs(occurred_at - _aware_utc(case.scheduled_end_at)),
            _aware_utc(case.scheduled_start_at),
            case.id,
        ),
    )


def resolve_punch_assignment(
    db: Session, *, punch_id: int, now: datetime
) -> AttendancePunchAssignment | None:
    """Atomically create or move the one current assignment for a directional punch.

    The caller remains responsible for reevaluating a moved assignment's old and new cases in the
    same transaction.  This function never commits.
    """

    punch = db.get(AttendancePunch, punch_id)
    if punch is None:
        return None
    assignment = db.scalar(
        select(AttendancePunchAssignment)
        .where(AttendancePunchAssignment.punch_id == punch.id)
        .with_for_update()
    )
    selected_case = select_punch_case(db, punch=punch)
    if selected_case is None:
        if assignment is not None:
            db.delete(assignment)
            db.flush()
        return None

    persisted_now = _naive_utc(now)
    if assignment is None:
        assignment = AttendancePunchAssignment(
            punch_id=punch.id,
            attendance_case_id=selected_case.id,
            algorithm_version=ALLOCATION_ALGORITHM_VERSION,
            assigned_at=persisted_now,
            updated_at=persisted_now,
        )
        db.add(assignment)
    elif assignment.attendance_case_id != selected_case.id:
        assignment.attendance_case_id = selected_case.id
        assignment.algorithm_version = ALLOCATION_ALGORITHM_VERSION
        assignment.updated_at = persisted_now
    db.flush()
    return assignment


def resolve_assignment(
    db: Session, *, punch_id: int, now: datetime
) -> AttendancePunchAssignment | None:
    """Allocate a punch then reevaluate every case whose current ownership changed.

    ``AttendancePunchAssignment`` is the one-current-choice record.  Evaluation evidence is
    append-only, so a reassignment must reevaluate both its prior and selected cases before the
    caller can commit.  The import is deliberately lazy to keep allocation independent of the
    evaluator's implementation module.
    """

    previous = db.scalar(
        select(AttendancePunchAssignment)
        .where(AttendancePunchAssignment.punch_id == punch_id)
        .with_for_update()
    )
    previous_case_id = previous.attendance_case_id if previous is not None else None
    assignment = resolve_punch_assignment(db, punch_id=punch_id, now=now)

    from app.services.attendance_evaluation_service import evaluate_case

    if assignment is None:
        if previous_case_id is not None:
            evaluate_case(db, previous_case_id, evaluated_at=now)
        return None

    case_ids = {assignment.attendance_case_id}
    if previous_case_id is not None and previous_case_id != assignment.attendance_case_id:
        case_ids.add(previous_case_id)
    for case_id in sorted(case_ids):
        evaluate_case(db, case_id, evaluated_at=now)
    return assignment
