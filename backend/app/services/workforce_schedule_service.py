"""Effective-dated workforce rotation and roster administration.

All persisted instants are naive UTC.  Public service inputs may be aware UTC;
helpers normalize them at the persistence boundary.  The generator intentionally
uses timestamp arithmetic from each schedule anchor -- never weekdays -- so the
120-hour crew pattern cannot drift.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from math import floor
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from app.db.models import AuditLog, User
from app.db.workforce_models import (
    AttendanceCase,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkRotationStep,
    WorkShiftDefinition,
    WorkShiftOccurrence,
    WorkShiftOverride,
    WorkStaffingRequirement,
)


def _shift_boundary_times(db: Session) -> frozenset[time]:
    """Valid roster boundaries are exactly the configured shift start times.

    This was a hardcoded ``(4, 12, 20)`` hour set, which silently encoded one
    site's shift plan into the scheduler. The installed site runs 05:00/13:00/
    21:00 with an additional 07:00 office start, and a literal tuple would
    reject every legitimate anchor. Reading the definitions keeps the rule
    ("a roster change happens on a shift boundary") while letting the boundary
    set follow the configured shifts.
    """
    return frozenset(db.scalars(select(WorkShiftDefinition.start_local_time)))


@dataclass(frozen=True)
class AssignmentResolution:
    """Roster result for an employee at one instant.

    ``unknown`` means no effective crew membership, not an absence.  Attendance
    evaluation owns presence judgements from punches and policy.
    """

    presence: Literal["scheduled", "off", "unknown"]
    occurrence: WorkShiftOccurrence | None
    reason_code: str | None = None
    override: WorkShiftOverride | None = None

def _utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _utc_aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _actor_id(db: Session, current_user: User | None, actor_user_id: int | None) -> int:
    if actor_user_id is not None:
        return actor_user_id
    if current_user is not None:
        return current_user.id
    # Direct service consumers (notably controlled setup) have no request user.
    # The models intentionally require an actor FK, so use one durable local
    # service principal rather than writing a dangling sentinel identifier.
    service_user = db.scalar(select(User).order_by(User.id).limit(1))
    if service_user is None:
        service_user = User(
            email="workforce-system@local.invalid",
            password_hash="!",
            role="admin",
            status="disabled",
            display_name="Workforce system",
        )
        db.add(service_user)
        db.flush()
    return service_user.id


def _actor_label(current_user: User | None, actor_user_id: int | None) -> str | None:
    if current_user is not None:
        return current_user.employee_id or current_user.email
    return str(actor_user_id) if actor_user_id is not None else None


def _audit(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: int | str | None,
    actor: str | None,
    before: Mapping[str, object] | None = None,
    after: Mapping[str, object] | None = None,
) -> None:
    payload = {"before": before, "after": after}
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            payload=json.dumps(payload, default=str, sort_keys=True),
        )
    )


def _overlaps(
    existing_from: datetime,
    existing_to: datetime | None,
    requested_from: datetime,
    requested_to: datetime | None,
) -> bool:
    """Return whether two half-open windows overlap."""

    return (existing_to is None or requested_from < existing_to) and (
        requested_to is None or existing_from < requested_to
    )


def _validate_window(starts_at: datetime, ends_at: datetime | None, *, label: str) -> None:
    if ends_at is not None and ends_at <= starts_at:
        raise ValueError(f"{label} effective window must be half-open and non-empty")


def _is_shift_boundary(db: Session, value: datetime, timezone: str = "Asia/Dubai") -> bool:
    local = _utc_aware(value).astimezone(ZoneInfo(timezone))
    if local.second or local.microsecond:
        return False
    return local.time().replace(tzinfo=None) in _shift_boundary_times(db)


def _enqueue_evaluation(
    db: Session,
    *,
    employee_id: str,
    starts_at: datetime,
    ends_at: datetime,
    reason_code: str,
) -> None:
    """Stage, never commit, the bounded reevaluation request for a roster change."""

    # The queue is deliberately imported at call time: queue ownership is a
    # separate service and this module remains usable by migration/seed tooling.
    from app.services.attendance_queue_service import enqueue_evaluation

    enqueue_evaluation(
        db,
        employee_id=employee_id,
        window_start_at=_utc_aware(starts_at),
        window_end_at=_utc_aware(ends_at),
        reason_code=reason_code,
        now=datetime.now(UTC),
    )


def _schedule_rows_for_window(
    db: Session, *, crew_id: int, starts_at: datetime, ends_at: datetime
) -> list[WorkCrewSchedule]:
    return list(
        db.scalars(
            select(WorkCrewSchedule)
            .where(
                WorkCrewSchedule.crew_id == crew_id,
                WorkCrewSchedule.effective_from < ends_at,
                or_(
                    WorkCrewSchedule.effective_to.is_(None),
                    WorkCrewSchedule.effective_to > starts_at,
                ),
            )
            .order_by(WorkCrewSchedule.effective_from, WorkCrewSchedule.version)
        )
    )


def _pattern_steps(db: Session, pattern_id: int) -> list[tuple[WorkRotationStep, WorkShiftDefinition]]:
    rows = db.execute(
        select(WorkRotationStep, WorkShiftDefinition)
        .join(WorkShiftDefinition, WorkShiftDefinition.id == WorkRotationStep.shift_definition_id)
        .where(WorkRotationStep.pattern_id == pattern_id)
        .order_by(WorkRotationStep.start_offset_minutes)
    ).all()
    return [(row[0], row[1]) for row in rows]


def acquire_schedule_write_lock(db: Session) -> None:
    """Acquire SQLite's write lock without disturbing a caller-owned transaction.

    SQLAlchemy tracks a logical transaction for dependency reads, but SQLite
    has not necessarily started a DB-API transaction for such a read.  In that
    case ``BEGIN IMMEDIATE`` is both legal and required to serialize the
    following conflict recheck.  Once the DB-API connection has a real
    transaction, leave it to the caller rather than rolling it back or issuing
    a nested ``BEGIN``.
    """

    connection = db.connection()
    if connection.dialect.name != "sqlite":
        return
    pool_connection = connection.connection
    driver_connection = getattr(pool_connection, "driver_connection", pool_connection)
    if not getattr(driver_connection, "in_transaction", True):
        db.execute(text("BEGIN IMMEDIATE"))


def _validate_schedule_alignment(
    db: Session,
    *,
    pattern: WorkRotationPattern,
    anchor_at: datetime,
    effective_from: datetime,
    effective_to: datetime | None,
) -> None:
    if not _is_shift_boundary(db, effective_from, pattern.timezone) or (
        effective_to is not None and not _is_shift_boundary(db, effective_to, pattern.timezone)
    ):
        raise ValueError("schedule effective boundaries must be Dubai shift boundaries")
    offset_zero_steps = [
        shift
        for step, shift in _pattern_steps(db, pattern.id)
        if step.start_offset_minutes == 0
    ]
    if len(offset_zero_steps) != 1:
        raise ValueError("rotation pattern must have exactly one offset-zero shift")
    anchor_local = _utc_aware(anchor_at).astimezone(ZoneInfo(pattern.timezone))
    if anchor_local.time().replace(tzinfo=None) != offset_zero_steps[0].start_local_time:
        raise ValueError("schedule anchor must start the offset-zero shift")


def _validate_shift_override(
    db: Session,
    *,
    assignment_kind: str,
    reason_kind: str,
    starts_at: datetime,
    ends_at: datetime,
    reason: str,
    shift_definition_id: int | None,
    department: str | None,
    duty_unit: str | None,
    duty_post: str | None,
    allow_swap: bool,
) -> str:
    _validate_window(starts_at, ends_at, label="override")
    if assignment_kind not in {"work", "off"}:
        raise ValueError("override assignment_kind must be work or off")
    if reason_kind not in {
        "swap",
        "training",
        "temporary_duty",
        "exceptional_work",
        "exceptional_off",
        "other",
    }:
        raise ValueError("override reason_kind is invalid")
    if reason_kind == "swap" and not allow_swap:
        raise ValueError("swap overrides must use the atomic swap command")
    if assignment_kind == "work" and shift_definition_id is None:
        raise ValueError("work override requires shift_definition_id")
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise ValueError("override reason is required")
    if duty_post is not None and duty_unit is None:
        raise ValueError("override duty_post requires duty_unit prefix")
    if assignment_kind == "work":
        shift = db.get(WorkShiftDefinition, shift_definition_id)
        if shift is None:
            raise ValueError("shift definition does not exist")
        local_start = _utc_aware(starts_at).astimezone(ZoneInfo("Asia/Dubai"))
        if (
            ends_at - starts_at != timedelta(minutes=shift.duration_minutes)
            or local_start.time().replace(tzinfo=None) != shift.start_local_time
        ):
            raise ValueError("work override must occupy one canonical shift window")
    return normalized_reason


def _assert_no_active_shift_override_overlap(
    db: Session, *, employee_id: str, starts_at: datetime, ends_at: datetime
) -> None:
    existing = db.scalar(
        select(WorkShiftOverride.id)
        .where(
            WorkShiftOverride.employee_id == employee_id,
            WorkShiftOverride.cancelled_at.is_(None),
            WorkShiftOverride.starts_at < ends_at,
            WorkShiftOverride.ends_at > starts_at,
        )
        .limit(1)
    )
    if existing is not None:
        raise ValueError("active shift override overlap")


def _audit_created_shift_override(
    db: Session,
    *,
    override: WorkShiftOverride,
    current_user: User | None,
    actor_user_id: int | None,
) -> None:
    _audit(
        db,
        action="workforce.override.created",
        entity_type="work_shift_override",
        entity_id=override.id,
        actor=_actor_label(current_user, actor_user_id),
        after={
            "employee_id": override.employee_id,
            "assignment_kind": override.assignment_kind,
            "reason_kind": override.reason_kind,
            "starts_at": override.starts_at,
            "ends_at": override.ends_at,
            "correlation_id": override.correlation_id,
        },
    )


def _enqueue_shift_override_evaluation(db: Session, *, override: WorkShiftOverride) -> None:
    _enqueue_evaluation(
        db,
        employee_id=override.employee_id,
        starts_at=override.starts_at,
        ends_at=override.ends_at,
        reason_code="SHIFT_OVERRIDE_CHANGED",
    )


def create_crew_schedule(
    db: Session,
    *,
    crew_id: int,
    pattern_id: int,
    anchor_at: datetime,
    effective_from: datetime,
    effective_to: datetime | None = None,
    current_user: User | None = None,
    actor_user_id: int | None = None,
) -> WorkCrewSchedule:
    """Create a non-overlapping schedule version without committing.

    The caller owns transaction boundaries; occurrences are materialized by the
    bounded generator and historical rows are never rewritten here.
    """

    anchor = _utc_naive(anchor_at)
    starts = _utc_naive(effective_from)
    ends = _utc_naive(effective_to) if effective_to is not None else None
    _validate_window(starts, ends, label="schedule")
    acquire_schedule_write_lock(db)
    pattern = db.get(WorkRotationPattern, pattern_id)
    if pattern is None:
        raise ValueError("rotation pattern does not exist")
    _validate_schedule_alignment(
        db,
        pattern=pattern,
        anchor_at=anchor,
        effective_from=starts,
        effective_to=ends,
    )
    existing = list(
        db.scalars(
            select(WorkCrewSchedule).where(WorkCrewSchedule.crew_id == crew_id)
        )
    )
    if any(_overlaps(row.effective_from, row.effective_to, starts, ends) for row in existing):
        raise ValueError("schedule effective window overlap")
    version = max((row.version for row in existing), default=0) + 1
    actor_id = _actor_id(db, current_user, actor_user_id)
    schedule = WorkCrewSchedule(
        crew_id=crew_id,
        pattern_id=pattern_id,
        anchor_at=anchor,
        effective_from=starts,
        effective_to=ends,
        version=version,
        created_by_user_id=actor_id,
    )
    db.add(schedule)
    db.flush()
    _audit(
        db,
        action="workforce.schedule.created",
        entity_type="work_crew_schedule",
        entity_id=schedule.id,
        actor=_actor_label(current_user, actor_user_id),
        after={
            "crew_id": crew_id,
            "pattern_id": pattern_id,
            "anchor_at": anchor,
            "effective_from": starts,
            "effective_to": ends,
            "version": version,
        },
    )
    return schedule


def replace_crew_schedule(
    db: Session,
    *,
    crew_id: int,
    pattern_id: int,
    anchor_at: datetime,
    effective_from: datetime,
    expected_version: int,
    current_user: User | None = None,
    actor_user_id: int | None = None,
    now: datetime | None = None,
) -> WorkCrewSchedule:
    """Close an active version and append its future replacement.

    The replacement preserves the active version's finite endpoint, validates
    every boundary before writes, and never alters a schedule at an already
    started boundary.
    """

    boundary = _utc_naive(effective_from)
    replacement_anchor = _utc_naive(anchor_at)
    replacement_now = _utc_naive(now) if now is not None else _now()
    acquire_schedule_write_lock(db)
    if boundary <= replacement_now:
        raise ValueError("schedule replacement boundary has already started")
    current = db.scalar(
        select(WorkCrewSchedule)
        .where(
            WorkCrewSchedule.crew_id == crew_id,
            WorkCrewSchedule.effective_from <= boundary,
            or_(
                WorkCrewSchedule.effective_to.is_(None),
                WorkCrewSchedule.effective_to > boundary,
            ),
        )
        .order_by(WorkCrewSchedule.version.desc())
    )
    if current is None:
        raise ValueError("no schedule is effective at replacement boundary")
    if current.version != expected_version:
        raise ValueError("schedule version conflict")
    if boundary <= current.effective_from:
        raise ValueError("replacement must begin after the active schedule starts")
    pattern = db.get(WorkRotationPattern, pattern_id)
    if pattern is None:
        raise ValueError("rotation pattern does not exist")
    replacement_ends = current.effective_to
    _validate_schedule_alignment(
        db,
        pattern=pattern,
        anchor_at=replacement_anchor,
        effective_from=boundary,
        effective_to=replacement_ends,
    )
    existing = list(
        db.scalars(
            select(WorkCrewSchedule).where(WorkCrewSchedule.crew_id == crew_id)
        )
    )
    if any(
        row.id != current.id
        and _overlaps(row.effective_from, row.effective_to, boundary, replacement_ends)
        for row in existing
    ):
        raise ValueError("schedule effective window overlap")

    prior = {
        "effective_to": current.effective_to,
        "version": current.version,
        "pattern_id": current.pattern_id,
        "anchor_at": current.anchor_at,
    }
    current.effective_to = boundary
    db.flush()
    for occurrence in db.scalars(
        select(WorkShiftOccurrence).where(
            WorkShiftOccurrence.crew_id == crew_id,
            WorkShiftOccurrence.crew_schedule_id == current.id,
            WorkShiftOccurrence.starts_at >= boundary,
            WorkShiftOccurrence.starts_at > replacement_now,
        )
    ):
        if db.scalar(
            select(AttendanceCase.id).where(
                AttendanceCase.shift_occurrence_id == occurrence.id
            )
        ) is None:
            db.delete(occurrence)
    replacement = create_crew_schedule(
        db,
        crew_id=crew_id,
        pattern_id=pattern_id,
        anchor_at=replacement_anchor,
        effective_from=boundary,
        effective_to=replacement_ends,
        current_user=current_user,
        actor_user_id=actor_user_id,
    )
    _audit(
        db,
        action="workforce.schedule.replaced",
        entity_type="work_crew_schedule",
        entity_id=current.id,
        actor=_actor_label(current_user, actor_user_id),
        before=prior,
        after={"effective_to": boundary, "replacement_id": replacement.id},
    )
    return replacement


def generate_occurrences(
    db: Session,
    *,
    crew_id: int,
    starts_at: datetime,
    ends_at: datetime,
) -> list[WorkShiftOccurrence]:
    """Idempotently materialize starts in ``[starts_at, ends_at)`` for one crew."""

    starts = _utc_naive(starts_at)
    ends = _utc_naive(ends_at)
    if ends <= starts:
        raise ValueError("occurrence generation window must be non-empty")
    generated: list[WorkShiftOccurrence] = []
    for schedule in _schedule_rows_for_window(db, crew_id=crew_id, starts_at=starts, ends_at=ends):
        pattern = db.get(WorkRotationPattern, schedule.pattern_id)
        if pattern is None:
            raise ValueError("schedule rotation pattern does not exist")
        steps = _pattern_steps(db, pattern.id)
        if not steps:
            raise ValueError("rotation pattern has no steps")
        cycle = timedelta(minutes=pattern.cycle_minutes)
        anchor = schedule.anchor_at
        first_cycle = floor((starts - anchor) / cycle)
        # One additional cycle lets us visit steps after an initial negative
        # quotient; all candidates remain filtered to the bounded half-open window.
        cycle_index = first_cycle
        while anchor + cycle_index * cycle < ends:
            cycle_start = anchor + cycle_index * cycle
            for step, shift in steps:
                occurrence_start = cycle_start + timedelta(minutes=step.start_offset_minutes)
                if occurrence_start < starts or occurrence_start >= ends:
                    continue
                if occurrence_start < schedule.effective_from:
                    continue
                if schedule.effective_to is not None and occurrence_start >= schedule.effective_to:
                    continue
                existing = db.scalar(
                    select(WorkShiftOccurrence).where(
                        WorkShiftOccurrence.crew_id == crew_id,
                        WorkShiftOccurrence.starts_at == occurrence_start,
                    )
                )
                if existing is not None:
                    continue
                occurrence_end = occurrence_start + timedelta(minutes=shift.duration_minutes)
                operational_date = _utc_aware(occurrence_start).astimezone(
                    ZoneInfo(pattern.timezone)
                ).date()
                occurrence = WorkShiftOccurrence(
                    crew_id=crew_id,
                    crew_schedule_id=schedule.id,
                    shift_definition_id=shift.id,
                    starts_at=occurrence_start,
                    ends_at=occurrence_end,
                    operational_date=operational_date,
                    pattern_code_snapshot=pattern.code,
                    crew_schedule_version_snapshot=schedule.version,
                    source_anchor_at=schedule.anchor_at,
                )
                db.add(occurrence)
                generated.append(occurrence)
            cycle_index += 1
    db.flush()
    return generated


def create_crew_membership(
    db: Session,
    *,
    employee_id: str,
    crew_id: int,
    effective_from: datetime,
    effective_to: datetime | None = None,
    end_reason: str | None = None,
    current_user: User | None = None,
    actor_user_id: int | None = None,
) -> WorkCrewMembership:
    """Append an effective crew membership after rejecting all overlaps."""

    starts = _utc_naive(effective_from)
    ends = _utc_naive(effective_to) if effective_to is not None else None
    _validate_window(starts, ends, label="membership")
    acquire_schedule_write_lock(db)
    if not _is_shift_boundary(db, starts) or (ends is not None and not _is_shift_boundary(db, ends)):
        raise ValueError("membership changes must use Dubai shift boundaries")
    existing = list(
        db.scalars(
            select(WorkCrewMembership).where(WorkCrewMembership.employee_id == employee_id)
        )
    )
    if any(_overlaps(row.effective_from, row.effective_to, starts, ends) for row in existing):
        raise ValueError("crew membership effective window overlap")
    actor_id = _actor_id(db, current_user, actor_user_id)
    membership = WorkCrewMembership(
        employee_id=employee_id,
        crew_id=crew_id,
        effective_from=starts,
        effective_to=ends,
        end_reason=end_reason,
        created_by_user_id=actor_id,
        updated_by_user_id=actor_id,
    )
    db.add(membership)
    db.flush()
    _audit(
        db,
        action="workforce.membership.created",
        entity_type="work_crew_membership",
        entity_id=membership.id,
        actor=_actor_label(current_user, actor_user_id),
        after={
            "employee_id": employee_id,
            "crew_id": crew_id,
            "effective_from": starts,
            "effective_to": ends,
            "end_reason": end_reason,
        },
    )
    _enqueue_evaluation(
        db,
        employee_id=employee_id,
        starts_at=starts,
        # A membership with no end affects only future, not-yet-evaluated work.
        ends_at=ends or starts + timedelta(days=1),
        reason_code="CREW_MEMBERSHIP_CHANGED",
    )
    return membership


def end_crew_membership(
    db: Session,
    *,
    membership_id: int,
    effective_to: datetime,
    end_reason: str,
    current_user: User | None = None,
    actor_user_id: int | None = None,
) -> WorkCrewMembership:
    """Close, rather than delete, a membership at a shift boundary."""

    acquire_schedule_write_lock(db)
    membership = db.get(WorkCrewMembership, membership_id)
    if membership is None:
        raise ValueError("crew membership does not exist")
    boundary = _utc_naive(effective_to)
    if boundary <= membership.effective_from or not _is_shift_boundary(db, boundary):
        raise ValueError("membership end must be a later Dubai shift boundary")
    if membership.effective_to is not None and boundary > membership.effective_to:
        raise ValueError("membership is already closed earlier")
    before = {"effective_to": membership.effective_to, "end_reason": membership.end_reason}
    membership.effective_to = boundary
    membership.end_reason = end_reason
    membership.updated_by_user_id = _actor_id(db, current_user, actor_user_id)
    _audit(
        db,
        action="workforce.membership.ended",
        entity_type="work_crew_membership",
        entity_id=membership.id,
        actor=_actor_label(current_user, actor_user_id),
        before=before,
        after={"effective_to": boundary, "end_reason": end_reason},
    )
    _enqueue_evaluation(
        db,
        employee_id=membership.employee_id,
        starts_at=boundary - timedelta(days=1),
        ends_at=boundary,
        reason_code="CREW_MEMBERSHIP_CHANGED",
    )
    return membership


def create_shift_override(
    db: Session,
    *,
    employee_id: str,
    assignment_kind: Literal["work", "off"],
    reason_kind: Literal[
        "swap", "training", "temporary_duty", "exceptional_work", "exceptional_off", "other"
    ],
    starts_at: datetime,
    ends_at: datetime,
    reason: str,
    shift_definition_id: int | None = None,
    crew_id: int | None = None,
    department: str | None = None,
    duty_unit: str | None = None,
    duty_post: str | None = None,
    correlation_id: str | None = None,
    current_user: User | None = None,
    actor_user_id: int | None = None,
) -> WorkShiftOverride:
    """Create one non-swap, non-contradictory dated exception."""

    starts = _utc_naive(starts_at)
    ends = _utc_naive(ends_at)
    acquire_schedule_write_lock(db)
    normalized_reason = _validate_shift_override(
        db,
        assignment_kind=assignment_kind,
        reason_kind=reason_kind,
        starts_at=starts,
        ends_at=ends,
        reason=reason,
        shift_definition_id=shift_definition_id,
        department=department,
        duty_unit=duty_unit,
        duty_post=duty_post,
        allow_swap=False,
    )
    _assert_no_active_shift_override_overlap(
        db, employee_id=employee_id, starts_at=starts, ends_at=ends
    )
    override = WorkShiftOverride(
        employee_id=employee_id,
        assignment_kind=assignment_kind,
        reason_kind=reason_kind,
        starts_at=starts,
        ends_at=ends,
        shift_definition_id=shift_definition_id,
        crew_id=crew_id,
        department=department,
        duty_unit=duty_unit,
        duty_post=duty_post,
        correlation_id=correlation_id,
        reason=normalized_reason,
        created_by_user_id=_actor_id(db, current_user, actor_user_id),
    )
    db.add(override)
    db.flush()
    _audit_created_shift_override(
        db,
        override=override,
        current_user=current_user,
        actor_user_id=actor_user_id,
    )
    _enqueue_shift_override_evaluation(db, override=override)
    return override


def create_shift_swap(
    db: Session,
    *,
    from_employee_id: str,
    to_employee_id: str,
    starts_at: datetime,
    ends_at: datetime,
    shift_definition_id: int,
    reason: str,
    current_user: User | None = None,
    actor_user_id: int | None = None,
) -> tuple[WorkShiftOverride, WorkShiftOverride, str]:
    """Atomically create the surrendered-off and acquired-work swap legs."""

    starts = _utc_naive(starts_at)
    ends = _utc_naive(ends_at)
    if from_employee_id == to_employee_id:
        raise ValueError("shift swap requires two different employees")
    acquire_schedule_write_lock(db)
    normalized_reason = _validate_shift_override(
        db,
        assignment_kind="off",
        reason_kind="swap",
        starts_at=starts,
        ends_at=ends,
        reason=reason,
        shift_definition_id=None,
        department=None,
        duty_unit=None,
        duty_post=None,
        allow_swap=True,
    )
    _validate_shift_override(
        db,
        assignment_kind="work",
        reason_kind="swap",
        starts_at=starts,
        ends_at=ends,
        reason=normalized_reason,
        shift_definition_id=shift_definition_id,
        department=None,
        duty_unit=None,
        duty_post=None,
        allow_swap=True,
    )
    _assert_no_active_shift_override_overlap(
        db, employee_id=from_employee_id, starts_at=starts, ends_at=ends
    )
    _assert_no_active_shift_override_overlap(
        db, employee_id=to_employee_id, starts_at=starts, ends_at=ends
    )

    correlation_id = uuid4().hex
    actor_id = _actor_id(db, current_user, actor_user_id)
    off = WorkShiftOverride(
        employee_id=from_employee_id,
        assignment_kind="off",
        reason_kind="swap",
        starts_at=starts,
        ends_at=ends,
        shift_definition_id=None,
        correlation_id=correlation_id,
        reason=normalized_reason,
        created_by_user_id=actor_id,
    )
    work = WorkShiftOverride(
        employee_id=to_employee_id,
        assignment_kind="work",
        reason_kind="swap",
        starts_at=starts,
        ends_at=ends,
        shift_definition_id=shift_definition_id,
        correlation_id=correlation_id,
        reason=normalized_reason,
        created_by_user_id=actor_id,
    )
    db.add_all((off, work))
    db.flush()
    for override in (off, work):
        _audit_created_shift_override(
            db,
            override=override,
            current_user=current_user,
            actor_user_id=actor_user_id,
        )
        _enqueue_shift_override_evaluation(db, override=override)
    return off, work, correlation_id


def cancel_shift_override(
    db: Session,
    *,
    override_id: int,
    current_user: User | None = None,
    actor_user_id: int | None = None,
    now: datetime | None = None,
) -> WorkShiftOverride:
    """Audit-cancel an override; never remove a historical row."""

    override = db.get(WorkShiftOverride, override_id)
    if override is None:
        raise ValueError("shift override does not exist")
    if override.cancelled_at is not None:
        raise ValueError("shift override is already cancelled")
    cancelled = _utc_naive(now) if now is not None else _now()
    override.cancelled_at = cancelled
    override.cancelled_by_user_id = _actor_id(db, current_user, actor_user_id)
    _audit(
        db,
        action="workforce.override.cancelled",
        entity_type="work_shift_override",
        entity_id=override.id,
        actor=_actor_label(current_user, actor_user_id),
        before={"cancelled_at": None},
        after={"cancelled_at": cancelled},
    )
    _enqueue_evaluation(
        db,
        employee_id=override.employee_id,
        starts_at=override.starts_at,
        ends_at=override.ends_at,
        reason_code="SHIFT_OVERRIDE_CANCELLED",
    )
    return override


def create_staffing_requirement(
    db: Session,
    *,
    scope_kind: Literal["department", "duty_unit", "duty_post"],
    department: str | None,
    duty_unit: str | None,
    duty_post: str | None,
    minimum_headcount: int,
    effective_from: date,
    effective_to: date | None = None,
    shift_definition_id: int | None = None,
    current_user: User | None = None,
    actor_user_id: int | None = None,
) -> WorkStaffingRequirement:
    """Create a draft target, rejecting same-scope effective conflicts."""

    if minimum_headcount < 0:
        raise ValueError("minimum_headcount must be non-negative")
    if effective_to is not None and effective_to <= effective_from:
        raise ValueError("staffing effective window must be half-open and non-empty")
    # A department target names a department; a unit or post target names its own
    # levels and may leave the department unrecorded.
    expected_hierarchy = {
        "department": (department is not None, duty_unit is None, duty_post is None),
        "duty_unit": (True, duty_unit is not None, duty_post is None),
        "duty_post": (True, duty_unit is not None, duty_post is not None),
    }
    if scope_kind not in expected_hierarchy or not all(expected_hierarchy[scope_kind]):
        raise ValueError("staffing requirement hierarchy does not match scope_kind")
    candidates = list(
        db.scalars(
            select(WorkStaffingRequirement).where(
                WorkStaffingRequirement.scope_kind == scope_kind,
                WorkStaffingRequirement.department == department,
                WorkStaffingRequirement.duty_unit == duty_unit,
                WorkStaffingRequirement.duty_post == duty_post,
                WorkStaffingRequirement.shift_definition_id == shift_definition_id,
            )
        )
    )
    if any(
        _overlaps(
            datetime.combine(row.effective_from, datetime.min.time()),
            datetime.combine(row.effective_to, datetime.min.time()) if row.effective_to else None,
            datetime.combine(effective_from, datetime.min.time()),
            datetime.combine(effective_to, datetime.min.time()) if effective_to else None,
        )
        for row in candidates
    ):
        raise ValueError("staffing requirement effective window overlap")
    requirement = WorkStaffingRequirement(
        scope_kind=scope_kind,
        department=department,
        duty_unit=duty_unit,
        duty_post=duty_post,
        shift_definition_id=shift_definition_id,
        minimum_headcount=minimum_headcount,
        effective_from=effective_from,
        effective_to=effective_to,
        created_by_user_id=_actor_id(db, current_user, actor_user_id),
    )
    db.add(requirement)
    db.flush()
    _audit(
        db,
        action="workforce.staffing_requirement.created",
        entity_type="work_staffing_requirement",
        entity_id=requirement.id,
        actor=_actor_label(current_user, actor_user_id),
        after={
            "scope_kind": scope_kind,
            "department": department,
            "duty_unit": duty_unit,
            "duty_post": duty_post,
            "shift_definition_id": shift_definition_id,
            "minimum_headcount": minimum_headcount,
            "effective_from": effective_from,
            "effective_to": effective_to,
        },
    )
    return requirement


def approve_staffing_requirement(
    db: Session,
    *,
    requirement_id: int,
    expected_updated_at: datetime | None = None,
    current_user: User | None = None,
    actor_user_id: int | None = None,
    now: datetime | None = None,
) -> WorkStaffingRequirement:
    """Approve an unchanged draft with an optional If-Match timestamp."""

    requirement = db.get(WorkStaffingRequirement, requirement_id)
    if requirement is None:
        raise ValueError("staffing requirement does not exist")
    if requirement.approved_at is not None:
        raise ValueError("staffing requirement is already approved")
    if expected_updated_at is not None and _utc_naive(expected_updated_at) != requirement.updated_at:
        raise ValueError("staffing requirement version conflict")
    approved_at = _utc_naive(now) if now is not None else _now()
    requirement.approved_by_user_id = _actor_id(db, current_user, actor_user_id)
    requirement.approved_at = approved_at
    _audit(
        db,
        action="workforce.staffing_requirement.approved",
        entity_type="work_staffing_requirement",
        entity_id=requirement.id,
        actor=_actor_label(current_user, actor_user_id),
        before={"approved_at": None},
        after={"approved_at": approved_at},
    )
    return requirement


def resolve_assignment(db: Session, *, employee_id: str, at: datetime) -> AssignmentResolution:
    """Resolve roster/override state at an instant without judging attendance."""

    instant = _utc_naive(at)
    override = db.scalar(
        select(WorkShiftOverride)
        .where(
            WorkShiftOverride.employee_id == employee_id,
            WorkShiftOverride.cancelled_at.is_(None),
            WorkShiftOverride.starts_at <= instant,
            WorkShiftOverride.ends_at > instant,
        )
        .order_by(WorkShiftOverride.created_at.desc(), WorkShiftOverride.id.desc())
    )
    if override is not None:
        if override.assignment_kind == "off":
            return AssignmentResolution("off", None, "SHIFT_OVERRIDE_OFF", override)
        occurrence = None
        if override.crew_id is not None:
            occurrence = db.scalar(
                select(WorkShiftOccurrence).where(
                    WorkShiftOccurrence.crew_id == override.crew_id,
                    WorkShiftOccurrence.starts_at == override.starts_at,
                    WorkShiftOccurrence.ends_at == override.ends_at,
                    WorkShiftOccurrence.shift_definition_id == override.shift_definition_id,
                )
            )
        return AssignmentResolution("scheduled", occurrence, "SHIFT_OVERRIDE_WORK", override)

    membership = db.scalar(
        select(WorkCrewMembership)
        .where(
            WorkCrewMembership.employee_id == employee_id,
            WorkCrewMembership.effective_from <= instant,
            or_(
                WorkCrewMembership.effective_to.is_(None),
                WorkCrewMembership.effective_to > instant,
            ),
        )
        .order_by(WorkCrewMembership.effective_from.desc(), WorkCrewMembership.id.desc())
    )
    if membership is None:
        return AssignmentResolution("unknown", None, "NO_CREW_MEMBERSHIP")
    schedule = db.scalar(
        select(WorkCrewSchedule)
        .where(
            WorkCrewSchedule.crew_id == membership.crew_id,
            WorkCrewSchedule.effective_from <= instant,
            or_(
                WorkCrewSchedule.effective_to.is_(None),
                WorkCrewSchedule.effective_to > instant,
            ),
        )
        .order_by(WorkCrewSchedule.effective_from.desc(), WorkCrewSchedule.version.desc())
    )
    if schedule is None:
        return AssignmentResolution("unknown", None, "NO_CREW_SCHEDULE")
    pattern = db.get(WorkRotationPattern, schedule.pattern_id)
    if pattern is None or pattern.cycle_minutes <= 0:
        return AssignmentResolution("unknown", None, "NO_CREW_SCHEDULE")
    cycle = timedelta(minutes=pattern.cycle_minutes)
    cycle_start = schedule.anchor_at + floor((instant - schedule.anchor_at) / cycle) * cycle
    phase: tuple[datetime, datetime, WorkShiftDefinition] | None = None
    for step, shift in _pattern_steps(db, pattern.id):
        starts_at = cycle_start + timedelta(minutes=step.start_offset_minutes)
        ends_at = starts_at + timedelta(minutes=shift.duration_minutes)
        if starts_at <= instant < ends_at:
            phase = (starts_at, ends_at, shift)
            break
    if phase is None:
        return AssignmentResolution("off", None, "CREW_SCHEDULE_OFF")
    starts_at, ends_at, shift = phase
    occurrence = db.scalar(
        select(WorkShiftOccurrence).where(
            WorkShiftOccurrence.crew_id == membership.crew_id,
            WorkShiftOccurrence.starts_at == starts_at,
            WorkShiftOccurrence.ends_at == ends_at,
            WorkShiftOccurrence.shift_definition_id == shift.id,
        )
    )
    if occurrence is None:
        return AssignmentResolution("unknown", None, "NO_SCHEDULED_OCCURRENCE")
    return AssignmentResolution("scheduled", occurrence)


__all__ = [
    "AssignmentResolution",
    "acquire_schedule_write_lock",
    "approve_staffing_requirement",
    "cancel_shift_override",
    "create_crew_membership",
    "create_crew_schedule",
    "create_shift_override",
    "create_shift_swap",
    "create_staffing_requirement",
    "end_crew_membership",
    "generate_occurrences",
    "replace_crew_schedule",
    "resolve_assignment",
]
