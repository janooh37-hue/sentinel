"""Durable, coalescing outbox for derived attendance evaluation work."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError, ValidationFailedError
from app.db.models import AuditLog
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluationQueue,
)
from app.services.attendance_policy import policy_for_case

MAX_QUEUE_WINDOW = timedelta(days=31)
MAX_QUEUE_REASONS = 32
MAX_QUEUE_BATCH = 100
MAX_ATTEMPTS = 5
LEASE_DURATION = timedelta(minutes=5)
_INITIAL_RETRY_DELAY = timedelta(minutes=1)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _as_db_utc(value: datetime) -> datetime:
    return _as_utc(value).replace(tzinfo=None)


def _reason_codes(*sources: Iterable[str]) -> list[str]:
    codes = {code.strip() for source in sources for code in source if code and code.strip()}
    if not codes:
        raise ValueError("reason_code is required")
    if len(codes) > MAX_QUEUE_REASONS:
        raise ValueError("too many attendance evaluation reasons")
    return sorted(codes)


def _split_window(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    chunks: list[tuple[datetime, datetime]] = []
    cursor = start
    while cursor < end:
        next_cursor = min(cursor + MAX_QUEUE_WINDOW, end)
        chunks.append((cursor, next_cursor))
        cursor = next_cursor
    return chunks


def enqueue_evaluation(
    db: Session,
    *,
    employee_id: str,
    window_start_at: datetime,
    window_end_at: datetime,
    reason_code: str,
    now: datetime,
) -> list[AttendanceEvaluationQueue]:
    """Coalesce and split durable work inside the caller's transaction.

    This function flushes for stable queue identities but never commits.  A
    source mutation that later rolls back therefore rolls its enqueue back too.
    """
    start = _as_db_utc(window_start_at)
    end = _as_db_utc(window_end_at)
    available_at = _as_db_utc(now)
    if end <= start:
        raise ValueError("attendance evaluation window must be non-empty")
    new_reasons = _reason_codes([reason_code])
    # Do not alter an active lease or a terminal row.  The former has already
    # been claimed; the latter must remain visible for an explicit admin retry.
    overlapping = db.scalars(
        select(AttendanceEvaluationQueue)
        .where(
            AttendanceEvaluationQueue.employee_id == employee_id,
            AttendanceEvaluationQueue.failed_at.is_(None),
            or_(
                AttendanceEvaluationQueue.lease_until.is_(None),
                AttendanceEvaluationQueue.lease_until <= available_at,
            ),
            AttendanceEvaluationQueue.window_start_at < end,
            AttendanceEvaluationQueue.window_end_at > start,
        )
        .order_by(AttendanceEvaluationQueue.window_start_at, AttendanceEvaluationQueue.id)
    ).all()
    if overlapping:
        start = min([start, *(row.window_start_at for row in overlapping)])
        end = max([end, *(row.window_end_at for row in overlapping)])
        reasons = _reason_codes(new_reasons, *(row.reason_codes or [] for row in overlapping))
        primary = overlapping[0]
        for row in overlapping[1:]:
            db.delete(row)
        chunks = _split_window(start, end)
        first_start, first_end = chunks.pop(0)
        primary.window_start_at = first_start
        primary.window_end_at = first_end
        primary.reason_codes = reasons
        primary.available_at = min(primary.available_at, available_at)
        primary.lease_until = None
        primary.last_error_code = None
        primary.last_error_summary = None
        rows = [primary]
    else:
        chunks = _split_window(start, end)
        reasons = new_reasons
        rows = []
    for chunk_start, chunk_end in chunks:
        row = AttendanceEvaluationQueue(
            employee_id=employee_id,
            window_start_at=chunk_start,
            window_end_at=chunk_end,
            reason_codes=reasons,
            available_at=available_at,
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def enqueue_freshness_boundary_crossings(
    db: Session,
    *,
    employee_id: str,
    previous_fresh_through: datetime | None,
    fresh_through: datetime | None,
    now: datetime,
) -> list[AttendanceEvaluationQueue]:
    """Queue every case whose decision boundary newly became knowable.

    A successful empty provider page can cross the same boundaries as a page
    with events; this makes absence and checkout decisions durable rather than
    dependent on a later event arriving.
    """
    if fresh_through is None:
        return []
    current = _as_db_utc(fresh_through)
    previous = _as_db_utc(previous_fresh_through) if previous_fresh_through is not None else None
    if previous is not None and current <= previous:
        return []

    queued: list[AttendanceEvaluationQueue] = []
    cases = db.scalars(
        select(AttendanceCase)
        .where(AttendanceCase.employee_id == employee_id)
        .order_by(AttendanceCase.scheduled_start_at, AttendanceCase.id)
    ).all()
    for attendance_case in cases:
        policy = policy_for_case(db, attendance_case)
        absence_after = policy.absence_after_minutes if policy is not None else 0
        match_after = policy.match_after_minutes if policy is not None else 0
        starts_at = _as_db_utc(attendance_case.scheduled_start_at)
        ends_at = _as_db_utc(attendance_case.scheduled_end_at)
        boundaries = (
            starts_at,
            starts_at + timedelta(minutes=absence_after),
            ends_at,
            ends_at + timedelta(minutes=match_after),
        )
        crossed_boundary = any(
            (previous is None or previous < boundary) and boundary <= current
            for boundary in boundaries
        )
        # Without an approved policy we cannot derive the absence/checkout
        # boundaries.  Keep an occurrence that is active across the freshness
        # interval visible to the evaluator as an explicit POLICY_MISSING
        # result rather than silently skipping it.
        active_without_policy = (
            policy is None
            and starts_at <= current
            and ends_at > (previous if previous is not None else current)
        )
        if not crossed_boundary and not active_without_policy:
            continue
        queued.extend(
            enqueue_evaluation(
                db,
                employee_id=employee_id,
                window_start_at=_as_utc(starts_at),
                window_end_at=_as_utc(ends_at) + timedelta(minutes=match_after),
                reason_code="PUNCH_FRESHNESS_ADVANCED",
                now=now,
            )
        )
    return queued


@dataclass(frozen=True)
class EvaluationQueueCounts:
    pending: int
    errors: int
    excluded_employee_ids: set[str]


def get_evaluation_queue_counts(
    db: Session, *, employee_ids: Iterable[str] | None = None
) -> EvaluationQueueCounts:
    """Return pending/error work and every employee whose result is non-final."""
    ids = list(dict.fromkeys(employee_ids or []))
    if employee_ids is not None and not ids:
        return EvaluationQueueCounts(pending=0, errors=0, excluded_employee_ids=set())
    filters = [AttendanceEvaluationQueue.employee_id.in_(ids)] if ids else []
    rows = db.scalars(select(AttendanceEvaluationQueue).where(*filters)).all()
    pending_rows = [row for row in rows if row.failed_at is None]
    error_rows = [row for row in rows if row.failed_at is not None]
    return EvaluationQueueCounts(
        pending=len(pending_rows),
        errors=len(error_rows),
        excluded_employee_ids={row.employee_id for row in [*pending_rows, *error_rows]},
    )


@dataclass(frozen=True)
class EvaluationQueueDrainResult:
    leased: int
    completed: int
    failed: int


def _retry_delay(attempts: int) -> timedelta:
    # Attempts are one-based here.  Cap prevents a pathological row from
    # overflowing datetime arithmetic while terminal rows stop at five anyway.
    delay: timedelta = _INITIAL_RETRY_DELAY * (2 ** min(max(attempts - 1, 0), 10))
    return delay


def _claimable_rows(
    db: Session, *, now: datetime, batch_size: int
) -> list[AttendanceEvaluationQueue]:
    rows = db.scalars(
        select(AttendanceEvaluationQueue)
        .where(
            AttendanceEvaluationQueue.failed_at.is_(None),
            AttendanceEvaluationQueue.available_at <= now,
            or_(
                AttendanceEvaluationQueue.lease_until.is_(None),
                AttendanceEvaluationQueue.lease_until <= now,
            ),
        )
        .order_by(
            AttendanceEvaluationQueue.available_at,
            AttendanceEvaluationQueue.created_at,
            AttendanceEvaluationQueue.id,
        )
        .limit(batch_size)
    ).all()
    return list(rows)


def _evaluate_row(db: Session, row: AttendanceEvaluationQueue, now: datetime) -> None:
    from app.services.attendance_evaluation_service import evaluate_case

    cases = db.scalars(
        select(AttendanceCase)
        .where(
            AttendanceCase.employee_id == row.employee_id,
            AttendanceCase.scheduled_start_at < row.window_end_at,
            AttendanceCase.scheduled_end_at > row.window_start_at,
        )
        .order_by(AttendanceCase.scheduled_start_at, AttendanceCase.id)
    ).all()
    for attendance_case in cases:
        evaluate_case(db, attendance_case.id, evaluated_at=_as_utc(now))


def drain_evaluation_queue(
    db: Session,
    *,
    now: datetime,
    batch_size: int = 25,
    evaluate: Callable[[Session, AttendanceEvaluationQueue], object] | None = None,
    lease_duration: timedelta = LEASE_DURATION,
) -> EvaluationQueueDrainResult:
    """Lease oldest rows, atomically evaluate/delete successes, and retain failures."""
    if batch_size < 1:
        raise ValueError("batch_size must be positive")
    now_db = _as_db_utc(now)
    claimed = _claimable_rows(db, now=now_db, batch_size=min(batch_size, MAX_QUEUE_BATCH))
    for row in claimed:
        row.lease_until = now_db + lease_duration
    db.flush()

    completed = 0
    failed = 0
    # The default evaluator needs the drain clock; an injected test evaluator
    # takes only (db, row), so bind `now` here rather than widening its contract.
    evaluator: Callable[[Session, AttendanceEvaluationQueue], object] = (
        evaluate
        if evaluate is not None
        else lambda session, queued: _evaluate_row(session, queued, now)
    )
    for row in claimed:
        try:
            # A failed evaluator must not leak a partial revision/source link;
            # only the retry metadata survives its savepoint rollback.
            with db.begin_nested():
                evaluator(db, row)
                db.delete(row)
                db.flush()
            completed += 1
        except Exception:
            failed += 1
            row.attempts += 1
            row.lease_until = None
            row.last_error_code = "EVALUATION_FAILED"
            row.last_error_summary = "Attendance evaluation failed."
            if row.attempts >= MAX_ATTEMPTS:
                row.failed_at = now_db
            else:
                row.available_at = now_db + _retry_delay(row.attempts)
            db.flush()
    return EvaluationQueueDrainResult(leased=len(claimed), completed=completed, failed=failed)


def retry_evaluation_queue_item(
    db: Session,
    *,
    queue_id: int,
    now: datetime,
    actor_user_id: int | None = None,
) -> AttendanceEvaluationQueue:
    """Give a terminally-failed row one fresh budget of attempts.

    Restricted to terminal rows on purpose. A non-terminal row may be leased by
    the drain right now, and clearing that lease would let a second drain claim
    the same row and evaluate the same case twice, producing duplicate
    revisions. Resetting `attempts` on a live row would also defeat the
    exponential backoff, letting a poison row cycle forever without ever
    reaching terminal visibility.

    The retry itself is preserved in the audit log; the row's own
    `attempts`/`last_error_*` fields are deliberately cleared to grant the new
    budget.
    """
    row = db.get(AttendanceEvaluationQueue, queue_id)
    if row is None:
        raise NotFoundError(
            "ATTENDANCE_EVALUATION_QUEUE_NOT_FOUND",
            "Attendance evaluation queue item was not found.",
            queue_id=queue_id,
        )
    if row.failed_at is None:
        raise ValidationFailedError(
            "ATTENDANCE_EVALUATION_QUEUE_NOT_TERMINAL",
            "Only a terminally-failed queue item can be retried.",
        )
    row.failed_at = None
    row.attempts = 0
    row.available_at = _as_db_utc(now)
    row.lease_until = None
    row.last_error_code = None
    row.last_error_summary = None
    db.add(
        AuditLog(
            actor=str(actor_user_id) if actor_user_id is not None else None,
            action="workforce.evaluation_queue.retried",
            entity_type="attendance_evaluation_queue",
            entity_id=str(row.id),
            payload=json.dumps({"queue_id": row.id}, separators=(",", ":")),
            ts=_as_db_utc(now),
        )
    )
    db.flush()
    return row


__all__ = [
    "EvaluationQueueCounts",
    "EvaluationQueueDrainResult",
    "drain_evaluation_queue",
    "enqueue_evaluation",
    "enqueue_freshness_boundary_crossings",
    "get_evaluation_queue_counts",
    "retry_evaluation_queue_item",
]
