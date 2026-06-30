from datetime import date

import pytest

from app.db.models import Employee, Leave
from app.services import sms_client, sms_service as ss


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "1")
    monkeypatch.setenv("GSSG_SMS_GATEWAY_URL", "http://192.168.1.50:8080")
    monkeypatch.setenv("GSSG_SMS_USERNAME", "user")
    monkeypatch.setenv("GSSG_SMS_PASSWORD", "pass")
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
        sms_client, "send",
        lambda *a, **k: sms_client.SendResult(ok=True, message_id="sms-1"),
    )
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=99)
    assert row.status == "sent"
    assert row.provider_msg_id == "sms-1"
    assert row.phone == "+971501234567"
    assert row.sent_by == 99
    assert ss.last_status(db_session, "leave_approved", 7).id == row.id


def test_send_passes_rendered_text_to_client(db_session, monkeypatch):
    _leave(db_session, lang="en")
    captured = {}

    def fake_send(phone, text):
        captured["phone"] = phone
        captured["text"] = text
        return sms_client.SendResult(ok=True, message_id="sms-2")

    monkeypatch.setattr(sms_client, "send", fake_send)
    ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert captured["phone"] == "+971501234567"
    assert captured["text"].startswith("Dear John,")
    assert captured["text"].endswith("Al Wathba Rehabilitation Centre")


def test_missing_phone_logs_failed_without_calling_client(db_session, monkeypatch):
    _leave(db_session, contact="n/a")
    called = {"n": 0}

    def boom(*a, **k):
        called["n"] += 1
        raise AssertionError("client must not be called")

    monkeypatch.setattr(sms_client, "send", boom)
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert "phone" in row.error.lower()
    assert called["n"] == 0


def test_api_failure_logs_failed_with_error(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        sms_client, "send",
        lambda *a, **k: sms_client.SendResult(ok=False, error="HTTP 401: Unauthorized"),
    )
    row = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert row.status == "failed"
    assert row.error == "HTTP 401: Unauthorized"


def test_resend_writes_new_row(db_session, monkeypatch):
    _leave(db_session)
    monkeypatch.setattr(
        sms_client, "send",
        lambda *a, **k: sms_client.SendResult(ok=True, message_id="sms-x"),
    )
    r1 = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    r2 = ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)
    assert r1.id != r2.id
    assert ss.last_status(db_session, "leave_approved", 7).id == r2.id


def test_disabled_raises(db_session, monkeypatch):
    monkeypatch.setenv("GSSG_SMS_ENABLED", "0")
    from app.config import get_settings
    get_settings.cache_clear()
    _leave(db_session)
    with pytest.raises(ss.SmsDisabledError):
        ss.send_for_event(db_session, "leave_approved", 7, sent_by=1)


def test_unknown_record_raises(db_session):
    with pytest.raises(ss.RecordNotFoundError):
        ss.send_for_event(db_session, "leave_approved", 9999, sent_by=1)
