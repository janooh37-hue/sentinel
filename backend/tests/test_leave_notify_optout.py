"""The per-approval notify opt-out: LeaveUpdate.notify_employee gates the
best-effort leave-status notification. Default True keeps notifying."""

from datetime import date

from app.db.models import Employee, Leave
from app.schemas.leave import LeaveUpdate
from app.services import leave_service, notify_dispatch


def _pending_leave(db, lid: int) -> None:
    if db.get(Employee, "G1") is None:
        db.add(Employee(id="G1", name_en="John", name_ar="جون", contact="0501234567"))
    db.add(
        Leave(
            id=lid,
            employee_id="G1",
            leave_type="Annual Leave",
            start_date=date(2026, 7, 5),
            end_date=date(2026, 7, 9),
            days=5,
            status="Pending",
        )
    )
    db.commit()


def test_approve_with_notify_off_does_not_notify(db_session, monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(
        notify_dispatch, "auto_send_leave_status", lambda db, lid, **k: calls.append(lid)
    )
    _pending_leave(db_session, 71)
    leave_service.update_leave(
        db_session, 71, LeaveUpdate(status="Approved", notify_employee=False)
    )
    assert calls == []


def test_approve_notifies_by_default(db_session, monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(
        notify_dispatch, "auto_send_leave_status", lambda db, lid, **k: calls.append(lid)
    )
    _pending_leave(db_session, 72)
    leave_service.update_leave(db_session, 72, LeaveUpdate(status="Approved"))
    assert calls == [72]
