"""Leaves that excuse attendance but are missing from the latest evaluation get requeued.

Rollout guard for the widened excusal rule: a Duty Leave or other newly excusing
kind approved before the rule shipped never enqueued re-evaluation, so its days
still read absent.  Reconciliation finds exactly those cases, inside the bounded
look-back, and is a no-op once the evaluator has caught up.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.db.models import Leave, User
from app.db.workforce_models import AttendanceEvaluation, AttendanceEvaluationQueue
from app.schemas.workforce import WorkforceConfiguration
from app.services import attendance_queue_service, scheduler_service, settings_service
from app.services.attendance_evaluation_service import evaluate_case
from app.services.workforce_leave import enqueue_unreflected_leave_excusals
from tests.test_attendance_evaluation_service import UTC_NOW, _seed_case

CASE_DATE = date(2026, 8, 17)


def _queue(db):
    return db.scalars(select(AttendanceEvaluationQueue)).all()


def _leave(db, case, leave_type: str, status: str = "Approved") -> Leave:
    leave = Leave(
        employee_id=case.employee_id,
        leave_type=leave_type,
        start_date=CASE_DATE - timedelta(days=1),
        end_date=CASE_DATE + timedelta(days=1),
        days=3,
        status=status,
    )
    # Added directly, as a pre-rollout approval was: no re-evaluation enqueued.
    db.add(leave)
    db.flush()
    return leave


def _stale_case(db, leave_type: str = "Duty Leave"):
    case = _seed_case(db)
    baseline = evaluate_case(db, case.id, evaluated_at=UTC_NOW)
    assert baseline.presence_state == "absent"
    leave = _leave(db, case, leave_type)
    assert _queue(db) == []
    return case, leave


def _latest(db, case_id: int) -> AttendanceEvaluation:
    return db.scalars(
        select(AttendanceEvaluation)
        .where(AttendanceEvaluation.attendance_case_id == case_id)
        .order_by(AttendanceEvaluation.revision.desc())
    ).first()


@pytest.mark.parametrize("leave_type", ["Duty Leave", "Hajj Leave", "Administrative Leave"])
def test_enqueues_the_case_day_of_an_excusing_leave_the_evaluation_misses(db_session, leave_type):
    case, _ = _stale_case(db_session, leave_type)

    queued = enqueue_unreflected_leave_excusals(
        db_session, since=date(2026, 8, 1), until=CASE_DATE, now=UTC_NOW
    )

    assert queued == 1
    [row] = _queue(db_session)
    assert row.employee_id == case.employee_id
    # The case's Dubai operational day as a half-open naive-UTC window.
    assert (row.window_start_at, row.window_end_at) == (
        datetime(2026, 8, 16, 20),
        datetime(2026, 8, 17, 20),
    )
    assert row.reason_codes == ["LEAVE_APPROVED"]


def test_draining_the_requeued_work_excuses_the_day_and_a_rerun_is_a_no_op(db_session):
    case, leave = _stale_case(db_session)
    enqueue_unreflected_leave_excusals(
        db_session, since=date(2026, 8, 1), until=CASE_DATE, now=UTC_NOW
    )

    attendance_queue_service.drain_evaluation_queue(db_session, now=UTC_NOW)

    latest = _latest(db_session, case.id)
    assert (latest.presence_state, latest.reason_code) == ("excused_leave", "LEAVE_DUTY")
    assert [source.leave_id for source in latest.leave_sources] == [leave.id]
    assert _queue(db_session) == []
    assert (
        enqueue_unreflected_leave_excusals(
            db_session, since=date(2026, 8, 1), until=CASE_DATE, now=UTC_NOW
        )
        == 0
    )
    assert _queue(db_session) == []


@pytest.mark.parametrize(
    ("since", "until"),
    [
        (CASE_DATE + timedelta(days=1), CASE_DATE + timedelta(days=5)),
        (date(2026, 8, 1), date(2026, 8, 16)),
    ],
)
def test_cases_outside_the_look_back_are_left_alone(db_session, since, until):
    _stale_case(db_session)

    assert (
        enqueue_unreflected_leave_excusals(db_session, since=since, until=until, now=UTC_NOW) == 0
    )
    assert _queue(db_session) == []


@pytest.mark.parametrize(
    ("leave_type", "status"),
    [
        ("Leave Permit", "Approved"),
        ("Passport Release", "Approved"),
        ("Duty Leave", "Pending"),
        ("Hajj Leave", "Cancelled"),
    ],
)
def test_non_excusing_leaves_never_requeue(db_session, leave_type, status):
    case = _seed_case(db_session)
    evaluate_case(db_session, case.id, evaluated_at=UTC_NOW)
    _leave(db_session, case, leave_type, status)

    assert (
        enqueue_unreflected_leave_excusals(
            db_session, since=date(2026, 8, 1), until=CASE_DATE, now=UTC_NOW
        )
        == 0
    )


def test_a_case_never_evaluated_is_left_to_its_normal_first_evaluation(db_session):
    case = _seed_case(db_session)
    _leave(db_session, case, "Duty Leave")

    assert (
        enqueue_unreflected_leave_excusals(
            db_session, since=date(2026, 8, 1), until=CASE_DATE, now=UTC_NOW
        )
        == 0
    )


def _configure(db, *, evaluation_start_at: datetime, retention_days: int) -> None:
    actor = db.scalars(select(User)).first()
    settings_service.update_workforce_configuration(
        db,
        WorkforceConfiguration(
            integration_enabled=True,
            sync_interval_minutes=10,
            stale_after_minutes=90,
            initial_backfill_start_at=evaluation_start_at,
            evaluation_start_at=evaluation_start_at,
            nationality_fold_min_count=3,
            excusing_record_kinds=["annual", "sick"],
            provider_person_retention_days=3650,
            punch_retention_days=3650,
            attendance_retention_days=retention_days,
            duty_event_retention_days=3650,
            audit_retention_days=3650,
        ),
        actor=actor.email,
    )


def test_scheduler_reconciliation_is_dormant_without_configuration(db_session):
    _stale_case(db_session)

    assert scheduler_service._reconcile_leave_excusals(db_session, now=UTC_NOW) == 0
    assert _queue(db_session) == []


@pytest.mark.parametrize(
    ("evaluation_start_at", "retention_days", "expected"),
    [
        (datetime(2026, 8, 1, tzinfo=UTC), 3650, 1),
        # The case predates evaluation start: the evaluator would skip it anyway.
        (datetime(2026, 8, 18, tzinfo=UTC), 3650, 0),
        # The case is older than the attendance retention window.
        (datetime(2026, 8, 1, tzinfo=UTC), 7, 0),
    ],
)
def test_scheduler_reconciliation_bounds_by_evaluation_start_and_retention(
    db_session, evaluation_start_at, retention_days, expected
):
    _stale_case(db_session)
    _configure(db_session, evaluation_start_at=evaluation_start_at, retention_days=retention_days)
    now = datetime(2026, 8, 30, 8, tzinfo=UTC)  # 13 days after the case

    assert scheduler_service._reconcile_leave_excusals(db_session, now=now) == expected
    assert len(_queue(db_session)) == expected
