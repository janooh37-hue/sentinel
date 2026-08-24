"""Scoped, persisted workforce dashboard projections.

The request path deliberately reads only Sentinel's local schedule, leave, evaluation,
and sync-state tables.  Provider clients are never imported here.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import leave_lifecycle
from app.db.models import AppSetting, Employee, Leave
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationQueue,
    AttendanceProviderPerson,
    AttendanceSyncState,
    DutyAssignmentEvent,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.services.workforce_scope_service import normalize_scope_value, scope_allows

_ORGANIZATION_TIMEZONE = ZoneInfo("Asia/Dubai")
_ACTIVE_EMPLOYEE_STATUS = "active"
_NON_EMPLOYEE_ROW = "__aggregate_row__"


@dataclass(frozen=True)
class DashboardProjection:
    """JSON-ready dashboard result, separated from FastAPI response plumbing."""

    value: dict[str, Any]


def _naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _aware_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _now(now: datetime | None) -> tuple[datetime, datetime, date]:
    aware = (now or datetime.now(UTC)).astimezone(UTC)
    naive = aware.replace(tzinfo=None)
    return aware, naive, aware.astimezone(_ORGANIZATION_TIMEZONE).date()


def _setting(db: Session, key: str, default: Any) -> Any:
    row = db.get(AppSetting, key)
    if row is None:
        return default
    try:
        return json.loads(row.value)
    except (TypeError, json.JSONDecodeError):
        return default


def _scope_allows(
    scope: Any,
    *,
    department: str | None,
    duty_unit: str | None,
    duty_post: str | None,
    employee_id: str | None = None,
) -> bool:
    """Delegate hierarchy matching to the canonical authorization service."""
    return scope_allows(
        scope,
        # Aggregate rows (duty events) carry no person; a sentinel keeps the
        # check purely hierarchical so a self-only scope never matches them.
        employee_id=employee_id if employee_id is not None else _NON_EMPLOYEE_ROW,
        department=normalize_scope_value(department),
        duty_unit=normalize_scope_value(duty_unit),
        duty_post=normalize_scope_value(duty_post),
    )

def _is_active_employee(status: str | None) -> bool:
    return (status or "").strip().casefold() == _ACTIVE_EMPLOYEE_STATUS


def _leave_kind(leave: Leave) -> str | None:
    """Classify lifecycle-live records without treating any leave as presence."""
    group = leave_lifecycle.classify_group(leave.leave_type)
    status = leave_lifecycle.canonical_status(leave.status)
    if group == "national_service":
        return "national_service" if status in {"Pending", "Completed"} else None
    if group == "sick":
        return "sick" if status == "Approved" else None
    if group == "request":
        return "annual" if status == "Approved" else None
    # Record kinds are intentionally excluded here.  Their work-excusing status
    # comes from the typed configuration evaluated by the attendance domain.
    return None


def _live_leaves(db: Session, *, operational_date: date) -> dict[str, str]:
    """Return one stable lifecycle category per employee on the local date."""
    priority = {"national_service": 3, "sick": 2, "annual": 1, "other": 0}
    result: dict[str, str] = {}
    rows = db.scalars(
        select(Leave).where(
            Leave.deleted_at.is_(None),
            Leave.start_date <= operational_date,
            Leave.end_date >= operational_date,
        )
    )
    for row in rows:
        kind = _leave_kind(row)
        if kind is None:
            continue
        previous = result.get(row.employee_id)
        if previous is None or priority[kind] > priority[previous]:
            result[row.employee_id] = kind
    return result




def _case_in_scope(case: AttendanceCase, scope: Any) -> bool:
    return _scope_allows(
        scope,
        employee_id=case.employee_id,
        department=case.department_snapshot,
        duty_unit=case.duty_unit_snapshot,
        duty_post=case.duty_post_snapshot,
    )


def _employee_in_scope(employee: Employee, scope: Any) -> bool:
    return _scope_allows(
        scope,
        employee_id=employee.id,
        department=employee.department,
        duty_unit=employee.duty_unit,
        duty_post=employee.duty_post,
    )


def _latest_evaluations(db: Session, case_ids: Iterable[int]) -> dict[int, AttendanceEvaluation]:
    ids = list(case_ids)
    if not ids:
        return {}
    rows = list(
        db.scalars(
            select(AttendanceEvaluation)
            .where(AttendanceEvaluation.attendance_case_id.in_(ids))
            .order_by(AttendanceEvaluation.attendance_case_id, AttendanceEvaluation.revision.desc())
        )
    )
    latest: dict[int, AttendanceEvaluation] = {}
    for row in rows:
        latest.setdefault(row.attendance_case_id, row)
    return latest


def _queued_case_ids(db: Session, cases: Iterable[AttendanceCase]) -> set[int]:
    by_employee: dict[str, list[AttendanceCase]] = defaultdict(list)
    for case in cases:
        by_employee[case.employee_id].append(case)
    employee_ids = list(by_employee)
    if not employee_ids:
        return set()
    queued: set[int] = set()
    rows = db.scalars(
        select(AttendanceEvaluationQueue).where(
            AttendanceEvaluationQueue.employee_id.in_(employee_ids),
            AttendanceEvaluationQueue.failed_at.is_(None),
        )
    )
    for row in rows:
        for case in by_employee[row.employee_id]:
            if row.window_start_at < case.scheduled_end_at and row.window_end_at > case.scheduled_start_at:
                queued.add(case.id)
    return queued


def _stream_health(
    db: Session,
    *,
    now: datetime,
) -> dict[str, dict[str, Any]]:
    stale_after_value = _setting(
        db,
        "workforce.stale_after_minutes",
        None,
    )
    stale_after = (
        stale_after_value
        if isinstance(stale_after_value, int)
        and not isinstance(stale_after_value, bool)
        and stale_after_value > 0
        else None
    )
    rows = list(db.scalars(select(AttendanceSyncState)))
    health: dict[str, dict[str, Any]] = {}
    for row in rows:
        fresh = row.fresh_through
        if stale_after is None:
            state = "not_configured"
        elif row.last_error_code:
            state = "error"
        elif fresh is None:
            state = "pending"
        elif fresh < now.replace(tzinfo=None) - timedelta(minutes=stale_after):
            state = "stale"
        else:
            state = "healthy"
        health[row.stream] = {
            "state": state,
            "fresh_through": fresh,
            "last_success_at": row.last_success_at,
            "last_error_code": row.last_error_code,
        }
    health.setdefault(
        "people",
        {
            "state": "not_configured",
            "fresh_through": None,
            "last_success_at": None,
            "last_error_code": None,
        },
    )
    health.setdefault(
        "punches",
        {
            "state": "not_configured",
            "fresh_through": None,
            "last_success_at": None,
            "last_error_code": None,
        },
    )
    return health


def _attendance_is_trustworthy(sync_health: dict[str, dict[str, Any]]) -> bool:
    return bool(sync_health["punches"]["state"] == "healthy")


def _case_metrics(
    db: Session,
    *,
    cases: list[AttendanceCase],
    sync_health: dict[str, dict[str, Any]],
    live_leave_by_employee: dict[str, str],
) -> dict[str, Any]:
    latest = _latest_evaluations(db, (case.id for case in cases))
    queued = _queued_case_ids(db, cases)
    scheduled = len(cases)
    excused = sum(case.employee_id in live_leave_by_employee for case in cases)
    expected = scheduled - excused
    suppressed = not _attendance_is_trustworthy(sync_health)
    evaluable = [case for case in cases if case.id not in queued and case.id in latest]
    evaluated_count = 0 if suppressed else len(evaluable)
    pending_or_error = len(queued)
    if suppressed:
        working: int | None = None
    else:
        working = sum(
            latest[case.id].presence_state in {"on_duty", "completed"}
            for case in evaluable
            if case.employee_id not in live_leave_by_employee
        )
    return {
        "scheduled": scheduled,
        "excused": excused,
        "expected": expected,
        "evaluated_count": evaluated_count,
        "pending_or_error_excluded_count": pending_or_error,
        "working": working,
    }


def _current_cases(db: Session, *, scope: Any, as_of_naive: datetime, operational_date: date) -> list[AttendanceCase]:
    all_today = list(
        db.scalars(
            select(AttendanceCase).where(AttendanceCase.operational_date == operational_date)
        )
    )
    current = [
        case
        for case in all_today
        if case.scheduled_start_at <= as_of_naive < case.scheduled_end_at and _case_in_scope(case, scope)
    ]
    # After a daily shift has concluded, the last completed operational-date
    # occurrence is still the most recent workforce fact.  This preserves an
    # honest read without pretending that the roster is currently on duty.
    if current:
        return current
    latest_start = max((case.scheduled_start_at for case in all_today), default=None)
    return [
        case
        for case in all_today
        if case.scheduled_start_at == latest_start and _case_in_scope(case, scope)
    ]


def _leave_composition(db: Session, *, scope: Any, operational_date: date) -> dict[str, int]:
    leave_by_employee = _live_leaves(db, operational_date=operational_date)
    employees = db.scalars(select(Employee).where(Employee.id.in_(list(leave_by_employee)))).all()
    result = {"annual": 0, "sick": 0, "national_service": 0, "other": 0}
    for employee in employees:
        if _employee_in_scope(employee, scope):
            result[leave_by_employee[employee.id]] += 1
    return result


def _self_block(db: Session, *, employee_id: str, as_of_naive: datetime, operational_date: date) -> dict[str, Any]:
    cases = list(
        db.scalars(
            select(AttendanceCase).where(
                AttendanceCase.employee_id == employee_id,
                AttendanceCase.operational_date == operational_date,
            )
        )
    )
    case = next(
        (item for item in cases if item.scheduled_start_at <= as_of_naive < item.scheduled_end_at),
        max(cases, key=lambda item: item.scheduled_start_at, default=None),
    )
    if case is None:
        return {"employee_id": employee_id, "presence_state": None, "reason_code": None, "scheduled_start_at": None, "scheduled_end_at": None}
    latest = _latest_evaluations(db, [case.id]).get(case.id)
    return {
        "employee_id": employee_id,
        "presence_state": latest.presence_state if latest else None,
        "reason_code": latest.reason_code if latest else None,
        "scheduled_start_at": case.scheduled_start_at,
        "scheduled_end_at": case.scheduled_end_at,
    }


def _setup_readiness(
    db: Session,
    *,
    as_of_naive: datetime,
    operational_date: date,
    sync_health: dict[str, dict[str, Any]],
) -> dict[str, bool]:
    schedules_ready = db.scalar(
        select(WorkCrewSchedule.id)
        .where(
            WorkCrewSchedule.effective_from <= as_of_naive,
            (
                WorkCrewSchedule.effective_to.is_(None)
                | (WorkCrewSchedule.effective_to > as_of_naive)
            ),
        )
        .limit(1)
    ) is not None

    policies = list(
        db.scalars(
            select(WorkAttendancePolicy).where(
                WorkAttendancePolicy.approved_at.is_not(None),
                WorkAttendancePolicy.effective_from <= operational_date,
                (
                    WorkAttendancePolicy.effective_to.is_(None)
                    | (WorkAttendancePolicy.effective_to > operational_date)
                ),
            )
        )
    )
    global_policy = any(
        policy.shift_definition_id is None for policy in policies
    )
    shift_ids = set(db.scalars(select(WorkShiftDefinition.id)))
    covered_shift_ids = {
        policy.shift_definition_id
        for policy in policies
        if policy.shift_definition_id is not None
    }
    policy_ready = global_policy or (
        bool(shift_ids) and shift_ids.issubset(covered_shift_ids)
    )

    membership_employee_ids = set(
        db.scalars(
            select(WorkCrewMembership.employee_id).where(
                WorkCrewMembership.effective_from <= as_of_naive,
                (
                    WorkCrewMembership.effective_to.is_(None)
                    | (WorkCrewMembership.effective_to > as_of_naive)
                ),
            )
        )
    )
    active_scheduled_ids = {
        employee.id
        for employee in db.scalars(
            select(Employee).where(
                Employee.id.in_(membership_employee_ids)
            )
        )
        if _is_active_employee(employee.status)
    }
    verified_mapping_counts = Counter(
        row.employee_id
        for row in db.scalars(
            select(AttendanceProviderPerson).where(
                AttendanceProviderPerson.employee_id.in_(
                    active_scheduled_ids
                ),
                AttendanceProviderPerson.mapping_state == "verified",
                AttendanceProviderPerson.active.is_(True),
            )
        )
        if row.employee_id is not None
    )
    mappings_ready = bool(active_scheduled_ids) and all(
        verified_mapping_counts[employee_id] == 1
        for employee_id in active_scheduled_ids
    )
    integration_ready = all(
        sync_health[stream]["state"] != "not_configured"
        for stream in ("people", "punches")
    )
    return {
        "schedules_ready": schedules_ready,
        "policy_ready": policy_ready,
        "mappings_ready": mappings_ready,
        "integration_ready": integration_ready,
    }


def _next_shift(
    db: Session,
    *,
    as_of_naive: datetime,
    scope: Any | None,
    self_employee_id: str | None,
) -> dict[str, Any]:
    eligible_employees = {
        employee.id: employee
        for employee in db.scalars(select(Employee))
        if _is_active_employee(employee.status)
        and (
            (scope is not None and _employee_in_scope(employee, scope))
            or (
                scope is None
                and self_employee_id is not None
                and employee.id == self_employee_id
            )
        )
    }
    empty: dict[str, Any] = {
        "starts_at": None,
        "ends_at": None,
        "shift_code": None,
        "shift_name": None,
        "crews": [],
        "scheduled": 0,
        "expected": None,
        "staffing_minimum": None,
    }
    if not eligible_employees:
        return empty

    memberships = list(
        db.scalars(
            select(WorkCrewMembership).where(
                WorkCrewMembership.employee_id.in_(eligible_employees)
            )
        )
    )
    occurrences = list(
        db.scalars(
            select(WorkShiftOccurrence)
            .where(WorkShiftOccurrence.starts_at > as_of_naive)
            .order_by(WorkShiftOccurrence.starts_at, WorkShiftOccurrence.id)
            .limit(256)
        )
    )
    if not occurrences:
        return empty

    crews = {
        crew.id: crew
        for crew in db.scalars(
            select(WorkCrew).where(
                WorkCrew.id.in_({row.crew_id for row in occurrences})
            )
        )
    }
    shifts = {
        shift.id: shift
        for shift in db.scalars(
            select(WorkShiftDefinition).where(
                WorkShiftDefinition.id.in_(
                    {row.shift_definition_id for row in occurrences}
                )
            )
        )
    }

    for start_at in dict.fromkeys(row.starts_at for row in occurrences):
        group = [
            row for row in occurrences if row.starts_at == start_at
        ]
        scheduled_ids = {
            membership.employee_id
            for occurrence in group
            for membership in memberships
            if membership.crew_id == occurrence.crew_id
            and membership.effective_from <= occurrence.starts_at
            and (
                membership.effective_to is None
                or membership.effective_to > occurrence.starts_at
            )
        }
        if not scheduled_ids:
            continue
        leave_by_employee = _live_leaves(
            db,
            operational_date=group[0].operational_date,
        )
        shift_codes = sorted(
            {
                shifts[row.shift_definition_id].code
                for row in group
                if row.shift_definition_id in shifts
            }
        )
        crew_names = sorted(
            {
                (
                    crews[row.crew_id].name_en
                    or crews[row.crew_id].name_ar
                    or crews[row.crew_id].code
                )
                for row in group
                if row.crew_id in crews
            }
        )
        return {
            "starts_at": start_at,
            "ends_at": max(row.ends_at for row in group),
            "shift_code": ", ".join(shift_codes) or None,
            "shift_name": ", ".join(shift_codes) or None,
            "crews": crew_names,
            "scheduled": len(scheduled_ids),
            "expected": sum(
                employee_id not in leave_by_employee
                for employee_id in scheduled_ids
            ),
            "staffing_minimum": None,
        }
    return empty


def get_workforce_snapshot(
    db: Session,
    *,
    scope: Any | None,
    self_employee_id: str | None,
    include_aggregate: bool,
    now: datetime | None = None,
) -> DashboardProjection:
    """Build the fast dashboard snapshot from local projections only."""
    aware_now, naive_now, operational_date = _now(now)
    sync_health = _stream_health(db, now=aware_now)
    aggregate_scope = scope if include_aggregate else None
    value: dict[str, Any] = {
        "as_of": aware_now,
        "operational_date": operational_date,
        "timezone": "Asia/Dubai",
        "sync_health": sync_health,
        "evaluation_health": {"pending_count": 0, "error_count": 0, "oldest_pending_at": None},
        "readiness": _setup_readiness(
            db,
            as_of_naive=naive_now,
            operational_date=operational_date,
            sync_health=sync_health,
        ),
        "current_shift": {
            "starts_at": None,
            "ends_at": None,
            "scheduled": 0,
            "excused": 0,
            "expected": 0,
            "evaluated_count": 0,
            "pending_or_error_excluded_count": 0,
            "working": None,
            "verified_roster_gap": None,
            "verified_coverage_percent": None,
            "staffing_status": None,
        },
        "next_shift": _next_shift(
            db,
            as_of_naive=naive_now,
            scope=aggregate_scope,
            self_employee_id=self_employee_id,
        ),
        "leave_today": {"annual": 0, "sick": 0, "national_service": 0, "other": 0},
        "mapping_completeness": {"verified": 0, "unmapped": 0, "conflict": 0},
        "schedule_completeness": {"scheduled": 0, "unscheduled": 0},
    }
    # Queue health is organization-wide operational metadata. A self-only caller
    # (workforce.self.view without workforce.dashboard.view) must see at most
    # their own pending work, never the installation's backlog.
    queue_query = select(AttendanceEvaluationQueue)
    if not include_aggregate or aggregate_scope is None:
        queue_query = queue_query.where(
            AttendanceEvaluationQueue.employee_id == (self_employee_id or "")
        )
    queue_rows = list(db.scalars(queue_query))
    pending = [row for row in queue_rows if row.failed_at is None]
    failed = [row for row in queue_rows if row.failed_at is not None]
    value["evaluation_health"] = {
        "pending_count": len(pending),
        "error_count": len(failed),
        "oldest_pending_at": min((row.created_at for row in pending), default=None),
    }
    if self_employee_id:
        value["self"] = _self_block(
            db,
            employee_id=self_employee_id,
            as_of_naive=naive_now,
            operational_date=operational_date,
        )
    if not include_aggregate or aggregate_scope is None:
        # Setup readiness and provider stream health describe the whole
        # installation, so they are aggregate blocks the spec omits here.
        value.pop("readiness", None)
        value.pop("sync_health", None)
        return DashboardProjection(value)

    cases = _current_cases(
        db,
        scope=aggregate_scope,
        as_of_naive=naive_now,
        operational_date=operational_date,
    )
    live = _live_leaves(db, operational_date=operational_date)
    metrics = _case_metrics(db, cases=cases, sync_health=sync_health, live_leave_by_employee=live)
    if cases:
        value["current_shift"].update(
            metrics,
            starts_at=min(case.scheduled_start_at for case in cases),
            ends_at=max(case.scheduled_end_at for case in cases),
        )
    value["leave_today"] = _leave_composition(
        db, scope=aggregate_scope, operational_date=operational_date
    )
    memberships = list(db.scalars(select(WorkCrewMembership)))
    membership_employee_ids = {row.employee_id for row in memberships if row.effective_to is None or row.effective_to > naive_now}
    scoped_employees = [employee for employee in db.scalars(select(Employee)) if _employee_in_scope(employee, aggregate_scope)]
    mapped: Counter[str] = Counter()
    for row in db.scalars(select(AttendanceProviderPerson)):
        if row.employee_id in {employee.id for employee in scoped_employees}:
            mapped[row.mapping_state] += 1
    value["mapping_completeness"] = {
        "verified": mapped["verified"],
        "unmapped": mapped["unmapped"],
        "conflict": mapped["conflict"],
    }
    active_scoped = [employee for employee in scoped_employees if _is_active_employee(employee.status)]
    value["schedule_completeness"] = {
        "scheduled": sum(employee.id in membership_employee_ids for employee in active_scoped),
        "unscheduled": sum(employee.id not in membership_employee_ids for employee in active_scoped),
    }
    value["aggregate"] = {"active_employees": len(active_scoped)}
    return DashboardProjection(value)


def get_coverage_children(
    db: Session,
    *,
    scope: Any,
    operational_date: date,
    parent_kind: str,
    department: str | None = None,
    duty_unit: str | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Return child aggregates only, never names or employee identifiers."""
    _, _, _ = _now(now)
    cases = [
        case
        for case in db.scalars(select(AttendanceCase).where(AttendanceCase.operational_date == operational_date))
        if _case_in_scope(case, scope)
    ]
    # Each branch selects a different hierarchy depth, so the grouping key is
    # a variable-length tuple of snapshot column names.
    if parent_kind == "organization":
        child_kind, fields = "department", ("department_snapshot",)
    elif parent_kind == "department":
        cases = [case for case in cases if normalize_scope_value(case.department_snapshot) == department]
        child_kind, fields = "duty_unit", ("department_snapshot", "duty_unit_snapshot")
    elif parent_kind == "duty_unit":
        cases = [
            case
            for case in cases
            if normalize_scope_value(case.department_snapshot) == department
            and normalize_scope_value(case.duty_unit_snapshot) == duty_unit
        ]
        child_kind, fields = "duty_post", ("department_snapshot", "duty_unit_snapshot", "duty_post_snapshot")
    else:
        raise ValueError("parent_kind must be organization, department, or duty_unit")
    live = _live_leaves(db, operational_date=operational_date)
    health = _stream_health(db, now=datetime.now(UTC))
    buckets: dict[tuple[str | None, ...], list[AttendanceCase]] = defaultdict(list)
    for case in cases:
        buckets[tuple(normalize_scope_value(getattr(case, field)) for field in fields)].append(case)
    result: list[dict[str, Any]] = []
    for key, bucket in buckets.items():
        metrics = _case_metrics(db, cases=bucket, sync_health=health, live_leave_by_employee=live)
        department_value = key[0]
        unit_value = key[1] if len(key) > 1 else None
        post_value = key[2] if len(key) > 2 else None
        result.append(
            {
                "kind": child_kind,
                "department": department_value,
                "duty_unit": unit_value,
                "duty_post": post_value,
                **metrics,
                "child_count": len(bucket),
            }
        )
    return sorted(result, key=lambda item: ((item["department"] or ""), (item["duty_unit"] or ""), (item["duty_post"] or "")))


def get_workforce_analytics(
    db: Session, *, scope: Any, now: datetime | None = None
) -> DashboardProjection:
    """Build the heavier aggregate analytics projection without identity leakage."""
    aware_now, _, operational_date = _now(now)
    health = _stream_health(db, now=aware_now)
    cases = [
        case
        for case in db.scalars(select(AttendanceCase).where(AttendanceCase.operational_date == operational_date))
        if _case_in_scope(case, scope)
    ]
    live = _live_leaves(db, operational_date=operational_date)
    by_department: dict[str | None, list[AttendanceCase]] = defaultdict(list)
    by_shift: dict[str, list[AttendanceCase]] = defaultdict(list)
    for case in cases:
        by_department[case.department_snapshot].append(case)
        by_shift[case.shift_code_snapshot].append(case)
    coverage: list[dict[str, Any]] = []
    for department, bucket in sorted(by_department.items(), key=lambda item: item[0] or ""):
        coverage.append(
            {
                "kind": "department",
                "department": department,
                "duty_unit": None,
                "duty_post": None,
                **_case_metrics(db, cases=bucket, sync_health=health, live_leave_by_employee=live),
                "child_count": len({case.duty_unit_snapshot for case in bucket}),
            }
        )
    shift_roster = [
        {"shift_code": shift_code, **_case_metrics(db, cases=bucket, sync_health=health, live_leave_by_employee=live)}
        for shift_code, bucket in sorted(by_shift.items())
    ]
    # The widget's denominator is active employees in scope; resigned or
    # terminated records must not inflate a bucket or the total.
    employees = [
        employee
        for employee in db.scalars(select(Employee))
        if _is_active_employee(employee.status) and _employee_in_scope(employee, scope)
    ]
    fold_value = _setting(
        db,
        "workforce.nationality_fold_min_count",
        None,
    )
    fold_minimum = (
        fold_value
        if isinstance(fold_value, int)
        and not isinstance(fold_value, bool)
        and fold_value > 0
        else None
    )
    distribution: list[dict[str, Any]] = []
    if fold_minimum is not None:
        nationalities = Counter(
            employee.nationality or "Not recorded"
            for employee in employees
        )
        folded = 0
        for nationality, count in sorted(nationalities.items()):
            if nationality == "Not recorded":
                distribution.append(
                    {"nationality": nationality, "count": count}
                )
            elif count < fold_minimum:
                folded += count
            else:
                distribution.append(
                    {"nationality": nationality, "count": count}
                )
        # An "Other" bucket below the threshold is exactly as re-identifying as
        # the row it replaced (with a floor of 2, "Other: 1" names one person),
        # so it is suppressed rather than published. Suppression is preferred
        # over absorbing a disclosable group, which would destroy valid data.
        if folded >= fold_minimum:
            distribution.append({"nationality": "Other", "count": folded})
        recorded = [
            row
            for row in distribution
            if row["nationality"] not in {"Other", "Not recorded"}
        ]
        other = [
            row
            for row in distribution
            if row["nationality"] == "Other"
        ]
        missing = [
            row
            for row in distribution
            if row["nationality"] == "Not recorded"
        ]
        distribution = recorded + other + missing
    events: list[dict[str, Any]] = []
    for event in db.scalars(select(DutyAssignmentEvent).where(DutyAssignmentEvent.event_type != "baseline").order_by(DutyAssignmentEvent.effective_at.desc()).limit(20)):
        if _scope_allows(scope, department=event.to_department, duty_unit=event.to_unit, duty_post=event.to_post):
            events.append(
                {
                    "id": event.id,
                    "event_type": event.event_type,
                    "to_department": event.to_department,
                    "to_unit": event.to_unit,
                    "to_post": event.to_post,
                    "effective_at": event.effective_at,
                }
            )
    return DashboardProjection(
        {
            "department_coverage": coverage,
            "shift_roster": shift_roster,
            "leave_today": _leave_composition(db, scope=scope, operational_date=operational_date),
            "leave_trend": [],
            "nationality_distribution": distribution,
            "duty_assignment_events": events,
        }
    )


__all__ = ["DashboardProjection", "get_coverage_children", "get_workforce_analytics", "get_workforce_snapshot"]
