"""Leaves that excuse attendance but are missing from the latest evaluation get requeued.

Rollout guard for the widened excusal rule: a Duty Leave or other newly excusing
kind approved before the rule shipped never enqueued re-evaluation, so its days
still read absent.  Reconciliation finds exactly those cases, inside the bounded
look-back, and is a no-op once the evaluator has caught up.

Reconciliation must also handle retained histories and employee populations larger
than SQLite's bind-variable limit; tests lower that limit on the real connection.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.db.models import Employee, Leave, User
from app.db.workforce_models import AttendanceCase, AttendanceEvaluation, AttendanceEvaluationQueue
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


@pytest.mark.parametrize("many_employees", [False, True], ids=["many-days", "many-employees"])
def test_reconciliation_enqueues_all_days_above_sqlite_variable_limit(db_session, many_employees):
    first = _seed_case(db_session)
    baseline = evaluate_case(db_session, first.id, evaluated_at=UTC_NOW)
    since = CASE_DATE - timedelta(days=64)
    cases = [first]
    for index in range(1, 65):
        employee_id = f"G-BINDS-{index}" if many_employees else first.employee_id
        day = CASE_DATE if many_employees else CASE_DATE - timedelta(days=index)
        if many_employees:
            db_session.add(
                Employee(id=employee_id, name_en="Reconciliation Tester", status="Active")
            )
            db_session.flush()
        start = datetime.combine(day, first.scheduled_start_at.time())
        case = AttendanceCase(
            employee_id=employee_id,
            shift_occurrence_id=first.shift_occurrence_id,
            employee_status_snapshot="Active",
            shift_code_snapshot=first.shift_code_snapshot,
            scheduled_start_at=start,
            scheduled_end_at=start + timedelta(hours=8),
            operational_date=day,
            organization_snapshot_state="captured",
        )
        db_session.add(case)
        db_session.flush()
        db_session.add(
            AttendanceEvaluation(
                attendance_case_id=case.id,
                revision=1,
                presence_state=baseline.presence_state,
                reason_code=baseline.reason_code,
                algorithm_version=baseline.algorithm_version,
                input_fingerprint=f"pre-excusal-{case.id}",
                evaluated_at=UTC_NOW,
            )
        )
        cases.append(case)
    for employee_id in {case.employee_id for case in cases}:
        db_session.add(
            Leave(
                employee_id=employee_id,
                leave_type="Duty Leave",
                status="Approved",
                start_date=since,
                end_date=CASE_DATE,
                days=65,
            )
        )
    db_session.flush()

    connection = db_session.connection().connection.driver_connection
    previous_limit = connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 64)
    try:
        queued = enqueue_unreflected_leave_excusals(
            db_session,
            since=since,
            until=CASE_DATE,
            now=UTC_NOW,
            evaluation_start_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
    finally:
        connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, previous_limit)

    assert queued == 65
    rows = _queue(db_session)
    assert len(rows) == 65
    assert {(row.employee_id, row.window_start_at, row.window_end_at) for row in rows} == {
        (
            case.employee_id,
            datetime.combine(case.operational_date, datetime.min.time()) - timedelta(hours=4),
            datetime.combine(case.operational_date, datetime.min.time()) + timedelta(hours=20),
        )
        for case in cases
    }
    assert all(row.reason_codes == ["LEAVE_APPROVED"] for row in rows)


def test_non_excusing_employee_stays_unqueued_alongside_an_excusing_employee(db_session):
    case, _ = _stale_case(db_session)
    db_session.add(Employee(id="G-NON-EXCUSING", name_en="Non-excusing Leave", status="Active"))
    db_session.flush()
    other = AttendanceCase(
        employee_id="G-NON-EXCUSING",
        shift_occurrence_id=case.shift_occurrence_id,
        employee_status_snapshot="Active",
        shift_code_snapshot=case.shift_code_snapshot,
        scheduled_start_at=case.scheduled_start_at,
        scheduled_end_at=case.scheduled_end_at,
        operational_date=CASE_DATE,
        organization_snapshot_state="captured",
    )
    db_session.add(other)
    db_session.flush()
    evaluate_case(db_session, other.id, evaluated_at=UTC_NOW)
    _leave(db_session, other, "Leave Permit")

    assert (
        enqueue_unreflected_leave_excusals(
            db_session, since=date(2026, 8, 1), until=CASE_DATE, now=UTC_NOW
        )
        == 1
    )
    assert [row.employee_id for row in _queue(db_session)] == [case.employee_id]


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
