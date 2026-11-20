"""Scoped person-level workforce reads and non-secret integration projections."""

from __future__ import annotations

import json
from bisect import bisect_left, bisect_right
from collections import defaultdict
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from math import floor
from typing import Any, NamedTuple, cast
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, Select, and_, null, or_, select
from sqlalchemy.orm import Session, aliased

from app.api.errors import NotFoundError, ValidationFailedError
from app.core import leave_lifecycle
from app.core.attendance_verdict import JudgedRow
from app.db.models import AuditLog, Employee, Leave
from app.db.workforce_models import (
    AttendanceAdjustment,
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationLeaveSource,
    AttendanceEvaluationPunchSource,
    AttendanceEvaluationQueue,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendancePunchAssignment,
    AttendancePunchProfile,
    AttendanceSyncState,
    DutyAssignmentEvent,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkRotationStep,
    WorkShiftDefinition,
    WorkShiftOccurrence,
    WorkShiftOverride,
    WorkStaffingRequirement,
)
from app.services import (
    attendance_correction_service,
    attendance_profile_service,
    workforce_admin_service,
    workforce_leave,
    workforce_schedule_service,
)
from app.services.workforce_access_service import (
    allows_hierarchy,
    employee_in_scope,
    require_organization,
)
from app.services.workforce_etag import etag_for, row_etag
from app.services.workforce_scope_service import WorkforceScope, scope_allows


class _RegisterCase(NamedTuple):
    """Only the columns the effective register projection reads."""

    id: int
    employee_id: str
    operational_date: date
    scheduled_start_at: datetime
    scheduled_end_at: datetime
    shift_occurrence_id: int | None
    shift_code_snapshot: str
    department_snapshot: str | None
    duty_unit_snapshot: str | None
    duty_post_snapshot: str | None
    evaluation_id: int | None
    presence_state: str | None
    reason_code: str | None
    crew_code_snapshot: str | None = None
    first_in_at: datetime | None = None
    final_out_at: datetime | None = None
    primary_leave_type: str | None = None


type EffectiveAttendanceRow = tuple[_RegisterCase, JudgedRow, dict[str, Any] | None]
type _CaseWindow = AttendanceCase | _RegisterCase


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


def _case_leave_fields(
    db: Session,
    *,
    evaluations: dict[int, AttendanceEvaluation],
    effective: dict[int, dict[str, Any] | None],
) -> dict[int, tuple[leave_lifecycle.LeaveKind | None, str | None]]:
    """Read primary leave labels in one query, classified by the effective reason.

    A replacement reason cannot borrow the automatic verdict's primary label
    unless it retains that verdict's winning leave kind.
    """
    if not evaluations:
        return {}
    labels = {
        evaluation_id: leave_lifecycle.leave_label(leave_type)
        for evaluation_id, leave_type in db.execute(
            select(AttendanceEvaluationLeaveSource.evaluation_id, Leave.leave_type)
            .join(Leave, Leave.id == AttendanceEvaluationLeaveSource.leave_id)
            .where(
                AttendanceEvaluationLeaveSource.evaluation_id.in_(
                    [evaluation.id for evaluation in evaluations.values()]
                ),
                AttendanceEvaluationLeaveSource.is_primary.is_(True),
            )
        )
    }
    result: dict[int, tuple[leave_lifecycle.LeaveKind | None, str | None]] = {}
    for case_id, evaluation in evaluations.items():
        values = effective.get(case_id)
        reason = values["reason_code"] if values else None
        kind = workforce_leave.LEAVE_KIND_BY_REASON.get(reason) if reason else None
        label = labels.get(evaluation.id) if kind and reason == evaluation.reason_code else None
        result[case_id] = kind, label
    return result


def _case_allowed(case: _CaseWindow, scope: WorkforceScope) -> bool:
    return scope_allows(
        scope,
        employee_id=case.employee_id,
        department=case.department_snapshot,
        duty_unit=case.duty_unit_snapshot,
        duty_post=case.duty_post_snapshot,
    )


def _employee_row(db: Session, employee_id: str) -> Employee | None:
    return db.get(Employee, employee_id)


def _employees_for_cases(db: Session, cases: Sequence[_CaseWindow]) -> dict[str, Employee]:
    employee_ids = {case.employee_id for case in cases}
    if not employee_ids:
        return {}
    return {
        employee.id: employee
        for employee in db.scalars(select(Employee).where(Employee.id.in_(employee_ids)))
    }


def _person_fields(case: _CaseWindow, employees: dict[str, Employee]) -> dict[str, Any]:
    employee = employees.get(case.employee_id)
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


def list_roster(
    db: Session, *, scope: WorkforceScope, operational_date: date
) -> list[dict[str, Any]]:
    cases = [
        case
        for case in db.scalars(
            select(AttendanceCase).where(AttendanceCase.operational_date == operational_date)
        )
        if _case_allowed(case, scope)
    ]
    latest = _latest_evaluations(db, [case.id for case in cases])
    adjustments = attendance_correction_service.active_corrections(db, [case.id for case in cases])
    employees = _employees_for_cases(db, cases)
    result: list[dict[str, Any]] = []
    for case in cases:
        effective = _effective_evaluation_values(latest.get(case.id), adjustments.get(case.id))
        result.append(
            {
                **_person_fields(case, employees),
                "presence_state": effective["presence_state"] if effective else None,
                "reason_code": effective["reason_code"] if effective else None,
            }
        )
    return sorted(result, key=lambda row: (row["scheduled_start_at"], row["employee_id"]))


def list_exceptions(
    db: Session,
    *,
    scope: WorkforceScope,
    operational_date: date | None = None,
    presence: str | None = None,
    exception: str | None = None,
) -> list[dict[str, Any]]:
    query = select(AttendanceCase)
    if operational_date is not None:
        query = query.where(AttendanceCase.operational_date == operational_date)
    cases = [case for case in db.scalars(query) if _case_allowed(case, scope)]
    latest = _latest_evaluations(db, [case.id for case in cases])
    adjustments = attendance_correction_service.active_corrections(db, [case.id for case in cases])
    employees = _employees_for_cases(db, cases)
    result: list[dict[str, Any]] = []
    for case in cases:
        effective = _effective_evaluation_values(latest.get(case.id), adjustments.get(case.id))
        if effective is None:
            continue
        if presence and effective["presence_state"] != presence:
            continue
        has_exception = bool(
            (effective["late_minutes"] or 0) > 0
            or (effective["early_exit_minutes"] or 0) > 0
            or effective["missing_checkout"]
            or effective["presence_state"] in {"absent", "unknown"}
        )
        if exception and not has_exception:
            continue
        if not has_exception:
            continue
        result.append(
            {
                **_person_fields(case, employees),
                "case_id": case.id,
                "presence_state": effective["presence_state"],
                "reason_code": effective["reason_code"],
                "late_minutes": effective["late_minutes"],
                "early_exit_minutes": effective["early_exit_minutes"],
                "missing_checkout": effective["missing_checkout"],
            }
        )

    def severity(row: dict[str, Any]) -> tuple[int, str, int]:
        if row.get("presence_state") == "absent":
            return (0, row["employee_id"], row["case_id"])
        if row.get("missing_checkout"):
            return (1, row["employee_id"], row["case_id"])
        if (row.get("late_minutes") or 0) > 0:
            return (2, row["employee_id"], row["case_id"])
        if (row.get("early_exit_minutes") or 0) > 0:
            return (3, row["employee_id"], row["case_id"])
        if row.get("presence_state") == "unknown":
            return (4, row["employee_id"], row["case_id"])
        return (5, row["employee_id"], row["case_id"])

    return sorted(result, key=severity)


def _verified_people_query(employee_ids: set[str]) -> Select[AttendanceProviderPerson]:
    return select(AttendanceProviderPerson).where(
        AttendanceProviderPerson.employee_id.in_(employee_ids),
        AttendanceProviderPerson.mapping_state == "verified",
        AttendanceProviderPerson.active.is_(True),
    )


def _verified_people(db: Session, employee_ids: set[str]) -> dict[str, AttendanceProviderPerson]:
    """The active verified provider person per employee.

    One query for a whole page. The partial unique index
    ``uq_attendance_provider_people_verified_active_employee`` guarantees at most
    one such row per employee, so a dict is a faithful projection.
    """
    if not employee_ids:
        return {}
    rows = db.scalars(_verified_people_query(employee_ids))
    return {row.employee_id: row for row in rows if row.employee_id is not None}


def _occurrence_shift_ids(db: Session, cases: Sequence[_CaseWindow]) -> dict[int, int]:
    occurrences = {
        case.shift_occurrence_id for case in cases if case.shift_occurrence_id is not None
    }
    if not occurrences:
        return {}
    return dict(
        db.execute(
            select(WorkShiftOccurrence.id, WorkShiftOccurrence.shift_definition_id).where(
                WorkShiftOccurrence.id.in_(occurrences)
            )
        )
        .tuples()
        .all()
    )


def _policy_candidates(
    db: Session,
    *,
    earliest: date,
    latest: date,
    shift_ids: set[int],
) -> list[WorkAttendancePolicy]:
    shift_filter: ColumnElement[bool] = WorkAttendancePolicy.shift_definition_id.is_(None)
    if shift_ids:
        shift_filter = or_(shift_filter, WorkAttendancePolicy.shift_definition_id.in_(shift_ids))
    return list(
        db.scalars(
            select(WorkAttendancePolicy)
            .where(
                WorkAttendancePolicy.approved_at.is_not(None),
                WorkAttendancePolicy.effective_from <= latest,
                or_(
                    WorkAttendancePolicy.effective_to.is_(None),
                    WorkAttendancePolicy.effective_to > earliest,
                ),
                shift_filter,
            )
            .order_by(
                WorkAttendancePolicy.shift_definition_id.is_not(None).desc(),
                WorkAttendancePolicy.effective_from.desc(),
                WorkAttendancePolicy.id.desc(),
            )
        )
    )


def _policy_on(
    policies: Sequence[WorkAttendancePolicy], day: date, shift_id: int | None
) -> WorkAttendancePolicy | None:
    return next(
        (
            policy
            for policy in policies
            if policy.effective_from <= day
            and (policy.effective_to is None or day < policy.effective_to)
            and (policy.shift_definition_id is None or policy.shift_definition_id == shift_id)
        ),
        None,
    )


def _policies_for_cases(
    db: Session, cases: Sequence[_CaseWindow]
) -> dict[int, WorkAttendancePolicy | None]:
    if not cases:
        return {}
    shift_ids = _occurrence_shift_ids(db, cases)
    policies = _policy_candidates(
        db,
        earliest=min(case.operational_date for case in cases),
        latest=max(case.operational_date for case in cases),
        shift_ids=set(shift_ids.values()),
    )
    return {
        case.id: _policy_on(
            policies,
            case.operational_date,
            shift_ids.get(case.shift_occurrence_id)
            if case.shift_occurrence_id is not None
            else None,
        )
        for case in cases
    }


def _profiles_for_cases(
    db: Session, cases: Sequence[_CaseWindow]
) -> dict[tuple[str, str], AttendancePunchProfile]:
    keys = {
        (case.employee_id, case.shift_code_snapshot) for case in cases if case.shift_code_snapshot
    }
    if not keys:
        return {}
    employee_ids = {employee_id for employee_id, _shift_code in keys}
    shift_codes = {shift_code for _employee_id, shift_code in keys}
    return {
        (profile.employee_id, profile.shift_code): profile
        for profile in db.scalars(
            select(AttendancePunchProfile).where(
                AttendancePunchProfile.employee_id.in_(employee_ids),
                AttendancePunchProfile.shift_code.in_(shift_codes),
                AttendancePunchProfile.sample_days >= attendance_profile_service.MIN_SAMPLE_DAYS,
            )
        )
        if (profile.employee_id, profile.shift_code) in keys
    }


def _previous_case_ends(db: Session, cases: Sequence[_CaseWindow]) -> dict[int, datetime]:
    if not cases:
        return {}
    # An earlier end cannot constrain the evaluator's arrival floor. Read only
    # ends that could matter, including adjacent duties outside the requested scope.
    floor = min(case.scheduled_start_at for case in cases) - timedelta(
        minutes=attendance_profile_service.MAX_WIDEN_MINUTES
    )
    ceiling = max(case.scheduled_start_at for case in cases)
    ends_by_employee: dict[str, list[datetime]] = {}
    for employee_id, end in db.connection().execute(
        select(AttendanceCase.employee_id, AttendanceCase.scheduled_end_at)
        .where(
            AttendanceCase.employee_id.in_({case.employee_id for case in cases}),
            AttendanceCase.scheduled_start_at < ceiling,
            AttendanceCase.scheduled_end_at.between(floor, ceiling),
        )
        .order_by(AttendanceCase.employee_id, AttendanceCase.scheduled_end_at)
    ):
        ends_by_employee.setdefault(employee_id, []).append(end)
    result: dict[int, datetime] = {}
    for case in cases:
        ends = ends_by_employee.get(case.employee_id)
        if ends and (index := bisect_right(ends, case.scheduled_start_at)) > 0:
            result[case.id] = ends[index - 1]
    return result


def _punch_window(
    case: _CaseWindow,
    policy: WorkAttendancePolicy,
    *,
    profile: AttendancePunchProfile | None,
    previous_case_end: datetime | None,
) -> tuple[datetime, datetime]:
    """The evaluator's evidence window using already-prefetched habit data."""
    return attendance_profile_service._evidence_window(
        # The evaluator only needs the two scheduled instants on this projection.
        case=cast(AttendanceCase, case),
        policy=policy,
        profile=profile,
        previous_case_end=previous_case_end,
    )


def _punch_windows(
    db: Session,
    *,
    cases: Sequence[_CaseWindow],
    people: dict[str, AttendanceProviderPerson],
    policies: dict[int, WorkAttendancePolicy | None],
    profiles: dict[tuple[str, str], AttendancePunchProfile] | None = None,
) -> dict[int, tuple[datetime, datetime]]:
    eligible: list[tuple[_CaseWindow, WorkAttendancePolicy]] = []
    for case in cases:
        policy = policies.get(case.id)
        if people.get(case.employee_id) is not None and policy is not None:
            eligible.append((case, policy))
    if profiles is None:
        profiles = _profiles_for_cases(db, [case for case, _policy in eligible])
    profiled_cases = [
        case
        for case, _policy in eligible
        if profiles.get((case.employee_id, case.shift_code_snapshot)) is not None
    ]
    previous_case_ends = _previous_case_ends(db, profiled_cases)
    return {
        case.id: _punch_window(
            case,
            policy,
            profile=profiles.get((case.employee_id, case.shift_code_snapshot)),
            previous_case_end=previous_case_ends.get(case.id),
        )
        for case, policy in eligible
    }


def _punch_rows_for_cases(
    db: Session,
    *,
    cases: list[AttendanceCase],
    people: dict[str, AttendanceProviderPerson],
    windows: dict[int, tuple[datetime, datetime]],
) -> dict[int, list[tuple[AttendancePunch, int | None]]]:
    active_cases = [case for case in cases if case.id in windows and case.employee_id in people]
    if not active_cases:
        return {}
    provider_person_ids = {people[case.employee_id].id for case in active_cases}
    window_start = min(windows[case.id][0] for case in active_cases)
    window_end = max(windows[case.id][1] for case in active_cases)
    punches_by_person: dict[int, list[tuple[AttendancePunch, int | None]]] = {}
    punch_times_by_person: dict[int, list[datetime]] = {}
    for punch, assignment_case_id in db.execute(
        select(AttendancePunch, AttendancePunchAssignment.attendance_case_id)
        .outerjoin(
            AttendancePunchAssignment,
            AttendancePunchAssignment.punch_id == AttendancePunch.id,
        )
        .where(
            AttendancePunch.provider_person_id.in_(provider_person_ids),
            AttendancePunch.occurred_at >= window_start,
            AttendancePunch.occurred_at <= window_end,
        )
        .order_by(AttendancePunch.occurred_at, AttendancePunch.id)
    ):
        punches_by_person.setdefault(punch.provider_person_id, []).append(
            (punch, assignment_case_id)
        )
        punch_times_by_person.setdefault(punch.provider_person_id, []).append(punch.occurred_at)

    result: dict[int, list[tuple[AttendancePunch, int | None]]] = {}
    for case in active_cases:
        person_id = people[case.employee_id].id
        punches = punches_by_person.get(person_id, [])
        punch_times = punch_times_by_person.get(person_id, [])
        start, end = windows[case.id]
        result[case.id] = punches[bisect_left(punch_times, start) : bisect_right(punch_times, end)]
    return result


def _punch_bounds(
    case: AttendanceCase,
    rows: list[tuple[AttendancePunch, int | None]],
) -> tuple[datetime | None, datetime | None, int]:
    """First punch, last punch and count under the evaluator's assignment rule."""
    first_at: datetime | None = None
    last_at: datetime | None = None
    count = 0
    for punch, assignment_case_id in rows:
        if assignment_case_id is not None and assignment_case_id != case.id:
            continue
        if first_at is None:
            first_at = punch.occurred_at
        last_at = punch.occurred_at
        count += 1
    return (first_at, last_at, count)


def _judgment_due_at(case: _CaseWindow, policy: WorkAttendancePolicy | None) -> datetime | None:
    if policy is None:
        return None
    return case.scheduled_end_at + timedelta(minutes=policy.match_after_minutes)


def _absence_due_at(case: _CaseWindow, policy: WorkAttendancePolicy | None) -> datetime | None:
    if policy is None:
        return None
    return case.scheduled_start_at + timedelta(minutes=policy.absence_after_minutes)


def _late_minutes(case: _CaseWindow, first_punch_at: datetime | None) -> int | None:
    """Whole minutes between the scheduled start and the first punch.

    Grace is NOT applied here: the client needs the raw lateness so it can show
    both "inside grace" and "+17m past grace" from one number, and the grace
    value belongs to the policy, not to a read projection.
    """
    if first_punch_at is None:
        return None
    minutes = (first_punch_at - case.scheduled_start_at).total_seconds() // 60
    return int(minutes) if minutes > 0 else 0


def _sqlite_register_rows(db: Session, query: Select[*tuple[Any, ...]]) -> list[tuple[Any, ...]]:
    """Read a bulk column projection as SQLite tuples without wrapping each row.

    Keep SQLAlchemy's bound parameters and session transaction. The two callers
    below decode the date/time text explicitly; neither reads ORM entities.
    """
    with db.connection().execute(query) as result:
        cursor = result.cursor
        assert cursor is not None
        return cast(list[tuple[Any, ...]], cursor.fetchall())


def _compact_register_cases(
    db: Session, query: Select[*tuple[Any, ...]], *, grouped: bool
) -> list[_RegisterCase]:
    cases: list[_RegisterCase] = []
    slots: dict[tuple[str, str, str], tuple[date, datetime, datetime]] = {}
    by_slot: defaultdict[tuple[str, str, str], list[_RegisterCase]] | None = (
        defaultdict(list) if grouped else None
    )
    for (
        case_id,
        employee,
        day,
        begins,
        ends,
        occurrence,
        shift,
        department,
        unit,
        post,
        evaluation,
        state,
        reason,
    ) in _sqlite_register_rows(db, query):
        # Most people on a shift share the same exact captured times.
        key = day, begins, ends
        slot = slots.get(key)
        if slot is None:
            slot = slots[key] = (
                date.fromisoformat(day),
                datetime.fromisoformat(begins),
                datetime.fromisoformat(ends),
            )
        case = _RegisterCase(
            case_id,
            employee,
            *slot,
            occurrence,
            shift,
            department,
            unit,
            post,
            evaluation,
            state,
            reason,
        )
        if by_slot is not None:
            by_slot[key].append(case)
        else:
            cases.append(case)
    # Totals need chronological duties per employee, not a name/ID tie-break
    # across the entire roster. Sort the shift slots, not every case in SQLite.
    if by_slot is not None:
        for key in sorted(by_slot):
            cases.extend(by_slot[key])
    return cases


def _register_cases(
    db: Session,
    *,
    scope: WorkforceScope,
    from_date: date,
    to_date: date,
    shift_code: str | None,
    duty_unit: str | None,
    include_day_fields: bool,
    totals_only: bool = False,
    unassigned_only: bool = False,
) -> list[_RegisterCase]:
    unrestricted = (
        scope.is_organization
        and scope.requested_department is None
        and scope.requested_duty_unit is None
        and scope.requested_duty_post is None
    )
    # A totals-only request never displays this hierarchy. Keep the snapshots
    # when they are needed for scope enforcement or the Unassigned filter.
    omit_hierarchy = totals_only and unrestricted
    revision = aliased(AttendanceEvaluation)
    latest_id = (
        select(revision.id)
        .where(revision.attendance_case_id == AttendanceCase.id)
        .order_by(revision.revision.desc())
        .limit(1)
        .correlate(AttendanceCase)
        .scalar_subquery()
    )
    query = (
        select(
            AttendanceCase.id,
            AttendanceCase.employee_id,
            AttendanceCase.operational_date,
            AttendanceCase.scheduled_start_at,
            AttendanceCase.scheduled_end_at,
            AttendanceCase.shift_occurrence_id,
            AttendanceCase.shift_code_snapshot,
            null() if omit_hierarchy else AttendanceCase.department_snapshot,
            null() if omit_hierarchy and not unassigned_only else AttendanceCase.duty_unit_snapshot,
            null() if omit_hierarchy else AttendanceCase.duty_post_snapshot,
            AttendanceEvaluation.id,
            AttendanceEvaluation.presence_state,
            AttendanceEvaluation.reason_code,
        )
        .select_from(AttendanceCase)
        .outerjoin(AttendanceEvaluation, AttendanceEvaluation.id == latest_id)
        .where(AttendanceCase.operational_date.between(from_date, to_date))
        .order_by(AttendanceCase.operational_date)
    )
    if not totals_only:
        query = query.order_by(
            AttendanceCase.scheduled_start_at,
            AttendanceCase.employee_id,
            AttendanceCase.id,
        )
    if shift_code is not None:
        query = query.where(AttendanceCase.shift_code_snapshot == shift_code)
    if duty_unit is not None:
        query = query.where(AttendanceCase.duty_unit_snapshot == duty_unit)
    if include_day_fields:
        query = (
            query.add_columns(
                AttendanceCase.crew_code_snapshot,
                AttendanceEvaluation.first_in_at,
                AttendanceEvaluation.final_out_at,
                Leave.leave_type,
            )
            .outerjoin(
                AttendanceEvaluationLeaveSource,
                and_(
                    AttendanceEvaluationLeaveSource.evaluation_id == AttendanceEvaluation.id,
                    AttendanceEvaluationLeaveSource.is_primary.is_(True),
                ),
            )
            .outerjoin(Leave, Leave.id == AttendanceEvaluationLeaveSource.leave_id)
        )
    cases = (
        [_RegisterCase._make(row) for row in db.connection().execute(query).all()]
        if include_day_fields
        else _compact_register_cases(db, query, grouped=totals_only)
    )
    if unassigned_only:
        cases = [case for case in cases if not (case.duty_unit_snapshot or "").strip()]
    if unrestricted:
        # Organization scope allows any captured hierarchy, but not a blank ID.
        return [case for case in cases if case.employee_id.strip()]
    allowed: dict[tuple[str, str | None, str | None, str | None], bool] = {}
    visible_cases: list[_RegisterCase] = []
    for case in cases:
        key = (
            case.employee_id,
            case.department_snapshot,
            case.duty_unit_snapshot,
            case.duty_post_snapshot,
        )
        visible = allowed.get(key)
        if visible is None:
            visible = allowed[key] = _case_allowed(case, scope)
        if visible:
            visible_cases.append(case)
    return visible_cases


def _register_punch_evidence(
    db: Session,
    person_ids: set[int],
    start: datetime,
    end: datetime,
) -> dict[int, tuple[list[datetime], dict[int, int]]]:
    evidence: dict[int, tuple[list[datetime], dict[int, int]]] = {}
    last_person_id = None
    times: list[datetime] = []
    assignments: dict[int, int] = {}
    timestamps: dict[str, datetime] = {}
    for person_id, occurred_at, assigned_case in _sqlite_register_rows(
        db,
        select(
            AttendancePunch.provider_person_id,
            AttendancePunch.occurred_at,
            AttendancePunchAssignment.attendance_case_id,
        )
        .outerjoin(
            AttendancePunchAssignment, AttendancePunchAssignment.punch_id == AttendancePunch.id
        )
        .where(
            AttendancePunch.provider_person_id.in_(person_ids),
            AttendancePunch.occurred_at.between(start, end),
        )
        .order_by(AttendancePunch.provider_person_id, AttendancePunch.occurred_at),
    ):
        if last_person_id != person_id:
            last_person_id = person_id
            times, assignments = [], {}
            evidence[person_id] = times, assignments
        if assigned_case is not None:
            assignments[len(times)] = assigned_case
        stamp = timestamps.get(occurred_at)
        if stamp is None:
            stamp = timestamps[occurred_at] = datetime.fromisoformat(occurred_at)
        times.append(stamp)
    return evidence


def _register_punch_bounds(
    case_id: int,
    evidence: tuple[list[datetime], dict[int, int]],
    window: tuple[datetime, datetime],
) -> tuple[datetime | None, datetime | None, int]:
    times, assignments = evidence
    lo = bisect_left(times, window[0])
    hi = bisect_right(times, window[1], lo)
    if lo == hi:
        return None, None, 0
    if not assignments:
        return times[lo], times[hi - 1], hi - lo
    first = last = None
    count = 0
    for index in range(lo, hi):
        assigned_case = assignments.get(index)
        if assigned_case is None or assigned_case == case_id:
            last = times[index]
            if count == 0:
                first = last
            count += 1
    return first, last, count


@dataclass(slots=True)
class _RegisterTiming:
    policy: WorkAttendancePolicy | None
    window: tuple[datetime, datetime] | None
    absence_due: datetime | None
    judgment_due: datetime | None
    grace: int | None
    judgments: dict[tuple[str | None, int, int | None, str | None], JudgedRow] = field(
        default_factory=dict
    )


def _register_timings(
    db: Session, cases: list[_RegisterCase], start: date, end: date
) -> tuple[list[_RegisterTiming], list[tuple[datetime, datetime]]]:
    shift_ids = _occurrence_shift_ids(db, cases)
    policies = _policy_candidates(db, earliest=start, latest=end, shift_ids=set(shift_ids.values()))
    by_slot: dict[tuple[int | None, date, datetime, datetime], _RegisterTiming] = {}
    by_case: list[_RegisterTiming] = []
    windows: list[tuple[datetime, datetime]] = []
    for case in cases:
        slot = (
            case.shift_occurrence_id,
            case.operational_date,
            case.scheduled_start_at,
            case.scheduled_end_at,
        )
        timing = by_slot.get(slot)
        if timing is None:
            shift_id = (
                shift_ids.get(case.shift_occurrence_id)
                if case.shift_occurrence_id is not None
                else None
            )
            policy = _policy_on(policies, case.operational_date, shift_id)
            window = (
                _punch_window(case, policy, profile=None, previous_case_end=None)
                if policy is not None
                else None
            )
            if window is not None:
                windows.append(window)
            timing = by_slot[slot] = _RegisterTiming(
                policy,
                window,
                _absence_due_at(case, policy),
                _judgment_due_at(case, policy),
                policy.grace_minutes if policy is not None else None,
            )
        by_case.append(timing)
    return by_case, windows


def _range_corrections(db: Session, start: date, end: date) -> dict[int, AttendanceAdjustment]:
    # Drive the lookup from the sparse correction table, not a bound variable
    # per scheduled duty. Leaf selection is still the correction service's rule.
    case_day = (
        select(AttendanceCase.operational_date)
        .where(AttendanceCase.id == AttendanceAdjustment.attendance_case_id)
        .scalar_subquery()
    )
    by_case: dict[int, list[AttendanceAdjustment]] = {}
    for adjustment in db.scalars(
        select(AttendanceAdjustment)
        .where(AttendanceAdjustment.revoked_at.is_(None), case_day.between(start, end))
        .order_by(
            AttendanceAdjustment.attendance_case_id,
            AttendanceAdjustment.created_at,
            AttendanceAdjustment.id,
        )
    ):
        by_case.setdefault(adjustment.attendance_case_id, []).append(adjustment)
    return {
        case_id: active
        for case_id, corrections in by_case.items()
        if (active := attendance_correction_service.active_correction(corrections)) is not None
    }


def _project_register(
    db: Session,
    cases: list[_RegisterCase],
    *,
    start: date,
    end: date,
    include_day_fields: bool,
) -> Iterator[EffectiveAttendanceRow]:
    if not cases:
        return
    adjustments = _range_corrections(db, start, end)
    people = {
        employee_id: person_id
        for employee_id, person_id in db.connection()
        .execute(
            _verified_people_query({case.employee_id for case in cases}).with_only_columns(
                AttendanceProviderPerson.employee_id, AttendanceProviderPerson.id
            )
        )
        .all()
    }
    timings, windows = _register_timings(db, cases, start, end)
    profiles = _profiles_for_cases(db, cases) if people and windows else {}
    widened: dict[int, tuple[datetime, datetime]] = {}
    if profiles:
        profiled = [
            (case, timing.policy, profile)
            for case, timing in zip(cases, timings, strict=True)
            if timing.policy is not None
            and case.employee_id in people
            and (profile := profiles.get((case.employee_id, case.shift_code_snapshot))) is not None
        ]
        prior_ends = _previous_case_ends(db, [case for case, _, _ in profiled])
        widened = {
            case.id: _punch_window(
                case, policy, profile=profile, previous_case_end=prior_ends.get(case.id)
            )
            for case, policy, profile in profiled
        }
        windows.extend(widened.values())
    if people and windows:
        by_provider = _register_punch_evidence(
            db,
            set(people.values()),
            min(first for first, _ in windows),
            max(last for _, last in windows),
        )
        evidence = {
            employee_id: timeline
            for employee_id, person_id in people.items()
            if (timeline := by_provider.get(person_id)) is not None
        }
    else:
        evidence = {}

    for case, timing in zip(cases, timings, strict=True):
        adjustment = adjustments.get(case.id)
        status, first_in, final_out = case.presence_state, case.first_in_at, case.final_out_at
        reason = case.reason_code
        window = widened.get(case.id, timing.window) if widened else timing.window
        first_at = last_at = None
        count = 0
        if window is not None and (punches := evidence.get(case.employee_id)) is not None:
            first_at, last_at, count = _register_punch_bounds(case.id, punches, window)

        if adjustment is None or case.evaluation_id is None:
            late = _late_minutes(case, first_at)
        else:
            effective = attendance_correction_service.overlay(
                {
                    "presence_state": status,
                    "first_in_at": first_in,
                    "final_out_at": final_out,
                    "reason_code": reason,
                },
                adjustment,
            )
            status, first_in, final_out, reason, late = (
                effective["presence_state"],
                effective["first_in_at"],
                effective["final_out_at"],
                effective["reason_code"],
                effective["late_minutes"],
            )

        kind = workforce_leave.LEAVE_KIND_BY_REASON.get(reason) if reason else None
        key = status, count, late, kind
        judgment = timing.judgments.get(key)
        if judgment is None:
            judgment = timing.judgments[key] = JudgedRow(
                status,
                count,
                late,
                timing.grace,
                timing.absence_due,
                timing.judgment_due,
                status == "excused_leave",
                kind,
            )

        day_fields = None
        if include_day_fields:
            day_fields = {
                "case_id": case.id,
                "presence_state": status,
                "reason_code": reason,
                "final_out_at": final_out,
                "leave_kind": kind,
                "leave_label": (
                    leave_lifecycle.leave_label(case.primary_leave_type)
                    if kind and reason == case.reason_code and case.primary_leave_type is not None
                    else None
                ),
                "first_in_at": first_in,
                "corrected": adjustment is not None,
                "first_punch_at": first_at,
                "last_punch_at": last_at,
                "punch_count": count,
                "late_minutes": late,
                "on_leave": judgment.on_leave,
                "judgment_due_at": timing.judgment_due,
                "grace_minutes": timing.grace,
                "absence_due_at": timing.absence_due,
            }
        yield case, judgment, day_fields


def iter_effective_attendance_rows(
    db: Session,
    *,
    scope: WorkforceScope,
    from_date: date,
    to_date: date,
    shift_code: str | None = None,
    duty_unit: str | None = None,
    include_day_fields: bool = False,
) -> Iterator[EffectiveAttendanceRow]:
    """Scoped register facts in date and shift order, with optional exact snapshot filters."""
    return _iter_register_rows(
        db,
        scope=scope,
        from_date=from_date,
        to_date=to_date,
        shift_code=shift_code,
        duty_unit=duty_unit,
        include_day_fields=include_day_fields,
    )


def iter_effective_attendance_totals_rows(
    db: Session,
    *,
    scope: WorkforceScope,
    from_date: date,
    to_date: date,
    duty_unit: str | None = None,
    unassigned_only: bool = False,
) -> Iterator[tuple[str, JudgedRow]]:
    """The same judgment inputs, in duty order per person, without display fields."""
    for case, judgment, _ in _iter_register_rows(
        db,
        scope=scope,
        from_date=from_date,
        to_date=to_date,
        duty_unit=duty_unit,
        totals_only=True,
        unassigned_only=unassigned_only,
    ):
        yield case.employee_id, judgment


def _iter_register_rows(
    db: Session,
    *,
    scope: WorkforceScope,
    from_date: date,
    to_date: date,
    shift_code: str | None = None,
    duty_unit: str | None = None,
    include_day_fields: bool = False,
    totals_only: bool = False,
    unassigned_only: bool = False,
) -> Iterator[EffectiveAttendanceRow]:
    start = from_date
    while start <= to_date:
        # Bound memory and the punch time span, even for a year-over-year read.
        end = start + timedelta(days=min(27, (to_date - start).days))
        cases = _register_cases(
            db,
            scope=scope,
            from_date=start,
            to_date=end,
            shift_code=shift_code,
            duty_unit=duty_unit,
            include_day_fields=include_day_fields,
            totals_only=totals_only,
            unassigned_only=unassigned_only,
        )
        yield from _project_register(
            db, cases, start=start, end=end, include_day_fields=include_day_fields
        )
        if end == to_date:
            break
        start = end + timedelta(days=1)


def list_attendance_day(
    db: Session,
    *,
    scope: WorkforceScope,
    operational_date: date,
    shift_code: str | None = None,
) -> list[dict[str, Any]]:
    """Every scheduled person for one operational date, with their punch bounds."""
    rows = list(
        iter_effective_attendance_rows(
            db,
            scope=scope,
            from_date=operational_date,
            to_date=operational_date,
            shift_code=shift_code,
            include_day_fields=True,
        )
    )
    employees = _employees_for_cases(db, [case for case, _, _ in rows])
    result: list[dict[str, Any]] = []
    for case, _, day_fields in rows:
        assert day_fields is not None
        result.append({**_person_fields(case, employees), **day_fields})
    return result


def list_attendance_punches(
    db: Session,
    *,
    scope: WorkforceScope,
    operational_date: date,
    limit: int,
    before: tuple[datetime, int] | None = None,
) -> list[dict[str, Any]]:
    """Return newest-first punches from active, verified employee mappings.

    Assigned punches belong to their case's operational date, including a night
    shift's next-morning departure. Unassigned punches belong to their Dubai
    calendar date. Assigned rows use the same captured hierarchy and scope
    predicate as the day register; unassigned rows use the employee directory.
    """
    window_start = (
        datetime.combine(operational_date, time.min, tzinfo=ZoneInfo("Asia/Dubai"))
        .astimezone(UTC)
        .replace(tzinfo=None)
    )
    query = (
        select(AttendancePunch, Employee, AttendanceCase)
        .join(
            AttendanceProviderPerson,
            AttendanceProviderPerson.id == AttendancePunch.provider_person_id,
        )
        .join(Employee, Employee.id == AttendanceProviderPerson.employee_id)
        .outerjoin(
            AttendancePunchAssignment,
            AttendancePunchAssignment.punch_id == AttendancePunch.id,
        )
        .outerjoin(
            AttendanceCase,
            AttendanceCase.id == AttendancePunchAssignment.attendance_case_id,
        )
        .where(
            AttendanceProviderPerson.mapping_state == "verified",
            AttendanceProviderPerson.active.is_(True),
            or_(
                AttendanceCase.operational_date == operational_date,
                and_(
                    AttendancePunchAssignment.attendance_case_id.is_(None),
                    AttendancePunch.occurred_at >= window_start,
                    AttendancePunch.occurred_at < window_start + timedelta(days=1),
                ),
            ),
            or_(
                AttendancePunchAssignment.attendance_case_id.is_(None),
                AttendanceCase.employee_id == Employee.id,
            ),
        )
        .order_by(AttendancePunch.occurred_at.desc(), AttendancePunch.id.desc())
    )
    if before is not None:
        occurred_at, punch_id = before
        query = query.where(
            or_(
                AttendancePunch.occurred_at < occurred_at,
                and_(AttendancePunch.occurred_at == occurred_at, AttendancePunch.id < punch_id),
            )
        )
    result: list[dict[str, Any]] = []
    # Apply the shared scope predicate before counting rows toward the page.
    # Streaming keeps a narrow-scope request from loading the whole day's log.
    with db.execute(query).yield_per(200) as rows:
        for punch, employee, case in rows:
            if case is not None:
                if not _case_allowed(case, scope):
                    continue
            elif not scope_allows(
                scope,
                employee_id=employee.id,
                department=employee.department,
                duty_unit=employee.duty_unit,
                duty_post=employee.duty_post,
            ):
                continue
            result.append(
                {
                    "punch_id": punch.id,
                    "occurred_at": punch.occurred_at,
                    "employee_id": employee.id,
                    "name_en": employee.name_en,
                    "name_ar": employee.name_ar,
                    "department": case.department_snapshot
                    if case is not None
                    else employee.department,
                    "duty_post": case.duty_post_snapshot
                    if case is not None
                    else employee.duty_post,
                    "device": punch.device_name,
                    "direction": punch.direction,
                    "case_id": case.id if case is not None else None,
                }
            )
            if len(result) >= limit:
                break
    return result


#: One request may not span more than a quarter of attendance history.
MAX_ATTENDANCE_RANGE_DAYS = 92


def employee_attendance_range(
    db: Session,
    *,
    scope: WorkforceScope,
    employee_id: str,
    from_date: date,
    to_date: date,
) -> dict[str, Any]:
    """One employee's attendance days, each with its own punch list."""
    employee_in_scope(db, scope=scope, employee_id=employee_id)
    if to_date < from_date:
        raise ValidationFailedError(
            "ATTENDANCE_RANGE_INVALID", "The attendance window ends before it starts."
        )
    if (to_date - from_date).days + 1 > MAX_ATTENDANCE_RANGE_DAYS:
        raise ValidationFailedError(
            "ATTENDANCE_RANGE_TOO_WIDE",
            f"The attendance window may not exceed {MAX_ATTENDANCE_RANGE_DAYS} days.",
        )

    cases = [
        case
        for case in db.scalars(
            select(AttendanceCase)
            .where(
                AttendanceCase.employee_id == employee_id,
                AttendanceCase.operational_date >= from_date,
                AttendanceCase.operational_date <= to_date,
            )
            .order_by(AttendanceCase.operational_date, AttendanceCase.scheduled_start_at)
        )
        if _case_allowed(case, scope)
    ]
    latest = _latest_evaluations(db, [case.id for case in cases])
    adjustments = attendance_correction_service.active_corrections(db, [case.id for case in cases])
    effective_by_case = {
        case_id: _effective_evaluation_values(evaluation, adjustments.get(case_id))
        for case_id, evaluation in latest.items()
    }
    leave_fields = _case_leave_fields(db, evaluations=latest, effective=effective_by_case)
    person = _verified_people(db, {employee_id}).get(employee_id)
    policies = _policies_for_cases(db, cases)
    profile_rows = list(
        db.scalars(
            select(AttendancePunchProfile)
            .where(AttendancePunchProfile.employee_id == employee_id)
            .order_by(AttendancePunchProfile.sample_days.desc())
        )
    )
    profiles = {
        (profile.employee_id, profile.shift_code): profile
        for profile in profile_rows
        if profile.shift_code and profile.sample_days >= attendance_profile_service.MIN_SAMPLE_DAYS
    }
    windows = _punch_windows(
        db,
        cases=cases,
        people={employee_id: person} if person is not None else {},
        policies=policies,
        profiles=profiles,
    )
    punch_rows = _punch_rows_for_cases(
        db,
        cases=cases,
        people={employee_id: person} if person is not None else {},
        windows=windows,
    )

    days: list[dict[str, Any]] = []
    for case in cases:
        adjustment = adjustments.get(case.id)
        effective = effective_by_case.get(case.id)
        leave_kind, leave_label = leave_fields.get(case.id, (None, None))
        policy = policies.get(case.id)
        case_punch_rows = punch_rows.get(case.id, [])
        first_at, _last_at, count = _punch_bounds(case, case_punch_rows)
        punches = [
            {"occurred_at": punch.occurred_at, "device_name": punch.device_name}
            for punch, _assignment_case_id in case_punch_rows
        ]
        days.append(
            {
                "operational_date": case.operational_date,
                "case_id": case.id,
                "shift_code": case.shift_code_snapshot,
                "scheduled_start_at": case.scheduled_start_at,
                "scheduled_end_at": case.scheduled_end_at,
                "presence_state": effective["presence_state"] if effective else None,
                "reason_code": effective["reason_code"] if effective else None,
                "leave_kind": leave_kind,
                "leave_label": leave_label,
                "first_in_at": effective["first_in_at"] if effective else None,
                "corrected": adjustment is not None,
                "late_minutes": (
                    effective["late_minutes"]
                    if adjustment is not None and effective
                    else _late_minutes(case, first_at)
                ),
                "punch_count": count,
                "grace_minutes": policy.grace_minutes if policy is not None else None,
                "absence_due_at": _absence_due_at(case, policy),
                "judgment_due_at": _judgment_due_at(case, policy),
                "punches": punches,
            }
        )
    habits = [
        {
            "shift_code": profile.shift_code,
            "sample_days": profile.sample_days,
            "arrival_typical_offset": profile.arrival_typical_offset,
            "departure_typical_offset": profile.departure_typical_offset,
            "suggested_shift_code": profile.suggested_shift_code,
        }
        for profile in profile_rows
    ]
    return {
        "employee_id": employee_id,
        "from_date": from_date,
        "to_date": to_date,
        "days": days,
        "habits": habits,
    }


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


def _effective_evaluation_values(
    evaluation: AttendanceEvaluation | None,
    adjustment: AttendanceAdjustment | None,
) -> dict[str, Any] | None:
    if evaluation is None:
        return None
    return attendance_correction_service.overlay(_evaluation_read(evaluation), adjustment)


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


def _case_punches(db: Session, case: AttendanceCase) -> list[dict[str, Any]]:
    """Return the immutable provider events recorded by the case evaluations."""
    return [
        {"occurred_at": _as_utc_aware(row.occurred_at), "device_name": row.device_name}
        for row in db.scalars(
            select(AttendancePunch)
            .join(
                AttendanceEvaluationPunchSource,
                AttendanceEvaluationPunchSource.punch_id == AttendancePunch.id,
            )
            .join(
                AttendanceEvaluation,
                AttendanceEvaluation.id == AttendanceEvaluationPunchSource.evaluation_id,
            )
            .where(AttendanceEvaluation.attendance_case_id == case.id)
            .distinct()
            .order_by(AttendancePunch.occurred_at, AttendancePunch.id)
        )
    ]


def _audit_reason(row: AuditLog) -> str | None:
    """Read an explicitly recorded adjustment reason without interpreting payloads."""
    if not row.payload:
        return None
    try:
        payload = json.loads(row.payload)
    except (TypeError, json.JSONDecodeError):
        return None
    after = payload.get("after") if isinstance(payload, dict) else None
    reason = after.get("reason") if isinstance(after, dict) else None
    return reason.strip() if isinstance(reason, str) and reason.strip() else None


def _adjustment_audit_read(
    db: Session, adjustments: list[AttendanceAdjustment]
) -> list[dict[str, Any]]:
    adjustment_ids = {row.id for row in adjustments}
    if not adjustment_ids:
        return []
    rows = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.entity_type == "attendance_adjustment",
            AuditLog.entity_id.in_([str(adjustment_id) for adjustment_id in adjustment_ids]),
            AuditLog.action.in_(
                (
                    "workforce.attendance_adjustment.created",
                    "workforce.attendance_adjustment.revoked",
                )
            ),
        )
        .order_by(AuditLog.ts, AuditLog.id)
    )
    result: list[dict[str, Any]] = []
    adjustment_reasons = {row.id: row.reason for row in adjustments}
    for row in rows:
        if row.entity_id is None:
            continue
        try:
            adjustment_id = int(row.entity_id)
        except ValueError:
            continue
        if adjustment_id not in adjustment_ids:
            continue
        action = row.action.rsplit(".", maxsplit=1)[-1]
        reason = _audit_reason(row)
        if reason is None and action == "created":
            reason = adjustment_reasons[adjustment_id]
        if reason is None:
            continue
        result.append(
            {
                "adjustment_id": adjustment_id,
                "action": row.action.rsplit(".", maxsplit=1)[-1],
                "actor": row.actor,
                "occurred_at": _as_utc_aware(row.ts),
                "reason": reason,
            }
        )
    return result


@dataclass(frozen=True)
class AttendanceCaseSnapshot:
    body: dict[str, Any]
    etag: str


def get_attendance_case_snapshot(
    db: Session, *, scope: WorkforceScope, case_id: int
) -> AttendanceCaseSnapshot:
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
            .order_by(AttendanceAdjustment.created_at, AttendanceAdjustment.id)
        )
    )
    latest = evaluations[-1] if evaluations else None
    active = attendance_correction_service.active_correction(adjustments)
    effective = _effective_evaluation_values(latest, active)
    employee = _employee_row(db, case.employee_id)
    body = {
        "id": case.id,
        "employee_id": case.employee_id,
        "name_en": employee.name_en if employee else "",
        "name_ar": employee.name_ar if employee else None,
        "operational_date": case.operational_date,
        "scheduled_start_at": case.scheduled_start_at,
        "scheduled_end_at": case.scheduled_end_at,
        "department_snapshot": case.department_snapshot,
        "duty_unit_snapshot": case.duty_unit_snapshot,
        "duty_post_snapshot": case.duty_post_snapshot,
        "crew_code_snapshot": case.crew_code_snapshot,
        "crew_name_snapshot": case.crew_name_snapshot,
        "shift_code_snapshot": case.shift_code_snapshot,
        "organization_snapshot_state": case.organization_snapshot_state,
        "punches": _case_punches(db, case),
        "effective": effective,
        "evaluations": [_evaluation_read(row) for row in evaluations],
        "adjustments": [_adjustment_read(row) for row in adjustments],
        "adjustment_audit": _adjustment_audit_read(db, adjustments),
    }
    return AttendanceCaseSnapshot(
        body=body,
        etag=attendance_correction_service.case_etag_for(
            case_id=case.id, latest=latest, active=active
        ),
    )


def get_attendance_case(db: Session, *, scope: WorkforceScope, case_id: int) -> dict[str, Any]:
    return get_attendance_case_snapshot(db, scope=scope, case_id=case_id).body


def list_duty_assignment_events(db: Session, *, scope: WorkforceScope) -> list[dict[str, Any]]:
    rows = list(
        db.scalars(select(DutyAssignmentEvent).order_by(DutyAssignmentEvent.effective_at.desc()))
    )
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


def list_shift_overrides(db: Session, *, scope: WorkforceScope) -> list[WorkShiftOverride]:
    """Return every visible override before route-owned cursor pagination."""
    rows = list(
        db.scalars(
            select(WorkShiftOverride).order_by(
                WorkShiftOverride.starts_at.desc(),
                WorkShiftOverride.id.desc(),
            )
        )
    )
    employee_ids = {row.employee_id for row in rows}
    employees = {
        employee.id: employee
        for employee in db.scalars(select(Employee).where(Employee.id.in_(employee_ids)))
    }
    return [
        row
        for row in rows
        if (employee := employees.get(row.employee_id)) is not None
        and scope_allows(
            scope,
            employee_id=employee.id,
            department=employee.department,
            duty_unit=employee.duty_unit,
            duty_post=employee.duty_post,
        )
    ]


def list_staffing_requirements(
    db: Session,
    *,
    scope: WorkforceScope,
) -> list[WorkStaffingRequirement]:
    """Return every visible hierarchy requirement before cursor pagination."""
    return [
        row
        for row in db.scalars(
            select(WorkStaffingRequirement).order_by(WorkStaffingRequirement.id.desc())
        )
        if allows_hierarchy(
            scope,
            department=row.department,
            duty_unit=row.duty_unit,
            duty_post=row.duty_post,
        )
    ]


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


def list_shift_definitions(
    db: Session,
) -> tuple[list[WorkShiftDefinition], str]:
    """Return global shift metadata and the collection version."""
    rows = list(db.scalars(select(WorkShiftDefinition).order_by(WorkShiftDefinition.code)))
    etag = etag_for(
        [{"id": row.id, "updated_at": row.updated_at, "created_at": row.created_at} for row in rows]
    )
    return rows, etag


def rotation_detail(db: Session) -> tuple[WorkRotationPattern, str]:
    """Return the global rotation metadata and its version."""
    row = db.scalar(select(WorkRotationPattern).order_by(WorkRotationPattern.code).limit(1))
    if row is None:
        raise NotFoundError("WORKFORCE_ROTATION_NOT_FOUND", "Rotation pattern was not found.")
    return row, row_etag(row)


def list_crews(db: Session) -> tuple[list[WorkCrew], str]:
    """Return code-sorted global crews with the canonical ID-snapshot ETag."""
    rows = list(db.scalars(select(WorkCrew).order_by(WorkCrew.code)))
    return rows, workforce_admin_service.crew_collection_etag(rows)


def crew_detail(db: Session, *, crew_id: int) -> tuple[WorkCrew, str]:
    row = db.get(WorkCrew, crew_id)
    if row is None:
        raise NotFoundError("WORKFORCE_CREW_NOT_FOUND", "Crew was not found.")
    return row, row_etag(row)


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


def _crew_schedule_rows(db: Session, *, crew_id: int) -> list[WorkCrewSchedule]:
    """Return a deterministic, route-paginated schedule collection."""

    return list(
        db.scalars(
            select(WorkCrewSchedule)
            .where(WorkCrewSchedule.crew_id == crew_id)
            .order_by(WorkCrewSchedule.effective_from, WorkCrewSchedule.version)
        )
    )


def list_crew_schedules(db: Session, *, crew_id: int) -> tuple[list[WorkCrewSchedule], str]:
    crew_detail(db, crew_id=crew_id)
    rows = _crew_schedule_rows(db, crew_id=crew_id)
    return rows, workforce_schedule_service.crew_schedule_collection_etag(rows)


def crew_schedule_detail(
    db: Session, *, crew_id: int, schedule_id: int
) -> tuple[WorkCrewSchedule, str]:
    row = db.get(WorkCrewSchedule, schedule_id)
    if row is None or row.crew_id != crew_id:
        raise NotFoundError("WORKFORCE_SCHEDULE_NOT_FOUND", "Crew schedule was not found.")
    return row, row_etag(row)


def list_crew_memberships(
    db: Session, *, crew_id: int, scope: WorkforceScope
) -> tuple[list[WorkCrewMembership], str]:
    """Return visible memberships with one batched employee lookup and shared ETag."""
    crew_detail(db, crew_id=crew_id)

    rows = list(
        db.scalars(
            select(WorkCrewMembership)
            .where(WorkCrewMembership.crew_id == crew_id)
            .order_by(WorkCrewMembership.effective_from, WorkCrewMembership.id)
        )
    )
    employee_ids = {row.employee_id for row in rows}
    employees = {
        employee.id: employee
        for employee in db.scalars(select(Employee).where(Employee.id.in_(employee_ids)))
    }
    visible = [
        row
        for row in rows
        if (employee := employees.get(row.employee_id)) is not None
        and scope.allows_employee(
            employee_id=employee.id,
            department=employee.department,
            duty_unit=employee.duty_unit,
            duty_post=employee.duty_post,
        )
    ]
    return (
        visible,
        workforce_schedule_service.crew_membership_collection_etag(visible),
    )


def crew_membership_detail(
    db: Session, *, crew_id: int, membership_id: int, scope: WorkforceScope
) -> tuple[WorkCrewMembership, str]:
    row = db.get(WorkCrewMembership, membership_id)
    if row is None or row.crew_id != crew_id:
        raise NotFoundError("WORKFORCE_MEMBERSHIP_NOT_FOUND", "Crew membership was not found.")
    employee_in_scope(db, scope=scope, employee_id=row.employee_id)
    return row, row_etag(row)


def _as_utc_naive(value: datetime) -> datetime:
    return (
        value.replace(tzinfo=None)
        if value.tzinfo is None
        else value.astimezone(UTC).replace(tzinfo=None)
    )


def _as_utc_aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _preview_conflict(code: str, message: str, *, schedule_id: int | None = None) -> dict[str, Any]:
    return {"code": code, "message": message, "schedule_id": schedule_id}


def preview_crew_schedule(
    db: Session,
    *,
    scope: WorkforceScope,
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

    require_organization(
        scope,
        message="Organization workforce scope is required for crew and anchor changes.",
    )
    crew_detail(db, crew_id=crew_id)

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
    zero_steps = [
        (step, definition) for step, definition in steps if step.start_offset_minutes == 0
    ]
    if len(zero_steps) != 1:
        conflicts.append(
            _preview_conflict(
                "WORKFORCE_ROTATION_INVALID",
                "Rotation pattern must have exactly one offset-zero shift.",
            )
        )
    elif (
        _as_utc_aware(anchor).astimezone(ZoneInfo(pattern.timezone)).time().replace(tzinfo=None)
        != zero_steps[0][1].start_local_time
    ):
        conflicts.append(
            _preview_conflict(
                "WORKFORCE_SCHEDULE_ANCHOR_INVALID",
                "Schedule anchor must begin the offset-zero shift.",
            )
        )

    schedules = _crew_schedule_rows(db, crew_id=crew_id)
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
    occurrences.sort(
        key=lambda occurrence: (occurrence["starts_at"], occurrence["shift_definition_id"])
    )
    return {"crew_id": crew_id, "occurrences": occurrences, "conflicts": []}


def list_attendance_policies(db: Session) -> list[WorkAttendancePolicy]:
    """Return global attendance policy metadata in established order."""
    return list(db.scalars(select(WorkAttendancePolicy).order_by(WorkAttendancePolicy.id.desc())))


def list_provider_people(
    db: Session, *, scope: WorkforceScope, mapping_state: str | None = None
) -> list[AttendanceProviderPerson]:
    require_organization(scope, message="Organization workforce scope is required for this change.")
    query = select(AttendanceProviderPerson).order_by(AttendanceProviderPerson.id)
    if mapping_state is not None:
        query = query.where(AttendanceProviderPerson.mapping_state == mapping_state)
    return list(db.scalars(query))


def list_failed_queue(db: Session, *, scope: WorkforceScope) -> list[AttendanceEvaluationQueue]:
    require_organization(scope, message="Organization workforce scope is required for this change.")
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
            "state": "error"
            if row.last_error_code
            else "healthy"
            if row.last_success_at
            else "pending",
            "fresh_through": row.fresh_through,
            "last_success_at": row.last_success_at,
            "last_error_code": row.last_error_code,
        }
        for row in rows
    }
    streams.setdefault(
        "people",
        {
            "state": "not_configured",
            "fresh_through": None,
            "last_success_at": None,
            "last_error_code": None,
        },
    )
    streams.setdefault(
        "punches",
        {
            "state": "not_configured",
            "fresh_through": None,
            "last_success_at": None,
            "last_error_code": None,
        },
    )
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
    # A resolvable adapter that the operator has switched off is "disabled", which
    # is a different fact from having no adapter at all.
    if provider is None:
        provider_state = "not_configured"
    elif enabled:
        provider_state = "ready"
    else:
        provider_state = "disabled"
    return {
        "enabled": enabled,
        "provider_state": provider_state,
        "streams": streams,
        "sync_running": False,
    }


__all__ = [
    "crew_detail",
    "crew_membership_detail",
    "crew_membership_read",
    "crew_schedule_detail",
    "crew_schedule_read",
    "employee_attendance_range",
    "get_attendance_case",
    "get_attendance_case_snapshot",
    "integration_status",
    "list_attendance_day",
    "list_attendance_policies",
    "list_attendance_punches",
    "list_crew_memberships",
    "list_crew_schedules",
    "list_crews",
    "list_duty_assignment_events",
    "list_exceptions",
    "list_failed_queue",
    "list_provider_people",
    "list_roster",
    "list_shift_definitions",
    "list_shift_overrides",
    "list_staffing_requirements",
    "preview_crew_schedule",
    "rotation_detail",
    "rotation_read",
    "shift_definition_read",
]
