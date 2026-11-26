"""Local Workforce presence at a single duty path."""

from datetime import UTC, datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app.db.models import AppSetting, User
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationQueue,
    AttendanceSyncState,
)
from app.services import attendance_correction_service
from app.services.workforce_access_service import organization_scope
from app.services.workforce_dashboard_service import on_site_employee_ids_at_duty_path
from tests.test_attendance_punch_allocation import _case
from tests.test_workforce_dashboard_api import _add_employee, _create_user

NOW = datetime(2026, 1, 1, 10)
START = NOW - timedelta(hours=1)
END = NOW + timedelta(hours=1)
UNIT = "Test Unit"
POST = "Gate A"


@pytest.fixture(autouse=True)
def trusted_workforce(db_session: Session) -> User:
    admin = _create_user(db_session, email="presence-admin@example.test", role="admin")
    db_session.add_all(
        [
            AppSetting(key="workforce.stale_after_minutes", value="120"),
            AttendanceSyncState(
                provider="biotime",
                stream="punches",
                fresh_through=NOW,
                last_success_at=NOW,
                consecutive_failures=0,
                last_import_count=0,
            ),
        ]
    )
    db_session.flush()
    return admin


def _evaluation(
    case: AttendanceCase, *, revision: int = 1, final_out_at: datetime | None = None
) -> AttendanceEvaluation:
    return AttendanceEvaluation(
        attendance_case_id=case.id,
        revision=revision,
        presence_state="on_duty",
        first_in_at=START,
        latest_in_at=START,
        final_out_at=final_out_at,
        reason_code="PUNCH_IN_ACTIVE",
        sync_fresh_through=NOW,
        algorithm_version="v1",
        input_fingerprint=f"fixture-{case.id}-{revision}",
        evaluated_at=NOW,
    )


def _record_case(
    db: Session, employee_id: str, *, unit: str = UNIT, post: str = POST, evaluated: bool = True
) -> AttendanceCase:
    employee = _add_employee(db, employee_id, name=f"Test Employee {employee_id}")
    case = _case(db, employee=employee, starts_at=START, ends_at=END, suffix=employee_id)
    case.duty_unit_snapshot = unit
    case.duty_post_snapshot = post
    if evaluated:
        db.add(_evaluation(case))
    db.flush()
    return case


def test_exact_trimmed_path_includes_only_matching_employees(db_session: Session) -> None:
    _record_case(db_session, "G9001", unit=f" {UNIT}\t", post=f" {POST} ")
    _record_case(db_session, "G9002", post="gate a")
    _record_case(db_session, "G9003", unit="test unit")
    _record_case(db_session, "G9004", post="Gate B")
    local_now = NOW.replace(tzinfo=UTC).astimezone(timezone(timedelta(hours=4)))

    assert on_site_employee_ids_at_duty_path(
        db_session, duty_unit=f"{UNIT}\n", duty_post=f" {POST}\t", now=local_now
    ) == {"G9001"}


def test_queue_and_missing_evaluation_exclude_only_the_affected_cases(db_session: Session) -> None:
    _record_case(db_session, "G9001")
    _record_case(db_session, "G9002")
    _record_case(db_session, "G9003", evaluated=False)
    db_session.add(
        AttendanceEvaluationQueue(
            employee_id="G9002",
            window_start_at=START,
            window_end_at=END,
            reason_codes=["PUNCH_IMPORTED"],
            available_at=NOW,
            attempts=0,
        )
    )
    db_session.flush()

    assert on_site_employee_ids_at_duty_path(
        db_session, duty_unit=UNIT, duty_post=POST, now=NOW
    ) == {"G9001"}


def test_latest_evaluation_with_checkout_excludes_employee(db_session: Session) -> None:
    case = _record_case(db_session, "G9001")
    db_session.add(_evaluation(case, revision=2, final_out_at=NOW - timedelta(minutes=30)))
    db_session.flush()

    assert not on_site_employee_ids_at_duty_path(
        db_session, duty_unit=UNIT, duty_post=POST, now=NOW
    )


@pytest.mark.parametrize(
    ("now", "expected"),
    [(START - timedelta(seconds=1), set()), (START, {"G9001"}), (END, set())],
    ids=["before-start", "at-start", "at-end"],
)
def test_case_must_cover_the_requested_instant(
    db_session: Session, now: datetime, expected: set[str]
) -> None:
    _record_case(db_session, "G9001")

    assert (
        on_site_employee_ids_at_duty_path(db_session, duty_unit=UNIT, duty_post=POST, now=now)
        == expected
    )


@pytest.mark.parametrize("state", ["stale", "error"])
def test_untrusted_punch_feed_returns_no_employees(db_session: Session, state: str) -> None:
    _record_case(db_session, "G9001")
    punches = db_session.get(AttendanceSyncState, ("biotime", "punches"))
    assert punches is not None
    if state == "stale":
        punches.fresh_through = NOW - timedelta(hours=3)
    else:
        punches.last_error_code = "TEST_FEED_ERROR"
    db_session.flush()

    assert not on_site_employee_ids_at_duty_path(
        db_session, duty_unit=UNIT, duty_post=POST, now=NOW
    )


def test_active_correction_can_remove_automatic_presence(
    db_session: Session, trusted_workforce: User
) -> None:
    case = _record_case(db_session, "G9001")
    assert on_site_employee_ids_at_duty_path(
        db_session, duty_unit=UNIT, duty_post=POST, now=NOW
    ) == {"G9001"}

    attendance_correction_service.correct(
        db_session,
        scope=organization_scope(),
        case_id=case.id,
        snapshot={
            "replacement_presence_state": "absent",
            "replacement_first_in_at": START,
            "replacement_latest_in_at": START,
            "replacement_final_out_at": None,
            "replacement_late_minutes": None,
            "replacement_early_exit_minutes": None,
            "replacement_missing_checkout": False,
            "reason": "Confirmed test absence",
        },
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=trusted_workforce,
    )

    assert not on_site_employee_ids_at_duty_path(
        db_session, duty_unit=UNIT, duty_post=POST, now=NOW
    )
