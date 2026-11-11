"""Pending-leave date edits from the Leaves page: lifecycle gate, day recompute,
edit-then-approve, and the natural-key duplicate guard (update and amend)."""

from datetime import date

import pytest

from app.api.errors import ValidationFailedError
from app.db.models import Employee, Leave
from app.schemas.leave import LeaveUpdate
from app.services import leave_service


@pytest.fixture(autouse=True)
def _no_notifications(monkeypatch):
    from app.services import notify_dispatch

    monkeypatch.setattr(notify_dispatch, "auto_send_leave_status", lambda *a, **k: None)
    monkeypatch.setattr(notify_dispatch, "auto_send_leave_amended", lambda *a, **k: None)


def _leave(db, *, leave_type="Annual Leave", status="Pending", start=None, end=None):
    if db.get(Employee, "GE1") is None:
        db.add(Employee(id="GE1", name_en="Edit Tester", name_ar="معدل", msg_language="en"))
        db.commit()
    start = start or date(2026, 8, 1)
    end = end or date(2026, 8, 10)
    row = Leave(
        employee_id="GE1",
        leave_type=leave_type,
        start_date=start,
        end_date=end,
        days=(end - start).days + 1,
        status=status,
    )
    db.add(row)
    db.commit()
    return row


def test_pending_annual_edit_moves_dates_recomputes_days_and_keeps_notes(db_session):
    leave = _leave(db_session)
    row = leave_service.update_leave(
        db_session,
        leave.id,
        LeaveUpdate(start_date=date(2026, 8, 3), end_date=date(2026, 8, 7), notes="moved"),
        actor="hr@x.ae",
    )
    assert (row.start_date, row.end_date, row.days) == (date(2026, 8, 3), date(2026, 8, 7), 5)
    assert row.notes == "moved"
    assert row.status == "Pending"


def test_pending_rare_request_kind_is_editable(db_session):
    leave = _leave(db_session, leave_type="Emergency Leave")
    row = leave_service.update_leave(db_session, leave.id, LeaveUpdate(end_date=date(2026, 8, 4)))
    assert row.days == 4


@pytest.mark.parametrize(
    ("leave_type", "status"),
    [
        ("Sick Leave", "Approved"),
        ("Annual Leave", "Approved"),
        ("Annual Leave", "Rejected"),
        ("Leave Permit", "Approved"),
    ],
)
def test_non_pending_or_non_request_dates_are_refused(db_session, leave_type, status):
    leave = _leave(db_session, leave_type=leave_type, status=status)
    with pytest.raises(ValidationFailedError) as exc:
        leave_service.update_leave(db_session, leave.id, LeaveUpdate(end_date=date(2026, 8, 5)))
    assert exc.value.code == "LEAVE_DATES_FORBIDDEN"
    db_session.refresh(leave)
    assert leave.end_date == date(2026, 8, 10)


def test_edit_then_approve(db_session):
    leave = _leave(db_session)
    leave_service.update_leave(db_session, leave.id, LeaveUpdate(end_date=date(2026, 8, 6)))
    row = leave_service.update_leave(db_session, leave.id, LeaveUpdate(status="Approved"))
    assert (row.status, row.end_date, row.days) == ("Approved", date(2026, 8, 6), 6)


def test_edit_onto_another_live_leave_is_a_validation_error(db_session):
    _leave(db_session, start=date(2026, 9, 1), end=date(2026, 9, 5))
    leave = _leave(db_session)
    with pytest.raises(ValidationFailedError) as exc:
        leave_service.update_leave(
            db_session,
            leave.id,
            LeaveUpdate(start_date=date(2026, 9, 1), end_date=date(2026, 9, 5)),
        )
    assert exc.value.code == "LEAVE_DUPLICATE"
    db_session.rollback()
    db_session.refresh(leave)
    assert leave.start_date == date(2026, 8, 1)


def test_edit_onto_a_deleted_leave_is_allowed(db_session):
    from datetime import UTC, datetime

    gone = _leave(db_session, start=date(2026, 9, 1), end=date(2026, 9, 5))
    gone.deleted_at = datetime.now(UTC)
    db_session.commit()
    leave = _leave(db_session)
    row = leave_service.update_leave(
        db_session,
        leave.id,
        LeaveUpdate(start_date=date(2026, 9, 1), end_date=date(2026, 9, 5)),
    )
    assert row.days == 5


def test_amend_onto_another_live_leave_is_a_validation_error(db_session):
    _leave(db_session, status="Approved", end=date(2026, 8, 5))
    leave = _leave(db_session, status="Approved")
    with pytest.raises(ValidationFailedError) as exc:
        leave_service.amend_approved_leave(
            db_session, leave.id, end_date=date(2026, 8, 5), reason="shorter"
        )
    assert exc.value.code == "LEAVE_DUPLICATE"
