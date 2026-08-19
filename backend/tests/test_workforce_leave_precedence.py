"""RED contracts for lifecycle-aware workforce leave resolution.

The workforce decision is intentionally independent of the legacy dashboard's generic
``Leave.status == \"Approved\"`` predicate.  These tests use persisted Leave rows so
both lifecycle classification and date-range behavior remain observable contracts.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.db.models import Employee, Leave
from app.services.workforce_leave import (
    affected_reevaluation_windows,
    resolve_excusing_leave,
    summarize_lifecycle_live_leave,
)

DUBAI = ZoneInfo("Asia/Dubai")
NIGHT_START_UTC = datetime(2026, 8, 18, 20, tzinfo=DUBAI).astimezone(UTC)
NIGHT_END_UTC = datetime(2026, 8, 19, 4, tzinfo=DUBAI).astimezone(UTC)


def _employee(db, employee_id: str) -> Employee:
    employee = Employee(
        id=employee_id,
        name_en=f"Employee {employee_id}",
        name_ar="موظف",
        status="Active",
    )
    db.add(employee)
    db.flush()
    return employee


def _leave(
    db,
    *,
    employee_id: str,
    leave_type: str,
    start_date: date,
    end_date: date,
    status: str,
    days: int = 1,
) -> Leave:
    leave = Leave(
        employee_id=employee_id,
        leave_type=leave_type,
        start_date=start_date,
        end_date=end_date,
        status=status,
        days=days,
    )
    db.add(leave)
    db.flush()
    return leave


def _resolve(db, employee_id: str, operational_date: date):
    starts_at = datetime.combine(operational_date, datetime.min.time(), tzinfo=UTC)
    return resolve_excusing_leave(
        db,
        employee_id=employee_id,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=8),
    )


def test_approved_annual_and_born_approved_sick_excuse_but_approved_permit_does_not(
    db_session,
):
    annual_employee = _employee(db_session, "G-ANNUAL")
    sick_employee = _employee(db_session, "G-SICK")
    permit_employee = _employee(db_session, "G-PERMIT")
    operational_date = date(2026, 8, 18)
    annual = _leave(
        db_session,
        employee_id=annual_employee.id,
        leave_type="Annual Leave",
        start_date=operational_date,
        end_date=operational_date,
        status="Approved",
    )
    sick = _leave(
        db_session,
        employee_id=sick_employee.id,
        leave_type="Sick Leave",
        start_date=operational_date,
        end_date=operational_date,
        status="Approved",
    )
    _leave(
        db_session,
        employee_id=permit_employee.id,
        leave_type="Leave Permit",
        start_date=operational_date,
        end_date=operational_date,
        status="Approved",
    )
    db_session.commit()

    annual_resolution = _resolve(db_session, annual_employee.id, operational_date)
    sick_resolution = _resolve(db_session, sick_employee.id, operational_date)

    assert annual_resolution.reason_code == "LEAVE_ANNUAL"
    assert annual_resolution.source_leave_ids == (annual.id,)
    assert sick_resolution.reason_code == "LEAVE_SICK"
    assert sick_resolution.source_leave_ids == (sick.id,)
    assert _resolve(db_session, permit_employee.id, operational_date) is None


def test_pending_national_service_excuses_but_cancelled_national_service_and_pending_annual_do_not(
    db_session,
):
    pending_service_employee = _employee(db_session, "G-NS-PENDING")
    cancelled_service_employee = _employee(db_session, "G-NS-CANCELLED")
    pending_annual_employee = _employee(db_session, "G-ANNUAL-PENDING")
    operational_date = date(2026, 8, 18)
    national_service = _leave(
        db_session,
        employee_id=pending_service_employee.id,
        leave_type="National Service",
        start_date=operational_date,
        end_date=operational_date,
        status="Pending",
    )
    _leave(
        db_session,
        employee_id=cancelled_service_employee.id,
        leave_type="National Service",
        start_date=operational_date,
        end_date=operational_date,
        status="Cancelled",
    )
    _leave(
        db_session,
        employee_id=pending_annual_employee.id,
        leave_type="Annual Leave",
        start_date=operational_date,
        end_date=operational_date,
        status="Pending",
    )
    db_session.commit()

    pending_resolution = _resolve(db_session, pending_service_employee.id, operational_date)
    assert pending_resolution.reason_code == "LEAVE_NATIONAL_SERVICE"
    assert pending_resolution.source_leave_ids == (national_service.id,)
    assert _resolve(db_session, cancelled_service_employee.id, operational_date) is None
    assert _resolve(db_session, pending_annual_employee.id, operational_date) is None


def test_overlapping_lifecycle_live_rows_keep_all_sources_and_use_national_service_priority(
    db_session,
):
    employee = _employee(db_session, "G-OVERLAP")
    operational_date = date(2026, 8, 18)
    annual = _leave(
        db_session,
        employee_id=employee.id,
        leave_type="Annual Leave",
        start_date=operational_date,
        end_date=operational_date,
        status="Approved",
    )
    sick = _leave(
        db_session,
        employee_id=employee.id,
        leave_type="Sick Leave",
        start_date=operational_date,
        end_date=operational_date,
        status="Approved",
    )
    national_service = _leave(
        db_session,
        employee_id=employee.id,
        leave_type="National Service",
        start_date=operational_date,
        end_date=operational_date,
        status="Pending",
    )
    db_session.commit()

    resolution = _resolve(db_session, employee.id, operational_date)

    assert resolution.reason_code == "LEAVE_NATIONAL_SERVICE"
    assert set(resolution.source_leave_ids) == {annual.id, sick.id, national_service.id}


def test_night_leave_compares_to_dubai_operational_start_date_not_end_or_utc_day(
    db_session,
):
    employee = _employee(db_session, "G-NIGHT")
    # The Night occurrence starts Tuesday 20:00 Dubai and ends Wednesday 04:00.
    # A Tuesday Annual leave is excusing; an otherwise higher-priority Wednesday
    # Sick row is not attached to this occurrence.
    tuesday_annual = _leave(
        db_session,
        employee_id=employee.id,
        leave_type="Annual Leave",
        start_date=date(2026, 8, 18),
        end_date=date(2026, 8, 18),
        status="Approved",
    )
    _leave(
        db_session,
        employee_id=employee.id,
        leave_type="Sick Leave",
        start_date=date(2026, 8, 19),
        end_date=date(2026, 8, 19),
        status="Approved",
    )
    db_session.commit()

    resolution = resolve_excusing_leave(
        db_session,
        employee_id=employee.id,
        starts_at=NIGHT_START_UTC,
        ends_at=NIGHT_END_UTC,
    )

    assert resolution.operational_date == date(2026, 8, 18)
    assert resolution.reason_code == "LEAVE_ANNUAL"
    assert resolution.source_leave_ids == (tuesday_annual.id,)


def test_live_leave_headcount_is_distinct_from_employee_day_totals_and_ignores_stored_days(
    db_session,
):
    annual_employee = _employee(db_session, "G-METRICS-ANNUAL")
    sick_employee = _employee(db_session, "G-METRICS-SICK")
    _leave(
        db_session,
        employee_id=annual_employee.id,
        leave_type="Annual Leave",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 3),
        status="Approved",
        days=99,
    )
    _leave(
        db_session,
        employee_id=sick_employee.id,
        leave_type="Sick Leave",
        start_date=date(2026, 8, 3),
        end_date=date(2026, 8, 5),
        status="Approved",
        days=77,
    )
    db_session.commit()

    summary = summarize_lifecycle_live_leave(
        db_session,
        employee_ids=(annual_employee.id, sick_employee.id),
        local_date=date(2026, 8, 3),
        period_start=date(2026, 8, 1),
        period_end=date(2026, 8, 5),
    )

    assert summary.live_headcount == 2
    assert summary.employee_days == 6


@pytest.mark.parametrize(
    ("leave_type", "before_status", "after_status"),
    [
        ("Annual Leave", "Pending", "Approved"),
        ("Sick Leave", "Pending", "Approved"),
        ("Annual Leave", "Approved", "Cancelled"),
        ("National Service", "Pending", "Completed"),
    ],
)
def test_relevant_leave_lifecycle_changes_identify_the_full_reevaluation_window(
    db_session,
    leave_type: str,
    before_status: str,
    after_status: str,
):
    employee = _employee(db_session, "G-REEVALUATE")
    changed = _leave(
        db_session,
        employee_id=employee.id,
        leave_type=leave_type,
        start_date=date(2026, 8, 18),
        end_date=date(2026, 8, 20),
        status=before_status,
    )
    db_session.commit()
    before = Leave(
        id=changed.id,
        employee_id=changed.employee_id,
        leave_type=changed.leave_type,
        start_date=changed.start_date,
        end_date=changed.end_date,
        status=changed.status,
        days=changed.days,
    )
    changed.status = after_status
    db_session.commit()

    windows = affected_reevaluation_windows(before=before, after=changed)

    assert [
        (window.employee_id, window.start_date, window.end_date)
        for window in windows
    ] == [(employee.id, date(2026, 8, 18), date(2026, 8, 20))]


def test_leave_amendment_reevaluates_the_union_of_old_and_new_operational_dates(
    db_session,
):
    employee = _employee(db_session, "G-REEVALUATE-AMEND")
    changed = _leave(
        db_session,
        employee_id=employee.id,
        leave_type="Annual Leave",
        start_date=date(2026, 8, 18),
        end_date=date(2026, 8, 20),
        status="Approved",
    )
    db_session.commit()
    before = Leave(
        id=changed.id,
        employee_id=changed.employee_id,
        leave_type=changed.leave_type,
        start_date=changed.start_date,
        end_date=changed.end_date,
        status=changed.status,
        days=changed.days,
    )
    changed.start_date = date(2026, 8, 17)
    changed.end_date = date(2026, 8, 22)
    db_session.commit()

    windows = affected_reevaluation_windows(before=before, after=changed)

    assert [
        (window.employee_id, window.start_date, window.end_date)
        for window in windows
    ] == [(employee.id, date(2026, 8, 17), date(2026, 8, 22))]
