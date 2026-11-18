"""Lifecycle-aware leave facts for workforce attendance.

This module deliberately keeps workforce leave semantics separate from legacy leave
reporting.  In particular, a generic ``status == 'Approved'`` predicate cannot
represent National Service's active Pending state or exclude non-excusing records.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import leave_lifecycle
from app.db.models import Leave
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationLeaveSource,
)

_DUBAI = ZoneInfo("Asia/Dubai")


@dataclass(frozen=True)
class ExcusingLeaveResolution:
    """The leave decision and every active leave fact supporting it."""

    employee_id: str
    operational_date: date
    reason_code: str
    source_leave_ids: tuple[int, ...]


@dataclass(frozen=True)
class LifecycleLiveLeaveSummary:
    """Current leave headcount and distinct employee-days for a bounded period."""

    live_headcount: int
    employee_days: int


@dataclass(frozen=True)
class ReevaluationWindow:
    """Inclusive operational-date bounds that must be reevaluated for one employee."""

    employee_id: str
    start_date: date
    end_date: date


_REASON_PRIORITY = {
    "LEAVE_NATIONAL_SERVICE": 0,
    "LEAVE_SICK": 1,
    "LEAVE_ANNUAL": 2,
    "LEAVE_DUTY": 3,
    "LEAVE_OTHER": 4,
}

REASON_BY_LEAVE_KIND: dict[leave_lifecycle.LeaveKind, str] = {
    "national_service": "LEAVE_NATIONAL_SERVICE",
    "sick": "LEAVE_SICK",
    "annual": "LEAVE_ANNUAL",
    "duty": "LEAVE_DUTY",
    "other": "LEAVE_OTHER",
}
LEAVE_KIND_BY_REASON: dict[str, leave_lifecycle.LeaveKind] = {
    reason: kind for kind, reason in REASON_BY_LEAVE_KIND.items()
}


def _excusing_reason(leave: Leave) -> str | None:
    """Return the workforce excuse reason for one lifecycle-live leave row.

    This is intentionally not a status-only rule: lifecycle owns which state is
    live for each leave kind, and which kinds excuse attendance at all (Leave
    Permit, Passport Release and Duty Resumption never do).
    """
    kind = leave_lifecycle.excusing_kind(
        leave.leave_type,
        leave.status,
        deleted=leave.deleted_at is not None,
    )
    return REASON_BY_LEAVE_KIND[kind] if kind is not None else None


def _operational_date(starts_at: datetime, ends_at: datetime) -> date:
    if starts_at.tzinfo is None or starts_at.utcoffset() is None:
        raise ValueError("starts_at must be timezone-aware")
    if ends_at.tzinfo is None or ends_at.utcoffset() is None:
        raise ValueError("ends_at must be timezone-aware")
    if ends_at < starts_at:
        raise ValueError("ends_at must not precede starts_at")
    # A night occurrence belongs to the Dubai date at which it started, not the
    # UTC date or the local date at which it ended.
    return starts_at.astimezone(_DUBAI).date()


def resolve_excusing_leave(
    db: Session,
    *,
    employee_id: str,
    starts_at: datetime,
    ends_at: datetime,
) -> ExcusingLeaveResolution | None:
    """Resolve the lifecycle-aware leave reason for an occurrence.

    Leave dates are inclusive.  When more than one lifecycle-live leave applies,
    the strongest reason wins while every applicable source row remains attached
    to the decision for audit and reevaluation evidence.
    """
    operational_date = _operational_date(starts_at, ends_at)
    rows = db.scalars(
        select(Leave)
        .where(
            Leave.employee_id == employee_id,
            Leave.deleted_at.is_(None),
            Leave.start_date <= operational_date,
            Leave.end_date >= operational_date,
        )
        .order_by(Leave.id)
    ).all()
    live_rows = [(leave, _excusing_reason(leave)) for leave in rows]
    excusing_rows = [(leave, reason) for leave, reason in live_rows if reason is not None]
    if not excusing_rows:
        return None

    primary_reason = min(
        (reason for _, reason in excusing_rows), key=lambda reason: _REASON_PRIORITY[reason]
    )
    return ExcusingLeaveResolution(
        employee_id=employee_id,
        operational_date=operational_date,
        reason_code=primary_reason,
        source_leave_ids=tuple(leave.id for leave, _ in excusing_rows),
    )


def summarize_lifecycle_live_leave(
    db: Session,
    *,
    employee_ids: tuple[str, ...],
    local_date: date,
    period_start: date,
    period_end: date,
) -> LifecycleLiveLeaveSummary:
    """Count live employees today and distinct live leave employee-days.

    ``Leave.days`` is presentation-era data and may be stale; employee-days are
    derived from inclusive dates.  Overlapping qualifying rows for one employee
    are merged so a person can never count twice for one operational date.
    """
    if period_end < period_start:
        raise ValueError("period_end must not precede period_start")
    requested_employee_ids = tuple(dict.fromkeys(employee_ids))
    if not requested_employee_ids:
        return LifecycleLiveLeaveSummary(live_headcount=0, employee_days=0)

    rows = db.scalars(
        select(Leave)
        .where(
            Leave.employee_id.in_(requested_employee_ids),
            Leave.deleted_at.is_(None),
            Leave.start_date <= period_end,
            Leave.end_date >= period_start,
        )
        .order_by(Leave.employee_id, Leave.start_date, Leave.end_date, Leave.id)
    ).all()
    live_rows = [leave for leave in rows if _excusing_reason(leave) is not None]
    live_headcount = len(
        {
            leave.employee_id
            for leave in live_rows
            if leave.start_date <= local_date <= leave.end_date
        }
    )

    intervals_by_employee: dict[str, list[tuple[date, date]]] = defaultdict(list)
    for leave in live_rows:
        intervals_by_employee[leave.employee_id].append(
            (max(leave.start_date, period_start), min(leave.end_date, period_end))
        )

    employee_days = 0
    for intervals in intervals_by_employee.values():
        start, end = intervals[0]
        for next_start, next_end in intervals[1:]:
            if next_start <= end.fromordinal(end.toordinal() + 1):
                end = max(end, next_end)
                continue
            employee_days += (end - start).days + 1
            start, end = next_start, next_end
        employee_days += (end - start).days + 1

    return LifecycleLiveLeaveSummary(
        live_headcount=live_headcount,
        employee_days=employee_days,
    )


def affected_reevaluation_windows(
    *, before: Leave | None, after: Leave | None
) -> tuple[ReevaluationWindow, ...]:
    """Return the bounded old/new date union affected by a leave mutation.

    Only lifecycle-live excusing facts can alter attendance.  A same-employee
    amend collapses old and new ranges into one inclusive interval; a rare employee
    reassignment yields one deterministic window per employee instead.
    """
    affected = [
        leave
        for leave in (before, after)
        if leave is not None and _excusing_reason(leave) is not None
    ]
    if not affected:
        return ()

    dates_by_employee: dict[str, list[tuple[date, date]]] = defaultdict(list)
    for leave in affected:
        dates_by_employee[leave.employee_id].append((leave.start_date, leave.end_date))

    return tuple(
        ReevaluationWindow(
            employee_id=employee_id,
            start_date=min(start for start, _ in dates),
            end_date=max(end for _, end in dates),
        )
        for employee_id, dates in sorted(dates_by_employee.items())
    )


def enqueue_unreflected_leave_excusals(
    db: Session,
    *,
    since: date,
    until: date,
    now: datetime,
    evaluation_start_at: datetime | None = None,
) -> int:
    """Requeue cases whose latest evaluation misses an excusing leave covering them.

    A leave reaches attendance only through the re-evaluation its own mutation
    enqueues.  When the excusal rule widens (Duty Leave and the other kinds),
    leaves approved before that change never enqueued anything, so their days
    keep a stale verdict.  This finds exactly those cases: evaluated, dated in
    ``[since, until]`` (and starting at or after ``evaluation_start_at``, the
    evaluator's own cutoff), and covered by an excusing leave the latest
    evaluation does not cite.  The evaluator cites every covering excusing
    leave, so a rerun after the queue drains enqueues nothing.  A case never
    evaluated is left to its normal first evaluation.  Flushes, never commits;
    returns the number of cases queued.
    """
    from app.services.attendance_queue_service import enqueue_evaluation

    if until < since:
        return 0
    excusing: dict[str, list[Leave]] = defaultdict(list)
    for leave in db.scalars(
        select(Leave).where(
            Leave.deleted_at.is_(None),
            Leave.start_date <= until,
            Leave.end_date >= since,
        )
    ):
        if _excusing_reason(leave) is not None:
            excusing[leave.employee_id].append(leave)
    if not excusing:
        return 0

    case_query = select(AttendanceCase).where(
        AttendanceCase.employee_id.in_(list(excusing)),
        AttendanceCase.operational_date >= since,
        AttendanceCase.operational_date <= until,
    )
    if evaluation_start_at is not None:
        case_query = case_query.where(
            AttendanceCase.scheduled_start_at
            >= evaluation_start_at.astimezone(UTC).replace(tzinfo=None)
        )
    cases = db.scalars(
        case_query.order_by(
            AttendanceCase.employee_id, AttendanceCase.operational_date, AttendanceCase.id
        )
    ).all()
    if not cases:
        return 0

    latest_revision = (
        select(
            AttendanceEvaluation.attendance_case_id,
            func.max(AttendanceEvaluation.revision).label("revision"),
        )
        .where(AttendanceEvaluation.attendance_case_id.in_([case.id for case in cases]))
        .group_by(AttendanceEvaluation.attendance_case_id)
        .subquery()
    )
    latest_by_case = dict(
        db.execute(
            select(AttendanceEvaluation.attendance_case_id, AttendanceEvaluation.id).join(
                latest_revision,
                (AttendanceEvaluation.attendance_case_id == latest_revision.c.attendance_case_id)
                & (AttendanceEvaluation.revision == latest_revision.c.revision),
            )
        )
        .tuples()
        .all()
    )
    cited: dict[int, set[int]] = defaultdict(set)
    for evaluation_id, leave_id in db.execute(
        select(
            AttendanceEvaluationLeaveSource.evaluation_id,
            AttendanceEvaluationLeaveSource.leave_id,
        ).where(AttendanceEvaluationLeaveSource.evaluation_id.in_(list(latest_by_case.values())))
    ).tuples():
        cited[evaluation_id].add(leave_id)

    queued = 0
    for case in cases:
        latest_id = latest_by_case.get(case.id)
        if latest_id is None:
            continue
        covering = {
            leave.id
            for leave in excusing[case.employee_id]
            if leave.start_date <= case.operational_date <= leave.end_date
        }
        if not covering or covering <= cited[latest_id]:
            continue
        day_start = datetime.combine(case.operational_date, time.min, tzinfo=_DUBAI)
        enqueue_evaluation(
            db,
            employee_id=case.employee_id,
            window_start_at=day_start.astimezone(UTC),
            window_end_at=(day_start + timedelta(days=1)).astimezone(UTC),
            # The queue only accepts its fixed reason vocabulary; these leaves
            # are approved facts the evaluator has not yet applied.
            reason_code="LEAVE_APPROVED",
            now=now,
        )
        queued += 1
    return queued


__all__ = [
    "LEAVE_KIND_BY_REASON",
    "REASON_BY_LEAVE_KIND",
    "ExcusingLeaveResolution",
    "LifecycleLiveLeaveSummary",
    "ReevaluationWindow",
    "affected_reevaluation_windows",
    "enqueue_unreflected_leave_excusals",
    "resolve_excusing_leave",
    "summarize_lifecycle_live_leave",
]
