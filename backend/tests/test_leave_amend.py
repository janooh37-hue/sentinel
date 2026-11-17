"""amend_approved_leave — lifecycle gate, day recompute, audit, notify hook."""

from datetime import date

import pytest
from pydantic import ValidationError

from app.api.errors import ValidationFailedError
from app.db.models import AuditLog, Employee, Leave
from app.schemas.leave import LeaveAmend
from app.services import leave_service


def _seed(db, *, leave_type="Annual Leave", status="Approved"):
    emp = Employee(
        id="GA1", name_en="Amend Tester", name_ar="معدل", msg_language="en", contact="0501234567"
    )
    db.add(emp)
    db.commit()
    leave = Leave(
        employee_id="GA1",
        leave_type=leave_type,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 25),
        days=25,
        status=status,
    )
    db.add(leave)
    db.commit()
    return leave


def test_amend_updates_end_days_notes_and_audits(db_session, monkeypatch):
    leave = _seed(db_session)
    calls: list[dict] = []
    from app.services import notify_dispatch

    monkeypatch.setattr(
        notify_dispatch,
        "auto_send_leave_amended",
        lambda db, lid, *, old_days, reason, sent_by=None: calls.append(
            {"lid": lid, "old_days": old_days, "reason": reason}
        ),
    )
    row = leave_service.amend_approved_leave(
        db_session,
        leave.id,
        end_date=date(2026, 8, 20),
        reason="Insufficient balance",
        actor="t@x.ae",
    )
    assert row.end_date == date(2026, 8, 20)
    assert row.days == 20
    assert row.notes == "Insufficient balance"
    assert calls == [{"lid": leave.id, "old_days": 25, "reason": "Insufficient balance"}]
    audit = db_session.query(AuditLog).filter(AuditLog.action == "leave.amended").all()
    assert len(audit) == 1


def test_amend_rejected_for_non_amendable_states(db_session):
    pending = _seed(db_session, status="Pending")
    with pytest.raises(ValidationFailedError):
        leave_service.amend_approved_leave(
            db_session, pending.id, end_date=date(2026, 8, 20), reason="x", actor=None
        )


def test_amend_rejects_end_before_start(db_session):
    leave = _seed(db_session)
    with pytest.raises(ValidationFailedError):
        leave_service.amend_approved_leave(
            db_session, leave.id, end_date=date(2026, 7, 31), reason="x", actor=None
        )


def test_amend_moves_start_date_of_any_approved_request_kind(db_session, monkeypatch):
    from app.services import notify_dispatch

    monkeypatch.setattr(notify_dispatch, "auto_send_leave_amended", lambda *a, **k: None)
    leave = _seed(db_session, leave_type="Emergency Leave")
    row = leave_service.amend_approved_leave(
        db_session,
        leave.id,
        start_date=date(2026, 8, 5),
        end_date=date(2026, 8, 25),
        reason="Travel moved",
        actor="t@x.ae",
    )
    assert (row.start_date, row.end_date, row.days, row.status) == (
        date(2026, 8, 5),
        date(2026, 8, 25),
        21,
        "Approved",
    )
    audit = db_session.query(AuditLog).filter(AuditLog.action == "leave.amended").one()
    assert '"start": "2026-08-01"' in audit.payload
    assert '"start": "2026-08-05"' in audit.payload


def test_amend_rejects_new_start_after_end(db_session):
    leave = _seed(db_session)
    with pytest.raises(ValidationFailedError):
        leave_service.amend_approved_leave(
            db_session,
            leave.id,
            start_date=date(2026, 8, 26),
            end_date=date(2026, 8, 25),
            reason="x",
            actor=None,
        )


def test_leave_amend_schema_requires_reason():
    with pytest.raises(ValidationError):
        LeaveAmend(end_date=date(2026, 8, 20), reason="   ")
