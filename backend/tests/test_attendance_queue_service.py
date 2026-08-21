"""RED contracts for the durable, coalescing attendance evaluation outbox."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.api.errors import ValidationFailedError
from app.db.models import AuditLog, Employee, User
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluationQueue,
    WorkCrew,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.services.attendance_queue_service import (
    drain_evaluation_queue,
    enqueue_evaluation,
    enqueue_freshness_boundary_crossings,
    get_evaluation_queue_counts,
    retry_evaluation_queue_item,
)

NOW = datetime(2026, 8, 17, 12, tzinfo=UTC)

def _db_utc(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo is not None else value


def _employee(db_session, employee_id: str = "G-QUEUE-1") -> Employee:
    employee = Employee(id=employee_id, name_en="Queue Tester", name_ar="مختبر الطابور")
    db_session.add(employee)
    db_session.flush()
    return employee

def _occurrence(db_session) -> WorkShiftOccurrence:
    actor = User(
        email="queue-fixture-actor@test.example",
        password_hash="x",
        role="admin",
        status="active",
    )
    shift = WorkShiftDefinition(
        code="queue-fixture-shift",
        start_local_time=(NOW - timedelta(minutes=20)).time(),
        duration_minutes=480,
    )
    pattern = WorkRotationPattern(
        code="queue-fixture-pattern",
        name="Queue fixture pattern",
        cycle_minutes=7_200,
        timezone="Asia/Dubai",
    )
    crew = WorkCrew(code="queue-fixture-crew", name_en="Queue fixture crew")
    db_session.add_all((actor, shift, pattern, crew))
    db_session.flush()
    schedule = WorkCrewSchedule(
        crew_id=crew.id,
        pattern_id=pattern.id,
        anchor_at=NOW - timedelta(minutes=20),
        effective_from=NOW - timedelta(days=1),
        version=1,
        created_by_user_id=actor.id,
    )
    db_session.add(schedule)
    db_session.flush()
    occurrence = WorkShiftOccurrence(
        crew_id=crew.id,
        crew_schedule_id=schedule.id,
        shift_definition_id=shift.id,
        starts_at=NOW - timedelta(minutes=20),
        ends_at=NOW + timedelta(hours=7, minutes=40),
        operational_date=NOW.date(),
        pattern_code_snapshot="five-team-120h",
        crew_schedule_version_snapshot=1,
        source_anchor_at=NOW,
    )
    db_session.add(occurrence)
    db_session.flush()
    return occurrence


def _pending_rows(db_session, employee_id: str) -> list[AttendanceEvaluationQueue]:
    return db_session.scalars(
        select(AttendanceEvaluationQueue)
        .where(AttendanceEvaluationQueue.employee_id == employee_id)
        .order_by(AttendanceEvaluationQueue.window_start_at)
    ).all()


def test_overlapping_source_mutations_coalesce_in_their_calling_transaction(db_session):
    employee = _employee(db_session)
    start = NOW - timedelta(hours=2)
    end = NOW + timedelta(hours=2)

    enqueue_evaluation(
        db_session,
        employee_id=employee.id,
        window_start_at=start,
        window_end_at=end,
        reason_code="PUNCH_IMPORTED",
        now=NOW,
    )
    enqueue_evaluation(
        db_session,
        employee_id=employee.id,
        window_start_at=NOW - timedelta(hours=1),
        window_end_at=NOW + timedelta(hours=4),
        reason_code="LEAVE_APPROVED",
        now=NOW,
    )
    rows = _pending_rows(db_session, employee.id)
    assert len(rows) == 1
    assert (rows[0].window_start_at, rows[0].window_end_at) == (
        _db_utc(start),
        _db_utc(NOW + timedelta(hours=4)),
    )
    assert rows[0].reason_codes == ["LEAVE_APPROVED", "PUNCH_IMPORTED"]

    try:
        with db_session.begin_nested():
            enqueue_evaluation(
                db_session,
                employee_id=employee.id,
                window_start_at=NOW + timedelta(days=2),
                window_end_at=NOW + timedelta(days=3),
                reason_code="MAPPING_CHANGED",
                now=NOW,
            )
            raise RuntimeError("source mutation rolls back")
    except RuntimeError:
        pass
    assert len(_pending_rows(db_session, employee.id)) == 1


def test_fresh_through_crossing_enqueues_work_without_provider_events(db_session):
    employee = _employee(db_session)
    occurrence = _occurrence(db_session)
    db_session.add(
        AttendanceCase(
            employee_id=employee.id,
            shift_occurrence_id=occurrence.id,
            employee_status_snapshot="active",
            crew_code_snapshot="alpha",
            crew_name_snapshot="Alpha",
            shift_code_snapshot="morning",
            scheduled_start_at=occurrence.starts_at,
            scheduled_end_at=occurrence.ends_at,
            operational_date=occurrence.operational_date,
            organization_snapshot_state="captured",
        )
    )
    db_session.flush()

    enqueue_freshness_boundary_crossings(
        db_session,
        employee_id=employee.id,
        previous_fresh_through=NOW - timedelta(minutes=1),
        fresh_through=NOW + timedelta(minutes=1),
        now=NOW,
    )
    rows = _pending_rows(db_session, employee.id)
    assert len(rows) == 1
    assert rows[0].window_start_at <= _db_utc(NOW - timedelta(minutes=20)) < rows[0].window_end_at
    assert rows[0].reason_codes == ["PUNCH_FRESHNESS_ADVANCED"]


def test_drain_leases_oldest_bounded_work_and_keeps_failure_visible_for_explicit_retry(db_session):
    employee = _employee(db_session)
    for offset in (2, 1):
        enqueue_evaluation(
            db_session,
            employee_id=employee.id,
            window_start_at=NOW + timedelta(days=offset),
            window_end_at=NOW + timedelta(days=offset, hours=1),
            reason_code="POLICY_CHANGED",
            now=NOW + timedelta(seconds=offset),
        )

    seen: list[int] = []

    def always_fail(db, row):
        seen.append(row.id)
        raise RuntimeError("deterministic evaluation failure")

    # Oldest means the earliest *available* row.  Once it backs off, the other
    # ready row must make progress rather than being starved by a retrying row.
    for attempt in range(9):
        drain_evaluation_queue(
            db_session,
            now=NOW + timedelta(seconds=1, hours=attempt),
            batch_size=1,
            evaluate=always_fail,
        )

    oldest, later = _pending_rows(db_session, employee.id)
    assert seen[::2] == [oldest.id] * 5
    assert seen[1::2] == [later.id] * 4
    assert oldest.attempts == 5
    assert oldest.failed_at is not None
    assert oldest.last_error_code == "EVALUATION_FAILED"
    assert later.attempts == 4
    assert later.failed_at is None


def test_pending_and_terminal_error_counts_exclude_affected_dashboard_judgments_from_final_totals(db_session):
    employee = _employee(db_session)
    enqueue_evaluation(
        db_session,
        employee_id=employee.id,
        window_start_at=NOW,
        window_end_at=NOW + timedelta(hours=1),
        reason_code="PUNCH_IMPORTED",
        now=NOW,
    )
    row = _pending_rows(db_session, employee.id)[0]
    row.failed_at = NOW
    row.attempts = 5
    db_session.flush()

    counts = get_evaluation_queue_counts(db_session, employee_ids=[employee.id])
    assert counts.pending == 0
    assert counts.errors == 1
    assert counts.excluded_employee_ids == {employee.id}


def test_default_evaluator_drains_real_work_instead_of_failing_every_row(db_session):
    """The production drain injects no evaluator; the built-in one must be callable.

    A signature mismatch here is invisible to tests that inject a stub, and the
    drain's broad ``except Exception`` would silently retry-then-fail every row.
    """
    employee = _employee(db_session)
    occurrence = _occurrence(db_session)
    case = AttendanceCase(
        employee_id=employee.id,
        shift_occurrence_id=occurrence.id,
        employee_status_snapshot="active",
        shift_code_snapshot="queue-fixture-shift",
        scheduled_start_at=_db_utc(occurrence.starts_at),
        scheduled_end_at=_db_utc(occurrence.ends_at),
        operational_date=occurrence.operational_date,
        organization_snapshot_state="captured",
    )
    db_session.add(case)
    enqueue_evaluation(
        db_session,
        employee_id=employee.id,
        window_start_at=NOW - timedelta(hours=1),
        window_end_at=NOW + timedelta(hours=1),
        reason_code="PUNCH_IMPORTED",
        now=NOW,
    )

    result = drain_evaluation_queue(db_session, now=NOW + timedelta(seconds=1))

    assert (result.leased, result.completed, result.failed) == (1, 1, 0)
    assert _pending_rows(db_session, employee.id) == []


def _terminal_and_live_rows(db_session):
    """Drive one row to terminal failure and leave a second still retrying."""
    employee = _employee(db_session)
    for offset in (2, 1):
        enqueue_evaluation(
            db_session,
            employee_id=employee.id,
            window_start_at=NOW + timedelta(days=offset),
            window_end_at=NOW + timedelta(days=offset, hours=1),
            reason_code="POLICY_CHANGED",
            now=NOW + timedelta(seconds=offset),
        )

    def always_fail(db, row):
        raise RuntimeError("deterministic evaluation failure")

    for attempt in range(9):
        drain_evaluation_queue(
            db_session,
            now=NOW + timedelta(seconds=1, hours=attempt),
            batch_size=1,
            evaluate=always_fail,
        )
    terminal, live = _pending_rows(db_session, employee.id)
    assert terminal.failed_at is not None
    assert live.failed_at is None
    return terminal, live


def test_retry_revives_a_terminal_row_with_a_fresh_budget_and_audits_it(db_session):
    terminal, _live = _terminal_and_live_rows(db_session)
    retried_at = NOW + timedelta(days=1)

    row = retry_evaluation_queue_item(
        db_session, queue_id=terminal.id, now=retried_at, actor_user_id=7
    )

    # Terminal visibility is cleared and the row becomes claimable again.
    assert row.failed_at is None
    assert row.attempts == 0
    assert row.lease_until is None
    assert row.last_error_code is None
    assert row.available_at == _db_utc(retried_at)
    # The retry itself stays in the audit trail even though the row's own
    # error fields were cleared to grant the new budget.
    entry = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "workforce.evaluation_queue.retried")
    ).one()
    assert entry.entity_id == str(terminal.id)
    assert entry.actor == "7"


def test_retry_refuses_a_live_row_so_it_cannot_steal_an_active_lease(db_session):
    """A non-terminal row may be leased by the drain right now.

    Clearing that lease would let a second drain claim the same row and evaluate
    the same case twice. Retry is specified for failed evaluations only, so a
    live row must be rejected and left byte-for-byte intact.
    """
    _terminal, live = _terminal_and_live_rows(db_session)
    # Simulate the drain holding a lease on it.
    live.lease_until = _db_utc(NOW + timedelta(minutes=5))
    db_session.flush()
    before = (live.attempts, live.lease_until, live.available_at, live.last_error_code)

    with pytest.raises(ValidationFailedError) as err:
        retry_evaluation_queue_item(
            db_session, queue_id=live.id, now=NOW + timedelta(days=1), actor_user_id=7
        )

    assert err.value.code == "ATTENDANCE_EVALUATION_QUEUE_NOT_TERMINAL"
    db_session.refresh(live)
    assert (live.attempts, live.lease_until, live.available_at, live.last_error_code) == before
    # A refused retry is not an audited event.
    assert db_session.scalars(
        select(AuditLog).where(AuditLog.action == "workforce.evaluation_queue.retried")
    ).all() == []
