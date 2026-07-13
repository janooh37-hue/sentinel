"""Tests for the send_direct() reusable primitive added in Task 5.

send_direct routes arbitrary bilingual text for an employee through the
same WhatsApp-first / SMS-fallback policy as send_for_event.
"""

from types import SimpleNamespace

import pytest

from app.db.models import Employee, OutboundMessage
from app.services import notify_dispatch as nd


def _emp(db):
    e = Employee(
        id="G100",
        name_ar="س",
        name_en="Sup",
        status="Active",
        contact="0501234567",
        msg_language="ar",
        duty_unit="u",
        duty_post="p",
    )
    db.add(e)
    db.commit()
    return e


def test_send_direct_no_channel_raises(db_session, monkeypatch):
    monkeypatch.setattr(
        nd,
        "get_settings",
        lambda: SimpleNamespace(openwa_enabled=False, sms_enabled=False, sms_country_code="971"),
    )
    with pytest.raises(nd.NotifyDisabledError):
        nd.send_direct(
            db_session,
            employee=_emp(db_session),
            body="hi",
            language="ar",
            event_type="leave_digest",
            event_ref="leave_digest:2026-07:u",
            sent_by=None,
        )


def test_send_direct_sms_path_logs_row(db_session, monkeypatch):
    monkeypatch.setattr(
        nd,
        "get_settings",
        lambda: SimpleNamespace(openwa_enabled=False, sms_enabled=True, sms_country_code="971"),
    )
    monkeypatch.setattr(
        nd.sms_client,
        "send",
        lambda phone, body: SimpleNamespace(ok=True, message_id="m1", error=None),
    )
    row = nd.send_direct(
        db_session,
        employee=_emp(db_session),
        body="digest body",
        language="ar",
        event_type="leave_digest",
        event_ref="leave_digest:2026-07:u",
        sent_by=7,
    )
    assert isinstance(row, OutboundMessage)
    assert row.channel == "sms"
    assert row.status == "sent"
    assert row.body == "digest body"
    assert row.event_type == "leave_digest"
    assert row.sent_by == 7


def test_send_direct_no_phone_fails_gracefully(db_session, monkeypatch):
    monkeypatch.setattr(
        nd,
        "get_settings",
        lambda: SimpleNamespace(openwa_enabled=False, sms_enabled=True, sms_country_code="971"),
    )
    e = _emp(db_session)
    e.contact = None
    db_session.commit()
    row = nd.send_direct(
        db_session,
        employee=e,
        body="x",
        language="ar",
        event_type="leave_digest",
        event_ref="leave_digest:2026-07:u",
        sent_by=None,
    )
    assert row.status == "failed"
    assert row.channel is None
