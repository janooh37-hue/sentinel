"""Channel-decision matrix for notify_dispatch.

Tests cover: WhatsApp-registered → WA sent; not registered → SMS fallback;
WA transient error → queued; queued past window → SMS last resort;
no phone → failed (no channel); OpenWA disabled → SMS primary (not fallback).
"""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.config import get_settings
from app.db.models import Employee, Leave
from app.services import notify_dispatch, openwa_client, sms_client


@pytest.fixture()
def emp(db_session):
    e = Employee(
        id="G9001",
        name_en="Test",
        contact="500000000",
        msg_language="ar",
        status="Active",
    )
    db_session.add(e)
    db_session.commit()
    return e


@pytest.fixture()
def leave(db_session, emp):
    lv = Leave(
        employee_id=emp.id,
        leave_type="Annual - سنوية",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 5),
        days=5,
        status="Approved",
    )
    db_session.add(lv)
    db_session.commit()
    return lv


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    get_settings.cache_clear()
    for k, v in {
        "GSSG_OPENWA_ENABLED": "1",
        "GSSG_OPENWA_API_BASE": "http://x",
        "GSSG_OPENWA_API_KEY": "k",
        "GSSG_SMS_ENABLED": "1",
        "GSSG_SMS_GATEWAY_URL": "http://g",
        "GSSG_SMS_USERNAME": "u",
        "GSSG_SMS_PASSWORD": "p",
    }.items():
        monkeypatch.setenv(k, v)
    yield
    get_settings.cache_clear()


def test_registered_sends_whatsapp(db_session, leave, monkeypatch):
    monkeypatch.setattr(openwa_client, "is_registered", lambda p: True)
    monkeypatch.setattr(
        openwa_client, "send", lambda p, t: openwa_client.SendResult(ok=True, message_id="m1")
    )
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.channel == "whatsapp" and row.status == "sent" and row.fell_back is False


def test_not_registered_falls_back_to_sms(db_session, leave, monkeypatch):
    monkeypatch.setattr(openwa_client, "is_registered", lambda p: False)
    monkeypatch.setattr(
        sms_client, "send", lambda p, t: sms_client.SendResult(ok=True, message_id="s1")
    )
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.channel == "sms" and row.fell_back and row.fallback_reason == "not_on_whatsapp"


def test_whatsapp_transient_queues_for_retry(db_session, leave, monkeypatch):
    monkeypatch.setattr(openwa_client, "is_registered", lambda p: True)
    monkeypatch.setattr(
        openwa_client, "send", lambda p, t: openwa_client.SendResult(ok=False, error="503")
    )
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.channel == "whatsapp" and row.status == "queued" and row.next_retry_at is not None


def test_retry_window_expiry_routes_to_sms(db_session, leave, monkeypatch):
    monkeypatch.setattr(openwa_client, "is_registered", lambda p: True)
    monkeypatch.setattr(
        openwa_client, "send", lambda p, t: openwa_client.SendResult(ok=False, error="503")
    )
    monkeypatch.setattr(
        sms_client, "send", lambda p, t: sms_client.SendResult(ok=True, message_id="s2")
    )
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    # Force the row past the retry window
    row.created_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=6)
    db_session.commit()
    n = notify_dispatch.retry_queued(db_session)
    db_session.refresh(row)
    assert n == 1 and row.channel == "sms" and row.fallback_reason == "whatsapp_unrecoverable"


def test_no_phone_logs_failed(db_session, leave, emp):
    emp.contact = None
    db_session.commit()
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.status == "failed" and row.channel is None


def test_openwa_disabled_sends_sms_without_fellback(db_session, leave, monkeypatch):
    monkeypatch.setenv("GSSG_OPENWA_ENABLED", "0")
    get_settings.cache_clear()
    monkeypatch.setattr(
        sms_client, "send", lambda p, t: sms_client.SendResult(ok=True, message_id="s3")
    )
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.channel == "sms" and row.fell_back is False
