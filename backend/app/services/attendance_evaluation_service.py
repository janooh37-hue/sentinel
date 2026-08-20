"""Append-only attendance evaluation and reviewed-correction services.

The attendance tables store immutable source facts.  This module derives an
automatic revision from those facts and never mutates an earlier decision.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.core import leave_lifecycle
from app.db.models import AuditLog, Employee, Leave
from app.db.workforce_models import (
    AttendanceAdjustment,
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationLeaveSource,
    AttendanceEvaluationPunchSource,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendancePunchAssignment,
    AttendancePunchProfile,
    AttendanceSyncState,
    DutyAssignmentEvent,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.services import attendance_profile_service
from app.services.workforce_leave import resolve_excusing_leave

# v4 asserts absence at the absence boundary - twice the grace - rather than
# holding every no-show open until the shift's match window closes, and leans on
# re-evaluation to replace that verdict with a late arrival when a punch lands
# afterwards. v3 widened the evidence window by each person's learned punch
# habit, and reads a lone punch in a closed window as an arrival or a departure
# from that habit rather than assuming an arrival and timing lateness against it.
ALGORITHM_VERSION = "workforce-attendance-v4"
_ACTIVE_EMPLOYEE_STATUS = "active"
_VALID_PRESENCE_STATES = frozenset(
    {"scheduled", "on_duty", "completed", "absent", "excused_leave", "off", "unknown"}
)
_ADJUSTMENT_KEYS = frozenset(
    {
        "presence_state",
        "first_in_at",
        "latest_in_at",
        "final_out_at",
        "late_minutes",
        "early_exit_minutes",
        "missing_checkout",
    }
)


def _as_utc(value: datetime) -> datetime:
    """Return an aware UTC instant, accepting DB-native naive UTC values."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _as_db_utc(value: datetime) -> datetime:
    """Normalize an instant at the persistence boundary to naive UTC."""
    return _as_utc(value).replace(tzinfo=None)


def _datetime_token(value: datetime | None) -> str | None:
    return _as_utc(value).isoformat().replace("+00:00", "Z") if value is not None else None


def _ceil_positive_minutes(delta: timedelta) -> int:
    return max(0, math.ceil(max(0.0, delta.total_seconds()) / 60.0))


def effective_policy(db: Session, case: AttendanceCase) -> WorkAttendancePolicy | None:
    """Resolve the approved, most-specific policy effective for a fixed case."""
    occurrence_shift_id: int | None = None
    if case.shift_occurrence_id is not None:
        occurrence_shift_id = db.scalar(
            select(WorkShiftOccurrence.shift_definition_id).where(
                WorkShiftOccurrence.id == case.shift_occurrence_id
            )
        )
    policy = db.scalars(
        select(WorkAttendancePolicy)
        .where(
            WorkAttendancePolicy.approved_at.is_not(None),
            WorkAttendancePolicy.effective_from <= case.operational_date,
            or_(
                WorkAttendancePolicy.effective_to.is_(None),
                WorkAttendancePolicy.effective_to > case.operational_date,
            ),
            or_(
                WorkAttendancePolicy.shift_definition_id.is_(None),
                WorkAttendancePolicy.shift_definition_id == occurrence_shift_id,
            ),
        )
        .order_by(
            WorkAttendancePolicy.shift_definition_id.is_not(None).desc(),
            WorkAttendancePolicy.effective_from.desc(),
            WorkAttendancePolicy.id.desc(),
        )
    ).first()
    return policy


def _mapping_state(
    db: Session, employee_id: str
) -> tuple[AttendanceProviderPerson | None, str, tuple[tuple[int, str], ...]]:
    """Return the only usable provider mapping and a stable uncertainty reason."""
    rows = db.scalars(
        select(AttendanceProviderPerson)
        .where(
            AttendanceProviderPerson.employee_id == employee_id,
            AttendanceProviderPerson.active.is_(True),
        )
        .order_by(AttendanceProviderPerson.id)
    ).all()
    identity = tuple((row.id, row.mapping_state) for row in rows)
    verified = [row for row in rows if row.mapping_state == "verified"]
    if len(verified) == 1:
        return verified[0], "", identity
    if len(verified) > 1 or any(row.mapping_state == "conflict" for row in rows):
        return None, "IDENTITY_CONFLICT", identity
    return None, "IDENTITY_UNVERIFIED", identity


def _fresh_through(db: Session, provider: str | None) -> datetime | None:
    if provider is None:
        return None
    state = db.get(AttendanceSyncState, (provider, "punches"))
    return state.fresh_through if state is not None else None


def _matching_punches(
    db: Session,
    *,
    case: AttendanceCase,
    provider_person_id: int | None,
    policy: WorkAttendancePolicy | None,
    profile: AttendancePunchProfile | None,
) -> list[AttendancePunch]:
    """Get canonical evidence in the evidence window without stealing assigned punches."""
    if provider_person_id is None or policy is None:
        return []
    start, end = attendance_profile_service.evidence_window(
        db, case=case, policy=policy, profile=profile
    )
    window_start = _as_db_utc(_as_utc(start))
    window_end = _as_db_utc(_as_utc(end))
    punches = db.scalars(
        select(AttendancePunch)
        .outerjoin(AttendancePunchAssignment, AttendancePunchAssignment.punch_id == AttendancePunch.id)
        .where(
            AttendancePunch.provider_person_id == provider_person_id,
            AttendancePunch.occurred_at >= window_start,
            AttendancePunch.occurred_at <= window_end,
            or_(
                AttendancePunchAssignment.punch_id.is_(None),
                AttendancePunchAssignment.attendance_case_id == case.id,
            ),
        )
        .order_by(AttendancePunch.occurred_at, AttendancePunch.external_event_id, AttendancePunch.id)
    ).all()
    return list(punches)


def _decision_fingerprint(
    *,
    case: AttendanceCase,
    policy: WorkAttendancePolicy | None,
    mapping_identity: tuple[tuple[int, str], ...],
    mapping: AttendanceProviderPerson | None,
    leave_reason: str | None,
    leave_ids: tuple[int, ...],
    punches: list[AttendancePunch],
    result: Mapping[str, Any],
    algorithm_version: str,
) -> str:
    """Hash only inputs that can alter the effective decision or its evidence."""
    # Fresh-through itself is descriptive metadata.  Its relevant boundary
    # crossings are already reflected in the derived decision fields below;
    # hashing the raw high-water mark would create weightless revisions.
    fingerprint_result = {
        key: value for key, value in result.items() if key != "sync_fresh_through"
    }
    payload = {
        "algorithm_version": algorithm_version,
        "case": {
            "id": case.id,
            "employee_id": case.employee_id,
            "status": case.employee_status_snapshot.lower(),
            "scheduled_start_at": _datetime_token(case.scheduled_start_at),
            "scheduled_end_at": _datetime_token(case.scheduled_end_at),
            "operational_date": case.operational_date.isoformat(),
            "shift_occurrence_id": case.shift_occurrence_id,
            "shift_override_id": case.shift_override_id,
        },
        "policy": (
            None
            if policy is None
            else {
                "id": policy.id,
                "grace_minutes": policy.grace_minutes,
                "absence_after_minutes": policy.absence_after_minutes,
                "early_exit_grace_minutes": policy.early_exit_grace_minutes,
                "match_before_minutes": policy.match_before_minutes,
                "match_after_minutes": policy.match_after_minutes,
                "require_checkout": policy.require_checkout,
            }
        ),
        "mapping_identity": mapping_identity,
        "provider_person_id": mapping.id if mapping is not None else None,
        "leave": {"reason": leave_reason, "ids": leave_ids},
        "punches": [
            {
                "id": punch.id,
                "occurred_at": _datetime_token(punch.occurred_at),
                "direction": punch.direction,
                "hash": punch.normalized_payload_hash,
            }
            for punch in punches
        ],
        "result": fingerprint_result,
    }
    canonical = json.dumps(payload, separators=(",", ":"), sort_keys=True, default=str)
    return sha256(canonical.encode("utf-8")).hexdigest()


def _derive_result(
    *,
    case: AttendanceCase,
    policy: WorkAttendancePolicy | None,
    mapping: AttendanceProviderPerson | None,
    mapping_reason: str,
    fresh_through: datetime | None,
    evaluated_at: datetime,
    leave_reason: str | None,
    punches: list[AttendancePunch],
    profile: AttendancePunchProfile | None = None,
) -> dict[str, Any]:
    """Apply precedence first, then use timing only when source completeness permits it."""
    scheduled_start = _as_utc(case.scheduled_start_at)
    scheduled_end = _as_utc(case.scheduled_end_at)
    fresh = _as_utc(fresh_through) if fresh_through is not None else None
    sync_value = _as_db_utc(fresh) if fresh is not None else None

    directional = [punch for punch in punches if punch.direction in {"in", "out"}]
    in_punches = [punch for punch in directional if punch.direction == "in"]
    first_in = in_punches[0] if in_punches else None
    latest_in = in_punches[-1] if in_punches else None
    final_out = (
        next(
            (
                punch
                for punch in reversed(directional)
                if punch.direction == "out"
                and latest_in is not None
                and _as_utc(punch.occurred_at) >= _as_utc(latest_in.occurred_at)
            ),
            None,
        )
        if latest_in is not None
        else None
    )
    last_directional = directional[-1] if directional else None

    result: dict[str, Any] = {
        "provider_person_id": mapping.id if mapping is not None else None,
        "first_in_at": _as_db_utc(first_in.occurred_at) if first_in is not None else None,
        "latest_in_at": _as_db_utc(latest_in.occurred_at) if latest_in is not None else None,
        "final_out_at": _as_db_utc(final_out.occurred_at) if final_out is not None else None,
        "last_directional_punch_at": (
            _as_db_utc(last_directional.occurred_at) if last_directional is not None else None
        ),
        "last_direction": last_directional.direction if last_directional is not None else None,
        "late_minutes": None,
        "early_exit_minutes": None,
        "missing_checkout": False,
        "sync_fresh_through": sync_value,
        "policy_id": policy.id if policy is not None else None,
    }

    # A live excuse wins before identity, policy, timing, and punch-sequence
    # evaluation.  Punches remain linked as immutable context for the revision.
    if leave_reason is not None:
        result.update(presence_state="excused_leave", reason_code=leave_reason)
        return result
    if case.employee_status_snapshot.lower() != _ACTIVE_EMPLOYEE_STATUS:
        result.update(presence_state="unknown", reason_code="EMPLOYMENT_STATUS_UNKNOWN")
        return result
    if policy is None:
        result.update(presence_state="unknown", reason_code="POLICY_MISSING")
        return result
    if mapping is None:
        result.update(presence_state="unknown", reason_code=mapping_reason)
        return result
    if latest_in is None and any(punch.direction == "out" for punch in directional):
        result.update(presence_state="unknown", reason_code="PUNCH_SEQUENCE_INVALID")
        return result

    absence_boundary = scheduled_start + timedelta(minutes=policy.absence_after_minutes)
    checkout_boundary = scheduled_end + timedelta(minutes=policy.match_after_minutes)
    fresh_for_absence = fresh is not None and fresh >= absence_boundary
    fresh_for_checkout = fresh is not None and fresh >= checkout_boundary
    # Pairing waits for the case's own match window to close: an arrival with no
    # departure yet is not a missing checkout. Arrival does not wait, because the
    # absence boundary is the site's own rule for when a no-show is a no-show.
    settled = evaluated_at >= checkout_boundary

    if not punches:
        # Absence is asserted at the absence boundary - twice the grace - and it
        # is provisional by construction: the queue re-evaluates this case every
        # time the mirror advances, so a punch landing afterwards replaces this
        # revision with a late arrival. Freshness is measured to the same
        # boundary, so a stalled mirror reads unknown instead of manufacturing an
        # absence out of missing data.
        if evaluated_at < absence_boundary:
            result.update(
                presence_state="scheduled", reason_code="SCHEDULED_BEFORE_ABSENCE_BOUNDARY"
            )
        elif not fresh_for_absence:
            result.update(presence_state="unknown", reason_code="SYNC_STALE")
        else:
            result.update(presence_state="absent", reason_code="NO_IN_AFTER_THRESHOLD")
        return result

    grace_boundary = scheduled_start + timedelta(minutes=policy.grace_minutes)
    early_boundary = scheduled_end - timedelta(minutes=policy.early_exit_grace_minutes)

    if not directional:
        # This site's terminals report punch_state 255 for every event, so order
        # is the only evidence of direction: inside a closed window the earliest
        # punch is the arrival and the latest is the departure. The inference is
        # deliberately withheld until the window closes - mid-duty it would turn
        # an ordinary arrival into a departure the moment nobody punched again.
        first, last = punches[0], punches[-1]
        result["first_in_at"] = _as_db_utc(first.occurred_at)
        result["latest_in_at"] = _as_db_utc(first.occurred_at)
        if not settled:
            result.update(presence_state="on_duty", reason_code="PUNCH_RECORDED_DIRECTIONLESS")
            return result
        if not fresh_for_checkout:
            result.update(presence_state="unknown", reason_code="SYNC_STALE")
            return result
        if last is first and (
            attendance_profile_service.infer_direction(
                case=case, punch_at=_as_utc(first.occurred_at), profile=profile
            )
            == "out"
        ):
            # The lone punch sits where this person habitually leaves, so what
            # went unrecorded is the arrival. Timing it as one would invent hours
            # of lateness out of a missing punch.
            result["first_in_at"] = None
            result["latest_in_at"] = None
            result["final_out_at"] = _as_db_utc(first.occurred_at)
            result["early_exit_minutes"] = _ceil_positive_minutes(
                early_boundary - _as_utc(first.occurred_at)
            )
            result.update(presence_state="completed", reason_code="PUNCH_OUT_ONLY_INFERRED")
            return result
        result["late_minutes"] = _ceil_positive_minutes(_as_utc(first.occurred_at) - grace_boundary)
        if last is not first:
            result["final_out_at"] = _as_db_utc(last.occurred_at)
            result["early_exit_minutes"] = _ceil_positive_minutes(
                early_boundary - _as_utc(last.occurred_at)
            )
        elif policy.require_checkout:
            result["missing_checkout"] = True
        result.update(presence_state="completed", reason_code="PUNCH_ORDER_INFERRED")
        return result

    assert first_in is not None
    result["late_minutes"] = _ceil_positive_minutes(_as_utc(first_in.occurred_at) - grace_boundary)

    if final_out is not None:
        if settled and not fresh_for_checkout:
            result.update(presence_state="unknown", reason_code="SYNC_STALE")
            return result
        if settled:
            result["early_exit_minutes"] = _ceil_positive_minutes(
                early_boundary - _as_utc(final_out.occurred_at)
            )
        result.update(presence_state="completed", reason_code="PUNCH_OUT_RECORDED")
        return result

    if not settled:
        result.update(presence_state="on_duty", reason_code="PUNCH_IN_ACTIVE")
        return result
    if not fresh_for_checkout:
        result.update(presence_state="unknown", reason_code="SYNC_STALE")
        return result

    if policy.require_checkout:
        result["missing_checkout"] = True
    result.update(presence_state="completed", reason_code="SHIFT_ENDED")
    return result


def _primary_leave_id(
    db: Session, *, source_leave_ids: tuple[int, ...], reason_code: str | None
) -> int | None:
    """Pick the source whose lifecycle class supplied the winning leave reason."""
    if not source_leave_ids or reason_code is None:
        return None
    leaves = db.scalars(select(Leave).where(Leave.id.in_(source_leave_ids)).order_by(Leave.id)).all()
    for leave in leaves:
        group = leave_lifecycle.classify_group(leave.leave_type)
        if (
            (reason_code == "LEAVE_NATIONAL_SERVICE" and group == "national_service")
            or (reason_code == "LEAVE_SICK" and group == "sick")
            or (reason_code == "LEAVE_ANNUAL" and leave_lifecycle.is_annual(leave.leave_type))
        ):
            return leave.id
    return source_leave_ids[0]


def evaluate_case(
    db: Session,
    case_id: int,
    *,
    evaluated_at: datetime,
    evaluation_start_at: datetime | None = None,
    algorithm_version: str = ALGORITHM_VERSION,
) -> AttendanceEvaluation | None:
    """Append a revision only when the canonical decision fingerprint changes.

    The function intentionally does not commit.  Callers can therefore persist
    their source mutation, queue row, decision, and evidence in one transaction.
    """
    case = db.scalar(select(AttendanceCase).where(AttendanceCase.id == case_id).with_for_update())
    if case is None:
        raise NotFoundError("ATTENDANCE_CASE_NOT_FOUND", "Attendance case was not found.", case_id=case_id)
    if evaluation_start_at is not None and _as_utc(case.scheduled_start_at) < _as_utc(evaluation_start_at):
        return None

    policy = effective_policy(db, case)
    mapping, mapping_reason, mapping_identity = _mapping_state(db, case.employee_id)
    fresh = _fresh_through(db, mapping.provider if mapping is not None else None)
    leave = resolve_excusing_leave(
        db,
        employee_id=case.employee_id,
        starts_at=_as_utc(case.scheduled_start_at),
        ends_at=_as_utc(case.scheduled_end_at),
    )
    leave_reason = leave.reason_code if leave is not None else None
    leave_ids = leave.source_leave_ids if leave is not None else ()
    primary_leave_id = _primary_leave_id(
        db, source_leave_ids=leave_ids, reason_code=leave_reason
    )
    profile = attendance_profile_service.profile_for(
        db, employee_id=case.employee_id, shift_code=case.shift_code_snapshot
    )
    punches = _matching_punches(
        db,
        case=case,
        provider_person_id=mapping.id if mapping is not None else None,
        policy=policy,
        profile=profile,
    )
    result = _derive_result(
        case=case,
        policy=policy,
        mapping=mapping,
        mapping_reason=mapping_reason,
        fresh_through=fresh,
        evaluated_at=_as_utc(evaluated_at),
        leave_reason=leave_reason,
        punches=punches,
        profile=profile,
    )
    fingerprint = _decision_fingerprint(
        case=case,
        policy=policy,
        mapping_identity=mapping_identity,
        mapping=mapping,
        leave_reason=leave_reason,
        leave_ids=leave_ids,
        punches=punches,
        result=result,
        algorithm_version=algorithm_version,
    )
    existing = db.scalar(
        select(AttendanceEvaluation).where(
            AttendanceEvaluation.attendance_case_id == case.id,
            AttendanceEvaluation.input_fingerprint == fingerprint,
        )
    )
    if existing is not None:
        return existing

    def append_revision(revision: int) -> AttendanceEvaluation:
        evaluation = AttendanceEvaluation(
            attendance_case_id=case.id,
            revision=revision,
            algorithm_version=algorithm_version,
            input_fingerprint=fingerprint,
            evaluated_at=_as_db_utc(evaluated_at),
            **result,
        )
        with db.begin_nested():
            db.add(evaluation)
            db.flush()
            db.add_all(
                AttendanceEvaluationPunchSource(
                    evaluation_id=evaluation.id,
                    punch_id=punch.id,
                    ordinal=ordinal,
                )
                for ordinal, punch in enumerate(punches, start=1)
            )
            db.add_all(
                AttendanceEvaluationLeaveSource(
                    evaluation_id=evaluation.id,
                    leave_id=leave_id,
                    is_primary=leave_id == primary_leave_id,
                )
                for leave_id in leave_ids
            )
            db.flush()
        return evaluation

    for attempt in range(2):
        current_revision = db.scalar(
            select(func.max(AttendanceEvaluation.revision)).where(
                AttendanceEvaluation.attendance_case_id == case.id
            )
        )
        try:
            return append_revision((current_revision or 0) + 1)
        except IntegrityError:
            existing = db.scalar(
                select(AttendanceEvaluation).where(
                    AttendanceEvaluation.attendance_case_id == case.id,
                    AttendanceEvaluation.input_fingerprint == fingerprint,
                )
            )
            if existing is not None:
                return existing
            if attempt:
                raise
    raise AssertionError("unreachable")


def materialize_scheduled_cases(
    db: Session,
    *,
    employee_id: str,
    horizon: datetime,
    evaluation_start_at: datetime | None = None,
) -> list[AttendanceCase]:
    """Create this employee's cases for every occurrence starting up to ``horizon``.

    The horizon reaches past ``now`` on purpose: a register that only holds
    started shifts cannot show the rest of the day, so a site running three
    rotations would see one of them at a time. A case created before its shift
    begins carries no verdict - the evaluator answers ``scheduled`` until the
    window closes - so materializing early informs the roster without judging it.
    """
    employee = db.get(Employee, employee_id)
    if employee is None or employee.status.lower() != _ACTIVE_EMPLOYEE_STATUS:
        return []
    horizon_db = _as_db_utc(horizon)
    cutoff = _as_db_utc(evaluation_start_at) if evaluation_start_at is not None else None
    occurrences = db.scalars(
        select(WorkShiftOccurrence)
        .where(WorkShiftOccurrence.starts_at <= horizon_db)
        .order_by(WorkShiftOccurrence.starts_at, WorkShiftOccurrence.id)
    ).all()
    created: list[AttendanceCase] = []
    for occurrence in occurrences:
        if cutoff is not None and occurrence.starts_at < cutoff:
            continue
        existing = db.scalar(
            select(AttendanceCase).where(
                AttendanceCase.employee_id == employee_id,
                AttendanceCase.scheduled_start_at == occurrence.starts_at,
            )
        )
        if existing is not None:
            continue
        membership = db.scalar(
            select(WorkCrewMembership).where(
                WorkCrewMembership.employee_id == employee_id,
                WorkCrewMembership.crew_id == occurrence.crew_id,
                WorkCrewMembership.effective_from <= occurrence.starts_at,
                or_(
                    WorkCrewMembership.effective_to.is_(None),
                    WorkCrewMembership.effective_to > occurrence.starts_at,
                ),
            )
        )
        if membership is None:
            continue
        crew = db.get(WorkCrew, occurrence.crew_id)
        shift = db.get(WorkShiftDefinition, occurrence.shift_definition_id)
        duty_event = db.scalar(
            select(DutyAssignmentEvent)
            .where(
                DutyAssignmentEvent.employee_id == employee_id,
                DutyAssignmentEvent.effective_at <= occurrence.starts_at,
            )
            .order_by(DutyAssignmentEvent.effective_at.desc(), DutyAssignmentEvent.id.desc())
        )
        case = AttendanceCase(
            employee_id=employee_id,
            shift_occurrence_id=occurrence.id,
            duty_assignment_event_id=duty_event.id if duty_event is not None else None,
            employee_status_snapshot=employee.status,
            crew_code_snapshot=crew.code if crew is not None else None,
            crew_name_snapshot=(crew.name_en or crew.name_ar) if crew is not None else None,
            shift_code_snapshot=shift.code if shift is not None else "unknown",
            department_snapshot=(
                duty_event.to_department if duty_event is not None else employee.department
            ),
            duty_unit_snapshot=(duty_event.to_unit if duty_event is not None else employee.duty_unit),
            duty_post_snapshot=(duty_event.to_post if duty_event is not None else employee.duty_post),
            scheduled_start_at=occurrence.starts_at,
            scheduled_end_at=occurrence.ends_at,
            operational_date=occurrence.operational_date,
            organization_snapshot_state="reconstructed" if duty_event is not None else "captured",
        )
        db.add(case)
        created.append(case)
    if created:
        db.flush()
    return created


@dataclass(frozen=True)
class EffectiveAttendance:
    """The latest automatic revision with one active human leaf overlaid."""

    attendance_case_id: int
    evaluation_id: int
    adjustment_id: int | None
    version: int
    presence_state: str
    first_in_at: datetime | None
    latest_in_at: datetime | None
    final_out_at: datetime | None
    late_minutes: int | None
    early_exit_minutes: int | None
    missing_checkout: bool
    reason_code: str


def _active_adjustment(db: Session, case_id: int) -> AttendanceAdjustment | None:
    rows = db.scalars(
        select(AttendanceAdjustment)
        .where(
            AttendanceAdjustment.attendance_case_id == case_id,
            AttendanceAdjustment.revoked_at.is_(None),
        )
        .order_by(AttendanceAdjustment.id)
    ).all()
    superseded = {row.supersedes_adjustment_id for row in rows if row.supersedes_adjustment_id is not None}
    leaves = [row for row in rows if row.id not in superseded]
    return leaves[-1] if leaves else None


def get_effective_attendance(db: Session, case_id: int) -> EffectiveAttendance:
    """Read the current automatic result with the active reviewed correction."""
    case = db.get(AttendanceCase, case_id)
    if case is None:
        raise NotFoundError("ATTENDANCE_CASE_NOT_FOUND", "Attendance case was not found.", case_id=case_id)
    automatic = db.scalar(
        select(AttendanceEvaluation)
        .where(AttendanceEvaluation.attendance_case_id == case_id)
        .order_by(AttendanceEvaluation.revision.desc())
    )
    if automatic is None:
        raise NotFoundError(
            "ATTENDANCE_EVALUATION_NOT_FOUND",
            "Attendance case has not been evaluated.",
            case_id=case_id,
        )
    adjustment = _active_adjustment(db, case_id)
    values: dict[str, Any] = {
        "presence_state": automatic.presence_state,
        "first_in_at": automatic.first_in_at,
        "latest_in_at": automatic.latest_in_at,
        "final_out_at": automatic.final_out_at,
        "late_minutes": automatic.late_minutes,
        "early_exit_minutes": automatic.early_exit_minutes,
        "missing_checkout": automatic.missing_checkout,
        "reason_code": automatic.reason_code,
    }
    if adjustment is not None:
        for source_name, target_name in (
            ("replacement_presence_state", "presence_state"),
            ("replacement_first_in_at", "first_in_at"),
            ("replacement_latest_in_at", "latest_in_at"),
            ("replacement_final_out_at", "final_out_at"),
            ("replacement_late_minutes", "late_minutes"),
            ("replacement_early_exit_minutes", "early_exit_minutes"),
            ("replacement_missing_checkout", "missing_checkout"),
        ):
            replacement = getattr(adjustment, source_name)
            if replacement is not None:
                values[target_name] = replacement
    return EffectiveAttendance(
        attendance_case_id=case_id,
        evaluation_id=automatic.id,
        adjustment_id=adjustment.id if adjustment is not None else None,
        version=adjustment.id if adjustment is not None else automatic.id,
        **values,
    )


def _coerce_version(value: int | str) -> int:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str):
        token = value.strip().strip('"')
        if token.isdecimal():
            return int(token)
    raise ValidationFailedError("ATTENDANCE_CASE_VERSION_INVALID", "If-Match must be an effective version.")


def _normalize_replacement(replacement: Mapping[str, Any]) -> dict[str, Any]:
    if not replacement or set(replacement) - _ADJUSTMENT_KEYS:
        raise ValidationFailedError(
            "ATTENDANCE_ADJUSTMENT_INVALID",
            "Adjustment contains no supported replacement fields.",
        )
    normalized = dict(replacement)
    state = normalized.get("presence_state")
    if state is not None and state not in _VALID_PRESENCE_STATES:
        raise ValidationFailedError(
            "ATTENDANCE_ADJUSTMENT_INVALID", "Replacement presence state is invalid."
        )
    for key in ("late_minutes", "early_exit_minutes"):
        value = normalized.get(key)
        if value is not None and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
            raise ValidationFailedError(
                "ATTENDANCE_ADJUSTMENT_INVALID", f"Replacement {key} must be a non-negative integer."
            )
    if "missing_checkout" in normalized and not isinstance(normalized["missing_checkout"], bool):
        raise ValidationFailedError(
            "ATTENDANCE_ADJUSTMENT_INVALID", "Replacement missing_checkout must be boolean."
        )
    for key in ("first_in_at", "latest_in_at", "final_out_at"):
        value = normalized.get(key)
        if value is not None:
            if not isinstance(value, datetime):
                raise ValidationFailedError(
                    "ATTENDANCE_ADJUSTMENT_INVALID", f"Replacement {key} must be a timestamp."
                )
            normalized[key] = _as_db_utc(value)
    first = normalized.get("first_in_at")
    latest = normalized.get("latest_in_at")
    final = normalized.get("final_out_at")
    if first is not None and latest is not None and _as_utc(latest) < _as_utc(first):
        raise ValidationFailedError(
            "ATTENDANCE_ADJUSTMENT_INVALID", "latest_in_at cannot precede first_in_at."
        )
    if latest is not None and final is not None and _as_utc(final) < _as_utc(latest):
        raise ValidationFailedError(
            "ATTENDANCE_ADJUSTMENT_INVALID", "final_out_at cannot precede latest_in_at."
        )
    return normalized


def _enqueue_adjustment_reevaluation(db: Session, case: AttendanceCase, now: datetime) -> None:
    # Local import avoids an evaluation/queue import cycle while preserving one
    # transaction for the adjustment and its durable work signal.
    from app.services.attendance_queue_service import enqueue_evaluation

    enqueue_evaluation(
        db,
        employee_id=case.employee_id,
        window_start_at=_as_utc(case.scheduled_start_at),
        window_end_at=_as_utc(case.scheduled_end_at),
        reason_code="ATTENDANCE_ADJUSTMENT_CHANGED",
        now=now,
    )


def _audit_adjustment(
    db: Session,
    *,
    action: str,
    case_id: int,
    actor_user_id: int,
    adjustment_id: int,
) -> None:
    db.add(
        AuditLog(
            actor=str(actor_user_id),
            action=action,
            entity_type="attendance_case",
            entity_id=str(case_id),
            payload=json.dumps({"adjustment_id": adjustment_id}, separators=(",", ":")),
            ts=_as_db_utc(datetime.now(UTC)),
        )
    )


def apply_adjustment(
    db: Session,
    case_id: int,
    *,
    if_match: int | str,
    replacement: Mapping[str, Any],
    reason: str,
    actor_user_id: int,
    now: datetime | None = None,
) -> AttendanceAdjustment:
    """Append a reviewed correction after checking the effective-version token."""
    if not reason or not reason.strip() or len(reason) > 1024:
        raise ValidationFailedError("ATTENDANCE_ADJUSTMENT_INVALID", "Adjustment reason is required.")
    case = db.scalar(select(AttendanceCase).where(AttendanceCase.id == case_id).with_for_update())
    if case is None:
        raise NotFoundError("ATTENDANCE_CASE_NOT_FOUND", "Attendance case was not found.", case_id=case_id)
    effective = get_effective_attendance(db, case_id)
    if _coerce_version(if_match) != effective.version:
        raise ConflictError(
            "ATTENDANCE_CASE_VERSION_CONFLICT",
            "Attendance case changed before the adjustment was applied.",
            current_version=effective.version,
        )
    normalized = _normalize_replacement(replacement)
    automatic_id = effective.evaluation_id
    current = _active_adjustment(db, case_id)
    adjustment = AttendanceAdjustment(
        attendance_case_id=case_id,
        base_evaluation_id=automatic_id,
        replacement_presence_state=normalized.get("presence_state"),
        replacement_first_in_at=normalized.get("first_in_at"),
        replacement_latest_in_at=normalized.get("latest_in_at"),
        replacement_final_out_at=normalized.get("final_out_at"),
        replacement_late_minutes=normalized.get("late_minutes"),
        replacement_early_exit_minutes=normalized.get("early_exit_minutes"),
        replacement_missing_checkout=normalized.get("missing_checkout"),
        reason=reason.strip(),
        created_by_user_id=actor_user_id,
        supersedes_adjustment_id=current.id if current is not None else None,
    )
    db.add(adjustment)
    db.flush()
    action_now = _as_utc(now) if now is not None else datetime.now(UTC)
    _enqueue_adjustment_reevaluation(db, case, action_now)
    _audit_adjustment(
        db,
        action="workforce.attendance_adjusted",
        case_id=case.id,
        actor_user_id=actor_user_id,
        adjustment_id=adjustment.id,
    )
    return adjustment


def revoke_adjustment(
    db: Session,
    adjustment_id: int,
    *,
    if_match: int | str,
    actor_user_id: int,
    now: datetime | None = None,
) -> AttendanceAdjustment:
    """Revoke only the effective leaf; its still-active predecessor is revealed."""
    adjustment = db.scalar(
        select(AttendanceAdjustment)
        .where(AttendanceAdjustment.id == adjustment_id)
        .with_for_update()
    )
    if adjustment is None:
        raise NotFoundError(
            "ATTENDANCE_ADJUSTMENT_NOT_FOUND", "Attendance adjustment was not found.", adjustment_id=adjustment_id
        )
    case = db.scalar(
        select(AttendanceCase)
        .where(AttendanceCase.id == adjustment.attendance_case_id)
        .with_for_update()
    )
    assert case is not None
    effective = get_effective_attendance(db, case.id)
    if _coerce_version(if_match) != effective.version or effective.adjustment_id != adjustment.id:
        raise ConflictError(
            "ATTENDANCE_CASE_VERSION_CONFLICT",
            "Attendance case changed before the adjustment was revoked.",
            current_version=effective.version,
        )
    adjustment.revoked_at = _as_db_utc(now or datetime.now(UTC))
    adjustment.revoked_by_user_id = actor_user_id
    db.flush()
    action_now = _as_utc(now) if now is not None else datetime.now(UTC)
    _enqueue_adjustment_reevaluation(db, case, action_now)
    _audit_adjustment(
        db,
        action="workforce.attendance_adjustment_revoked",
        case_id=case.id,
        actor_user_id=actor_user_id,
        adjustment_id=adjustment.id,
    )
    return adjustment


# Allocation is implemented beside raw punch persistence.  Re-exporting here
# preserves the domain-facing evaluator contract and keeps callers decoupled
# from provider/import plumbing.
from app.services.attendance_punch_service import resolve_assignment  # noqa: E402

__all__ = [
    "ALGORITHM_VERSION",
    "EffectiveAttendance",
    "apply_adjustment",
    "effective_policy",
    "evaluate_case",
    "get_effective_attendance",
    "materialize_scheduled_cases",
    "resolve_assignment",
    "revoke_adjustment",
]
