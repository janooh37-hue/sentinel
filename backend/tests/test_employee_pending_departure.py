"""Scheduled departures — a future-dated resignation or termination keeps the
employee Active through their notice period, then flips on the day.

Pending departure ⇔ status == 'Active' AND pending_status IS NOT NULL AND
end_date IS NOT NULL. `status` deliberately stays 'Active' while pending so
every active-roster query keeps treating the person as the working employee
they still are.
"""

from datetime import date, timedelta

from app.db.models import Employee
from app.schemas.employee import EmployeeUpdate
from app.services import employee_service


def test_pending_status_defaults_to_none(db_session):
    row = Employee(id="G9101", name_en="Pending Default", status="Active")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.pending_status is None


def test_pending_status_round_trips(db_session):
    row = Employee(
        id="G9102",
        name_en="Pending Resigned",
        status="Active",
        end_date=date(2026, 8, 15),
        pending_status="Resigned",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.pending_status == "Resigned"
    assert row.status == "Active"
    assert row.end_date == date(2026, 8, 15)


def test_list_item_projection_exposes_the_pending_fields(db_session):
    """The widget and search badge read the LIST endpoint, not the detail one."""
    from app.schemas.employee import EmployeeListItem

    row = Employee(
        id="G9103",
        name_en="Pending Projection",
        status="Active",
        end_date=date(2026, 8, 15),
        pending_status="Resigned",
    )
    db_session.add(row)
    db_session.commit()
    item = EmployeeListItem.model_validate(row)
    assert item.pending_status == "Resigned"
    assert item.end_date == date(2026, 8, 15)


def _make(db_session, employee_id: str, **kw) -> Employee:
    row = Employee(id=employee_id, name_en=f"Emp {employee_id}", status="Active", **kw)
    db_session.add(row)
    db_session.commit()
    return row


def test_future_dated_resignation_is_scheduled_not_applied(db_session):
    _make(db_session, "G9110")
    future = date.today() + timedelta(days=16)
    out = employee_service.update_employee(
        db_session, "G9110", EmployeeUpdate(status="Resigned", end_date=future)
    )
    assert out.status == "Active", "still working through the notice period"
    assert out.pending_status == "Resigned"
    assert out.end_date == future


def test_future_dated_termination_is_scheduled_too(db_session):
    _make(db_session, "G9111")
    future = date.today() + timedelta(days=3)
    out = employee_service.update_employee(
        db_session, "G9111", EmployeeUpdate(status="Terminated", end_date=future)
    )
    assert out.status == "Active"
    assert out.pending_status == "Terminated"


def test_today_dated_departure_applies_immediately(db_session):
    """Someone who walked off site today still flips now — existing behaviour."""
    _make(db_session, "G9112")
    out = employee_service.update_employee(
        db_session, "G9112", EmployeeUpdate(status="Terminated", end_date=date.today())
    )
    assert out.status == "Terminated"
    assert out.pending_status is None


def test_past_dated_departure_applies_immediately(db_session):
    _make(db_session, "G9113")
    past = date.today() - timedelta(days=5)
    out = employee_service.update_employee(
        db_session, "G9113", EmployeeUpdate(status="Resigned", end_date=past)
    )
    assert out.status == "Resigned"
    assert out.pending_status is None


def test_reactivating_cancels_a_pending_departure(db_session):
    """This is the Cancel path — the widget sends exactly this patch."""
    _make(
        db_session,
        "G9114",
        end_date=date.today() + timedelta(days=10),
        pending_status="Resigned",
    )
    out = employee_service.update_employee(
        db_session, "G9114", EmployeeUpdate(status="Active", end_date=None)
    )
    assert out.status == "Active"
    assert out.pending_status is None
    assert out.end_date is None


def test_clearing_only_the_end_date_cancels_too(db_session):
    _make(
        db_session,
        "G9115",
        end_date=date.today() + timedelta(days=10),
        pending_status="Terminated",
    )
    out = employee_service.update_employee(db_session, "G9115", EmployeeUpdate(end_date=None))
    assert out.pending_status is None


def test_unrelated_patch_preserves_the_pending_departure(db_session):
    """Editing a department must not silently cancel a scheduled departure."""
    future = date.today() + timedelta(days=10)
    _make(db_session, "G9116", end_date=future, pending_status="Resigned")
    out = employee_service.update_employee(
        db_session, "G9116", EmployeeUpdate(department="Operations")
    )
    assert out.pending_status == "Resigned"
    assert out.end_date == future


def test_moving_the_date_reschedules_without_losing_the_target(db_session):
    _make(
        db_session,
        "G9117",
        end_date=date.today() + timedelta(days=10),
        pending_status="Resigned",
    )
    later = date.today() + timedelta(days=20)
    out = employee_service.update_employee(db_session, "G9117", EmployeeUpdate(end_date=later))
    assert out.pending_status == "Resigned"
    assert out.end_date == later


def test_non_active_without_end_date_still_rejected(db_session):
    """The existing invariant must survive: no end date, no departure."""
    import pytest

    from app.api.errors import ValidationFailedError

    _make(db_session, "G9118")
    with pytest.raises(ValidationFailedError):
        employee_service.update_employee(db_session, "G9118", EmployeeUpdate(status="Resigned"))


def test_immediate_departure_clears_a_stale_pending_marker(db_session):
    """An immediate departure supersedes an earlier scheduled one — the
    marker must not outlive it, or a now-Terminated employee could keep
    showing a stale 'Resigned' badge from before."""
    _make(
        db_session,
        "G9119",
        end_date=date.today() + timedelta(days=10),
        pending_status="Resigned",
    )
    out = employee_service.update_employee(
        db_session, "G9119", EmployeeUpdate(status="Terminated", end_date=date.today())
    )
    assert out.status == "Terminated"
    assert out.end_date == date.today()
    assert out.pending_status is None


def test_immediate_departure_clears_a_stale_pending_marker_mirrored(db_session):
    """Same supersede case, mirrored: immediate Resigned over a pending Terminated."""
    _make(
        db_session,
        "G9120",
        end_date=date.today() + timedelta(days=10),
        pending_status="Terminated",
    )
    out = employee_service.update_employee(
        db_session, "G9120", EmployeeUpdate(status="Resigned", end_date=date.today())
    )
    assert out.status == "Resigned"
    assert out.pending_status is None
