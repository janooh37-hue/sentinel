# backend/tests/test_whatsapp_service.py
from datetime import date

import pytest

from app.db.models import Employee, Leave, Violation
from app.services import whatsapp_client, whatsapp_service as ws


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    monkeypatch.setenv("GSSG_WHATSAPP_ENABLED", "1")
    monkeypatch.setenv("GSSG_WHATSAPP_TOKEN", "tok")
    monkeypatch.setenv("GSSG_WHATSAPP_PHONE_NUMBER_ID", "PNID")
    from app.config import get_settings
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _leave(db, **kw):
    db.add(Employee(id="G1", name_en="John", name_ar="جون",
                    contact=kw.pop("contact", "0501234567"),
                    msg_language=kw.pop("lang", "ar")))
    row = Leave(id=7, employee_id="G1", leave_type="Annual - سنوية",
                start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5,
                status="Approved")
    db.add(row)
    db.commit()
    return row


def test_send_success_logs_sent(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        whatsapp_client, "send_text",
        lambda *a, **k: whatsapp_client.SendResult(ok=True, message_id="wamid.1"),
    )
    row = ws.send_for_event(db_session, "leave_approved", 7, sent_by=99)
    assert row.status == "sent"
    assert row.provider_msg_id == "wamid.1"
    assert row.phone == "+971501234567"
    assert row.template == "leave_approved_ar"
    assert row.sent_by == 99
    assert ws.last_status(db_session, "leave_approved", 7).id == row.id


def test_missing_phone_logs_failed_without_calling_client(db_session, monkeypatch):
    _leave(db_session, contact="n/a")
    called = {"n": 0}
    def boom(*a, **k):
        called["n"] += 1
        raise AssertionError("client must not be called")
    monkeypatch.setattr(whatsapp_client, "send_text", boom)
    row = ws.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert "phone" in row.error.lower()
    assert called["n"] == 0


def test_api_failure_logs_failed_with_error(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        whatsapp_client, "send_text",
        lambda *a, **k: whatsapp_client.SendResult(ok=False, error="Invalid number"),
    )
    row = ws.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert row.error == "Invalid number"


def test_disabled_raises(db_session, monkeypatch):
    monkeypatch.setenv("GSSG_WHATSAPP_ENABLED", "0")
    from app.config import get_settings
    get_settings.cache_clear()
    _leave(db_session)
    with pytest.raises(ws.WhatsAppDisabledError):
        ws.send_for_event(db_session, "leave_approved", 7, sent_by=1)


def test_unknown_record_raises(db_session):
    with pytest.raises(ws.RecordNotFoundError):
        ws.send_for_event(db_session, "leave_approved", 9999, sent_by=1)
