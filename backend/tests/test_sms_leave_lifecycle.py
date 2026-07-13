"""Lifecycle + wording tests for leave notifications routed through notify_dispatch.

Covers:
- Template wording locked against regression (via sms_templates)
- Leave-status change triggers notify_dispatch and records a sent OutboundMessage
"""

from datetime import date

from app.db.models import Employee, Leave
from app.schemas.leave import LeaveUpdate
from app.services import leave_service, notify_dispatch, sms_client, sms_templates


def _leave(db, *, status: str, leave_type: str = "Annual Leave", lid: int = 7) -> Leave:
    if db.get(Employee, "G1") is None:
        db.add(
            Employee(
                id="G1", name_en="John", name_ar="جون", contact="0501234567", msg_language="en"
            )
        )
    row = Leave(
        id=lid,
        employee_id="G1",
        leave_type=leave_type,
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
        status=status,
    )
    db.add(row)
    db.commit()
    return row


def test_new_template_wording_locked():
    """Lock the bilingual wording (and the two AR reviewer fixes) against regression."""
    emp = Employee(id="G2", name_en="A", name_ar="أ", contact="050", msg_language="en")
    leave = Leave(
        id=8,
        employee_id="G2",
        leave_type="Annual Leave",
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
        status="Pending",
    )
    req_en = sms_templates.render_text("leave_requested", "en", leave, emp)
    req_ar = sms_templates.render_text("leave_requested", "ar", leave, emp)
    assert "has been received" in req_en and "processed" in req_en
    assert "تم استلام طلب إجازتك" in req_ar and "قيد المعالجة" in req_ar
    assert "سيتم إشعارك بالموافقة" in req_ar

    assert "not approved" in sms_templates.render_text("leave_rejected", "en", leave, emp)
    rej_ar = sms_templates.render_text("leave_rejected", "ar", leave, emp)
    assert "عدم الموافقة" in rej_ar and "مكتب الإدارة" in rej_ar

    assert "cancelled" in sms_templates.render_text("leave_cancelled", "en", leave, emp)
    can_ar = sms_templates.render_text("leave_cancelled", "ar", leave, emp)
    assert "تم إلغاء إجازتك" in can_ar and "مكتب الإدارة" in can_ar


def test_update_leave_status_change_triggers_sms(db_session, monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", "http://192.168.1.50:8080")
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
    from app.config import get_settings

    get_settings.cache_clear()
    calls = []

    def fake_send(phone, text):
        calls.append((phone, text))
        return sms_client.SendResult(ok=True, message_id=f"sms-{len(calls)}")

    monkeypatch.setattr(sms_client, "send", fake_send)

    _leave(db_session, status="Pending", leave_type="Annual Leave")
    leave_service.update_leave(db_session, 7, LeaveUpdate(status="Rejected"))
    # a leave_rejected notification was logged for this leave in outbound_messages
    last = notify_dispatch.last_status(db_session, "leave_rejected", 7)
    assert last is not None
    assert last.status == "sent"
    assert len(calls) == 1

    get_settings.cache_clear()
