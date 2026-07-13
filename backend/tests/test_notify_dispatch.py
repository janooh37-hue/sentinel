"""Channel-decision matrix for notify_dispatch.

Tests cover: WhatsApp-registered → WA sent; not registered → SMS fallback;
WA transient error → queued; queued past window → SMS last resort;
no phone → failed (no channel); OpenWA disabled → SMS primary (not fallback).
"""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.config import get_settings
from app.db.models import Employee, Leave, OutboundMessage
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


def test_send_time_not_registered_falls_back_to_sms(db_session, leave, monkeypatch):
    """send() returning not_registered=True triggers SMS fallback (distinct from is_registered=False)."""
    monkeypatch.setattr(openwa_client, "is_registered", lambda p: True)
    monkeypatch.setattr(
        openwa_client,
        "send",
        lambda p, t: openwa_client.SendResult(ok=False, not_registered=True),
    )
    monkeypatch.setattr(
        sms_client, "send", lambda p, t: sms_client.SendResult(ok=True, message_id="s")
    )
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert (
        row.channel == "sms" and row.fell_back is True and row.fallback_reason == "not_on_whatsapp"
    )


def test_within_window_transient_reschedules_not_fallback(db_session, leave, monkeypatch):
    """A queued row that is still within the retry window is rescheduled, not finalized."""
    monkeypatch.setattr(openwa_client, "is_registered", lambda p: True)
    monkeypatch.setattr(
        openwa_client, "send", lambda p, t: openwa_client.SendResult(ok=False, error="503")
    )
    row = notify_dispatch.send_for_event(db_session, "leave_approved", leave.id, sent_by=None)
    assert row.status == "queued" and row.channel == "whatsapp"

    # Make the row due for retry NOW but keep created_at fresh (within the 5-min window)
    row.next_retry_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
    db_session.commit()

    n = notify_dispatch.retry_queued(db_session)
    db_session.refresh(row)

    assert n == 0
    assert row.status == "queued"
    assert row.channel == "whatsapp"
    assert row.next_retry_at > datetime.now(UTC).replace(tzinfo=None)


def test_poll_deliveries_routes_to_correct_client(db_session, emp, monkeypatch):
    """poll_deliveries calls sms_client for SMS rows and openwa_client for WhatsApp rows."""
    now = datetime.now(UTC).replace(tzinfo=None)

    sms_row = OutboundMessage(
        employee_id=emp.id,
        event_type="leave_approved",
        event_ref="leave_approved:99",
        language="ar",
        phone="500000000",
        channel="sms",
        status="sent",
        provider_msg_id="s1",
        created_at=now,
    )
    wa_row = OutboundMessage(
        employee_id=emp.id,
        event_type="leave_approved",
        event_ref="leave_approved:98",
        language="ar",
        phone="500000000",
        channel="whatsapp",
        status="sent",
        provider_msg_id="w1",
        created_at=now,
    )
    db_session.add_all([sms_row, wa_row])
    db_session.commit()

    monkeypatch.setattr(
        sms_client,
        "get_delivery",
        lambda mid: sms_client.DeliveryResult(ok=True, state="Delivered"),
    )
    monkeypatch.setattr(
        openwa_client,
        "get_ack",
        lambda mid: openwa_client.DeliveryResult(ok=True, state="read"),
    )

    notify_dispatch.poll_deliveries(db_session)
    db_session.refresh(sms_row)
    db_session.refresh(wa_row)

    assert sms_row.delivery_state == "Delivered"
    assert wa_row.delivery_state == "read"


# ── poll_deliveries edge-case tests ──────────────────────────────────────────


def _make_outbound(db_session, emp, *, channel="sms", **kwargs) -> OutboundMessage:
    """Create and persist a minimal OutboundMessage row for poll tests."""
    defaults: dict[str, object] = dict(
        employee_id=emp.id,
        event_type="leave_approved",
        event_ref="leave_approved:1",
        language="ar",
        phone="500000000",
        channel=channel,
        status="sent",
        created_at=datetime.now(UTC).replace(tzinfo=None),
    )
    defaults.update(kwargs)
    row = OutboundMessage(**defaults)
    db_session.add(row)
    db_session.commit()
    return row


def test_poll_skips_terminal_delivery_state(db_session, emp, monkeypatch):
    """A row already in a terminal delivery_state is excluded by the query — client never called."""
    called = []
    monkeypatch.setattr(sms_client, "get_delivery", lambda mid: (called.append(mid), None)[1])

    _make_outbound(db_session, emp, provider_msg_id="t1", delivery_state="Delivered")
    n = notify_dispatch.poll_deliveries(db_session)

    assert n == 0
    assert called == []


def test_poll_skips_row_older_than_24h(db_session, emp, monkeypatch):
    """A row created more than 24 h ago is excluded from the poll window."""
    called = []
    monkeypatch.setattr(sms_client, "get_delivery", lambda mid: (called.append(mid), None)[1])

    old_time = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=25)
    _make_outbound(db_session, emp, provider_msg_id="t2", created_at=old_time)
    n = notify_dispatch.poll_deliveries(db_session)

    assert n == 0
    assert called == []


def test_poll_skips_row_without_provider_msg_id(db_session, emp, monkeypatch):
    """A row with no provider_msg_id (never accepted by the gateway) is excluded."""
    called = []
    monkeypatch.setattr(sms_client, "get_delivery", lambda mid: (called.append(mid), None)[1])

    _make_outbound(db_session, emp, provider_msg_id=None)
    n = notify_dispatch.poll_deliveries(db_session)

    assert n == 0
    assert called == []


def test_poll_ok_false_leaves_delivery_state_unchanged(db_session, emp, monkeypatch):
    """When the client lookup returns ok=False, delivery_state stays None and the row is not finalized."""
    monkeypatch.setattr(
        sms_client,
        "get_delivery",
        lambda mid: sms_client.DeliveryResult(ok=False, error="gateway timeout"),
    )

    row = _make_outbound(db_session, emp, provider_msg_id="t3")
    n = notify_dispatch.poll_deliveries(db_session)
    db_session.refresh(row)

    assert n == 0
    assert row.delivery_state is None
    # delivery_checked_at is still updated (the poll ran) even on ok=False
    assert row.delivery_checked_at is not None


def test_refresh_delivery_returns_none_for_nonexistent_id(db_session):
    """refresh_delivery returns None when the message id does not exist."""
    result = notify_dispatch.refresh_delivery(db_session, msg_id=999999)
    assert result is None
