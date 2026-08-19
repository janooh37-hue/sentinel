"""Scoped person-level workforce reads and non-secret integration projections."""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from math import floor
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.db.models import Employee
from app.db.workforce_models import (
    AttendanceAdjustment,
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationQueue,
    AttendanceProviderPerson,
    AttendanceSyncState,
    DutyAssignmentEvent,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkRotationStep,
    WorkShiftDefinition,
)
from app.services.workforce_scope_service import scope_allows


def _latest_evaluations(db: Session, case_ids: list[int]) -> dict[int, AttendanceEvaluation]:
    if not case_ids:
        return {}
    rows = db.scalars(
        select(AttendanceEvaluation)
        .where(AttendanceEvaluation.attendance_case_id.in_(case_ids))
        .order_by(AttendanceEvaluation.attendance_case_id, AttendanceEvaluation.revision.desc())
    )
    latest: dict[int, AttendanceEvaluation] = {}
    for row in rows:
        latest.setdefault(row.attendance_case_id, row)
    return latest


def _case_allowed(case: AttendanceCase, scope: Any) -> bool:
    return scope_allows(
        scope,
        employee_id=case.employee_id,
        department=case.department_snapshot,
        duty_unit=case.duty_unit_snapshot,
        duty_post=case.duty_post_snapshot,
    )


def _employee_row(db: Session, employee_id: str) -> Employee | None:
    return db.get(Employee, employee_id)


def _person_fields(db: Session, case: AttendanceCase) -> dict[str, Any]:
    employee = _employee_row(db, case.employee_id)
    return {
        "employee_id": case.employee_id,
        "name_en": employee.name_en if employee else "",
        "name_ar": employee.name_ar if employee else None,
        "department": case.department_snapshot,
        "duty_unit": case.duty_unit_snapshot,
        "duty_post": case.duty_post_snapshot,
        "crew_code": case.crew_code_snapshot,
        "shift_code": case.shift_code_snapshot,
        "scheduled_start_at": case.scheduled_start_at,
        "scheduled_end_at": case.scheduled_end_at,
    }


def list_roster(db: Session, *, scope: Any, operational_date: date) -> list[dict[str, Any]]:
    cases = [
        case
        for case in db.scalars(select(AttendanceCase).where(AttendanceCase.operational_date == operational_date))
        if _case_allowed(case, scope)
    ]
    latest = _latest_evaluations(db, [case.id for case in cases])
    result: list[dict[str, Any]] = []
    for case in cases:
        evaluation = latest.get(case.id)
        result.append(
            {
                **_person_fields(db, case),
                "presence_state": evaluation.presence_state if evaluation else None,
                "reason_code": evaluation.reason_code if evaluation else None,
            }
        )
    return sorted(result, key=lambda row: (row["scheduled_start_at"], row["employee_id"]))


def list_exceptions(
    db: Session,
    *,
    scope: Any,
    operational_date: date | None = None,
    presence: str | None = None,
    exception: str | None = None,
) -> list[dict[str, Any]]:
    query = select(AttendanceCase)
    if operational_date is not None:
        query = query.where(AttendanceCase.operational_date == operational_date)
    cases = [case for case in db.scalars(query) if _case_allowed(case, scope)]
    latest = _latest_evaluations(db, [case.id for case in cases])
    result: list[dict[str, Any]] = []
    for case in cases:
        evaluation = latest.get(case.id)
        if evaluation is None:
            continue
        if presence and evaluation.presence_state != presence:
            continue
        has_exception = bool(
            (evaluation.late_minutes or 0) > 0
            or (evaluation.early_exit_minutes or 0) > 0
            or evaluation.missing_checkout
            or evaluation.presence_state in {"absent", "unknown"}
        )
        if exception and not has_exception:
            continue
        if not has_exception:
            continue
        result.append(
            {
                **_person_fields(db, case),
                "presence_state": evaluation.presence_state,
                "reason_code": evaluation.reason_code,
                "late_minutes": evaluation.late_minutes,
                "early_exit_minutes": evaluation.early_exit_minutes,
                "missing_checkout": evaluation.missing_checkout,
            }
        )
    return sorted(result, key=lambda row: (row["scheduled_start_at"], row["employee_id"]))


def _evaluation_read(row: AttendanceEvaluation) -> dict[str, Any]:
    return {
        "id": row.id,
        "revision": row.revision,
        "presence_state": row.presence_state,
        "reason_code": row.reason_code,
        "first_in_at": row.first_in_at,
        "latest_in_at": row.latest_in_at,
        "final_out_at": row.final_out_at,
        "late_minutes": row.late_minutes,
        "early_exit_minutes": row.early_exit_minutes,
        "missing_checkout": row.missing_checkout,
        "evaluated_at": row.evaluated_at,
    }


def _adjustment_read(row: AttendanceAdjustment) -> dict[str, Any]:
    return {
        "id": row.id,
        "base_evaluation_id": row.base_evaluation_id,
        "replacement_presence_state": row.replacement_presence_state,
        "replacement_first_in_at": row.replacement_first_in_at,
        "replacement_latest_in_at": row.replacement_latest_in_at,
        "replacement_final_out_at": row.replacement_final_out_at,
        "replacement_late_minutes": row.replacement_late_minutes,
        "replacement_early_exit_minutes": row.replacement_early_exit_minutes,
        "replacement_missing_checkout": row.replacement_missing_checkout,
        "reason": row.reason,
        "created_at": row.created_at,
        "revoked_at": row.revoked_at,
        "supersedes_adjustment_id": row.supersedes_adjustment_id,
    }


def get_attendance_case(db: Session, *, scope: Any, case_id: int) -> dict[str, Any]:
    case = db.get(AttendanceCase, case_id)
    if case is None:
        raise NotFoundError("ATTENDANCE_CASE_NOT_FOUND", "Attendance case was not found.")
    if not _case_allowed(case, scope):
        from app.api.errors import AppError

        raise AppError("FORBIDDEN", "Attendance case is outside workforce scope.", http_status=403)
    evaluations = list(
        db.scalars(
            select(AttendanceEvaluation)
            .where(AttendanceEvaluation.attendance_case_id == case.id)
            .order_by(AttendanceEvaluation.revision)
        )
    )
    adjustments = list(
        db.scalars(
            select(AttendanceAdjustment)
            .where(AttendanceAdjustment.attendance_case_id == case.id)
            .order_by(AttendanceAdjustment.created_at)
        )
    )
    latest = evaluations[-1] if evaluations else None
    active = next(
        (
            adjustment
            for adjustment in reversed(adjustments)
            if adjustment.revoked_at is None
            and not any(other.supersedes_adjustment_id == adjustment.id for other in adjustments)
        ),
        None,
    )
    effective: dict[str, Any] | None = _evaluation_read(latest) if latest else None
    if effective is not None and active is not None:
        replacements = {
            "presence_state": active.replacement_presence_state,
            "first_in_at": active.replacement_first_in_at,
            "latest_in_at": active.replacement_latest_in_at,
            "final_out_at": active.replacement_final_out_at,
            "late_minutes": active.replacement_late_minutes,
            "early_exit_minutes": active.replacement_early_exit_minutes,
            "missing_checkout": active.replacement_missing_checkout,
        }
        effective.update({key: value for key, value in replacements.items() if value is not None})
        effective["adjustment_id"] = active.id
    return {
        "id": case.id,
        "employee_id": case.employee_id,
        "operational_date": case.operational_date,
        "scheduled_start_at": case.scheduled_start_at,
        "scheduled_end_at": case.scheduled_end_at,
        "effective": effective,
        "evaluations": [_evaluation_read(row) for row in evaluations],
        "adjustments": [_adjustment_read(row) for row in adjustments],
    }


def list_duty_assignment_events(db: Session, *, scope: Any) -> list[dict[str, Any]]:
    rows = list(db.scalars(select(DutyAssignmentEvent).order_by(DutyAssignmentEvent.effective_at.desc())))
    result: list[dict[str, Any]] = []
    for row in rows:
        if not scope_allows(
            scope,
            employee_id=row.employee_id,
            department=row.to_department,
            duty_unit=row.to_unit,
            duty_post=row.to_post,
        ):
            continue
        result.append(
            {
                "id": row.id,
                "employee_id": row.employee_id,
                "event_type": row.event_type,
                "from_department": row.from_department,
                "from_unit": row.from_unit,
                "from_post": row.from_post,
                "to_department": row.to_department,
                "to_unit": row.to_unit,
                "to_post": row.to_post,
                "effective_at": row.effective_at,
                "reason": row.reason,
            }
        )
    return result



def shift_definition_read(row: WorkShiftDefinition) -> dict[str, Any]:
    """Return the full immutable shift definition contract."""

    return {
        "id": row.id,
        "code": row.code,
        "start_local_time": row.start_local_time,
        "duration_minutes": row.duration_minutes,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def rotation_read(db: Session, row: WorkRotationPattern) -> dict[str, Any]:
    """Return one immutable rotation with its ordered materializing steps."""

    steps = list(
        db.scalars(
            select(WorkRotationStep)
            .where(WorkRotationStep.pattern_id == row.id)
            .order_by(WorkRotationStep.start_offset_minutes, WorkRotationStep.id)
        )
    )
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "cycle_minutes": row.cycle_minutes,
        "timezone": row.timezone,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "steps": [
            {
                "id": step.id,
                "pattern_id": step.pattern_id,
                "shift_definition_id": step.shift_definition_id,
                "start_offset_minutes": step.start_offset_minutes,
            }
            for step in steps
        ],
    }


def crew_schedule_read(row: WorkCrewSchedule) -> dict[str, Any]:
    """Return every persisted schedule field without leaking unrelated actor data."""

    return {
        "id": row.id,
        "crew_id": row.crew_id,
        "pattern_id": row.pattern_id,
        "anchor_at": row.anchor_at,
        "effective_from": row.effective_from,
        "effective_to": row.effective_to,
        "version": row.version,
        "created_by_user_id": row.created_by_user_id,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def crew_membership_read(row: WorkCrewMembership) -> dict[str, Any]:
    """Return every persisted membership field for a schedule administrator."""

    return {
        "id": row.id,
        "crew_id": row.crew_id,
        "employee_id": row.employee_id,
        "effective_from": row.effective_from,
        "effective_to": row.effective_to,
        "created_by_user_id": row.created_by_user_id,
        "created_at": row.created_at,
        "updated_by_user_id": row.updated_by_user_id,
        "updated_at": row.updated_at,
        "end_reason": row.end_reason,
    }


def list_crew_schedules(db: Session, *, crew_id: int) -> list[WorkCrewSchedule]:
    """Return a deterministic, route-paginated schedule collection."""

    return list(
        db.scalars(
            select(WorkCrewSchedule)
            .where(WorkCrewSchedule.crew_id == crew_id)
            .order_by(WorkCrewSchedule.effective_from, WorkCrewSchedule.version)
        )
    )


def list_crew_memberships(db: Session, *, crew_id: int) -> list[WorkCrewMembership]:
    """Return a deterministic, route-paginated crew membership collection."""

    return list(
        db.scalars(
            select(WorkCrewMembership)
            .where(WorkCrewMembership.crew_id == crew_id)
            .order_by(WorkCrewMembership.effective_from, WorkCrewMembership.id)
        )
    )


def _as_utc_naive(value: datetime) -> datetime:
    return value.replace(tzinfo=None) if value.tzinfo is None else value.astimezone(UTC).replace(tzinfo=None)


def _as_utc_aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _preview_conflict(
    code: str, message: str, *, schedule_id: int | None = None
) -> dict[str, Any]:
    return {"code": code, "message": message, "schedule_id": schedule_id}


def preview_crew_schedule(
    db: Session,
    *,
    crew_id: int,
    pattern_id: int,
    anchor_at: datetime,
    effective_from: datetime,
    effective_to: datetime | None,
    preview_ends_at: datetime,
    replaces_schedule_id: int | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Compute a bounded anchor preview without writing schedules or occurrences."""

    anchor = _as_utc_naive(anchor_at)
    starts = _as_utc_naive(effective_from)
    ends = _as_utc_naive(effective_to) if effective_to is not None else None
    horizon = _as_utc_naive(preview_ends_at)
    conflicts: list[dict[str, Any]] = []
    current_time = _as_utc_naive(now) if now is not None else datetime.now(UTC).replace(tzinfo=None)
    if starts <= current_time:
        conflicts.append(
            _preview_conflict(
                "WORKFORCE_SCHEDULE_PAST_MUTATION",
                "Schedule changes must begin at a future shift boundary.",
            )
        )
    if ends is not None and ends <= starts:
        conflicts.append(
            _preview_conflict(
                "WORKFORCE_SCHEDULE_WINDOW_INVALID",
                "Schedule effective windows are half-open and non-empty.",
            )
        )

    pattern = db.get(WorkRotationPattern, pattern_id)
    if pattern is None:
        conflicts.append(
            _preview_conflict(
                "WORKFORCE_ROTATION_NOT_FOUND",
                "The selected rotation pattern does not exist.",
            )
        )
        return {"crew_id": crew_id, "occurrences": [], "conflicts": conflicts}

    local_start = _as_utc_aware(starts).astimezone(ZoneInfo(pattern.timezone))
    if (
        local_start.hour not in {4, 12, 20}
        or local_start.minute != 0
        or local_start.second != 0
        or local_start.microsecond != 0
    ):
        conflicts.append(
            _preview_conflict(
                "WORKFORCE_SCHEDULE_BOUNDARY_INVALID",
                "Schedule changes must begin at a canonical shift boundary.",
            )
        )

    steps = list(
        db.execute(
            select(WorkRotationStep, WorkShiftDefinition)
            .join(
                WorkShiftDefinition,
                WorkShiftDefinition.id == WorkRotationStep.shift_definition_id,
            )
            .where(WorkRotationStep.pattern_id == pattern.id)
            .order_by(WorkRotationStep.start_offset_minutes, WorkRotationStep.id)
        ).all()
    )
    zero_steps = [(step, definition) for step, definition in steps if step.start_offset_minutes == 0]
    if len(zero_steps) != 1:
        conflicts.append(
            _preview_conflict(
                "WORKFORCE_ROTATION_INVALID",
                "Rotation pattern must have exactly one offset-zero shift.",
            )
        )
    elif _as_utc_aware(anchor).astimezone(ZoneInfo(pattern.timezone)).time().replace(tzinfo=None) != zero_steps[0][1].start_local_time:
        conflicts.append(
            _preview_conflict(
                "WORKFORCE_SCHEDULE_ANCHOR_INVALID",
                "Schedule anchor must begin the offset-zero shift.",
            )
        )

    schedules = list_crew_schedules(db, crew_id=crew_id)
    replacement = next(
        (schedule for schedule in schedules if schedule.id == replaces_schedule_id), None
    )
    if replaces_schedule_id is not None and replacement is None:
        conflicts.append(
            _preview_conflict(
                "WORKFORCE_SCHEDULE_NOT_FOUND",
                "The schedule selected for replacement does not belong to this crew.",
                schedule_id=replaces_schedule_id,
            )
        )

    for schedule in schedules:
        if schedule.id == replaces_schedule_id:
            if starts <= schedule.effective_from or (
                schedule.effective_to is not None and starts >= schedule.effective_to
            ):
                conflicts.append(
                    _preview_conflict(
                        "WORKFORCE_SCHEDULE_REPLACEMENT_INVALID",
                        "A replacement must begin inside and after the selected schedule window.",
                        schedule_id=schedule.id,
                    )
                )
            continue
        if (schedule.effective_to is None or starts < schedule.effective_to) and (
            ends is None or schedule.effective_from < ends
        ):
            conflicts.append(
                _preview_conflict(
                    "WORKFORCE_SCHEDULE_OVERLAP",
                    "Schedule effective windows may not overlap.",
                    schedule_id=schedule.id,
                )
            )

    if not steps or any(step.start_offset_minutes >= pattern.cycle_minutes for step, _ in steps):
        conflicts.append(
            _preview_conflict(
                "WORKFORCE_ROTATION_INVALID",
                "Rotation steps must be present and lie inside the cycle.",
            )
        )
    if conflicts:
        return {"crew_id": crew_id, "occurrences": [], "conflicts": conflicts}

    cycle = timedelta(minutes=pattern.cycle_minutes)
    occurrences: list[dict[str, Any]] = []
    for step, definition in steps:
        offset = timedelta(minutes=step.start_offset_minutes)
        first_cycle = floor((starts - anchor - offset).total_seconds() / cycle.total_seconds())
        for cycle_index in range(max(0, first_cycle), 10_000):
            occurrence_start = anchor + cycle * cycle_index + offset
            if occurrence_start >= horizon:
                break
            if occurrence_start < starts:
                continue
            if ends is not None and occurrence_start >= ends:
                break
            occurrence_end = occurrence_start + timedelta(minutes=definition.duration_minutes)
            local_occurrence_start = _as_utc_aware(occurrence_start).astimezone(
                ZoneInfo(pattern.timezone)
            )
            occurrences.append(
                {
                    "crew_id": crew_id,
                    "shift_definition_id": definition.id,
                    "shift_code": definition.code,
                    "starts_at": occurrence_start,
                    "ends_at": occurrence_end,
                    "operational_date": local_occurrence_start.date(),
                }
            )
    occurrences.sort(key=lambda occurrence: (occurrence["starts_at"], occurrence["shift_definition_id"]))
    return {"crew_id": crew_id, "occurrences": occurrences, "conflicts": []}


def list_provider_people(db: Session, *, mapping_state: str | None = None) -> list[AttendanceProviderPerson]:
    query = select(AttendanceProviderPerson).order_by(AttendanceProviderPerson.id)
    if mapping_state is not None:
        query = query.where(AttendanceProviderPerson.mapping_state == mapping_state)
    return list(db.scalars(query))


def list_failed_queue(db: Session) -> list[AttendanceEvaluationQueue]:
    return list(
        db.scalars(
            select(AttendanceEvaluationQueue)
            .where(AttendanceEvaluationQueue.failed_at.is_not(None))
            .order_by(AttendanceEvaluationQueue.failed_at, AttendanceEvaluationQueue.id)
        )
    )


def integration_status(db: Session) -> dict[str, Any]:
    rows = list(db.scalars(select(AttendanceSyncState)))
    streams = {
        row.stream: {
            "state": "error" if row.last_error_code else "healthy" if row.last_success_at else "pending",
            "fresh_through": row.fresh_through,
            "last_success_at": row.last_success_at,
            "last_error_code": row.last_error_code,
        }
        for row in rows
    }
    streams.setdefault("people", {"state": "not_configured", "fresh_through": None, "last_success_at": None, "last_error_code": None})
    streams.setdefault("punches", {"state": "not_configured", "fresh_through": None, "last_success_at": None, "last_error_code": None})
    # These were pinned to "off" while no adapter existed. The installed BioTime
    # adapter now resolves from the environment, so the dashboard must report
    # what is actually configured rather than a constant that hides a working
    # integration behind a "not configured" banner.
    from app.services import scheduler_service, settings_service

    try:
        configuration = settings_service.get_workforce_configuration(db)
    except ValueError:
        configuration = None
    provider = scheduler_service._resolve_verified_attendance_provider()
    enabled = bool(configuration and configuration.integration_enabled)
    if provider is None:
        provider_state = "not_configured"
    else:
        # A resolvable adapter that the operator has switched off is "disabled",
        # which is a different fact from having no adapter at all.
        provider_state = "ready" if enabled else "disabled"
    return {
        "enabled": enabled,
        "provider_state": provider_state,
        "streams": streams,
        "sync_running": False,
    }


__all__ = [
    "crew_membership_read",
    "crew_schedule_read",
    "get_attendance_case",
    "integration_status",
    "list_crew_memberships",
    "list_crew_schedules",
    "list_duty_assignment_events",
    "list_exceptions",
    "list_failed_queue",
    "list_provider_people",
    "list_roster",
    "preview_crew_schedule",
    "rotation_read",
    "shift_definition_read",
]
