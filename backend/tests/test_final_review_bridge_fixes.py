from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.db.models import EmailAccount, Employee, LedgerEntry, User
from app.schemas.outlook_bridge import OutlookComposePayload
from app.services import email_service
from app.services import outlook_bridge_service as bridge


def _user(db, email: str, status: str = "active") -> User:
    user = User(email=email, password_hash="x", role="operator", status=status)
    db.add(user)
    db.flush()
    db.add(
        EmailAccount(
            email=email,
            imap_host="imap.example.test",
            username=email,
            password_encrypted="x",
            owner_user_id=user.id,
        )
    )
    db.commit()
    return user


def _paired(db, user: User, mailbox: str | None = None) -> str:
    mailbox = mailbox or user.email
    token = bridge.create_pairing(db, owner_user_id=user.id)
    _, credential = bridge.redeem_pairing(
        db,
        raw_token=token,
        device_id=f"pc-{user.id}",
        device_label="PC",
        mailbox_address=mailbox,
    )
    return credential


def test_compose_requires_valid_bounded_recipients() -> None:
    with pytest.raises(ValueError):
        OutlookComposePayload(to=[], subject="x", body_html="", basket_key="b", attachments=[])
    with pytest.raises(ValueError):
        OutlookComposePayload(
            to=["not-an-email"], subject="x", body_html="", basket_key="b", attachments=[]
        )
    with pytest.raises(ValueError):
        OutlookComposePayload(
            to=["valid@example.test"],
            cc=["x" * 321 + "@example.test"],
            subject="x",
            body_html="",
            basket_key="b",
            attachments=[],
        )


def test_device_auth_rejects_inactive_and_locked_owners(db_session) -> None:
    inactive = _user(db_session, "inactive@example.test", status="disabled")
    credential = _paired(db_session, inactive)
    with pytest.raises(bridge.DeviceInvalid):
        bridge.authenticate_device(db_session, credential)

    locked = _user(db_session, "locked@example.test")
    credential = _paired(db_session, locked)
    locked.status = "locked"
    db_session.commit()
    with pytest.raises(bridge.DeviceInvalid):
        bridge.authenticate_device(db_session, credential)


def test_selection_rejects_current_mailbox_mismatch(db_session) -> None:
    user = _user(db_session, "owner@example.test")
    credential = _paired(db_session, user)
    with pytest.raises(bridge.DeviceInvalid):
        bridge.resolve_selection(
            db_session,
            device_credential=credential,
            mailbox_address="other@example.test",
            internet_message_id="<missing>",
            outlook_store_id="store",
            outlook_entry_id="entry",
            g_numbers=[],
        )


def test_open_redemption_does_not_burn_token_when_enrichment_fails(db_session, monkeypatch) -> None:
    user = _user(db_session, "owner@example.test")
    credential = _paired(db_session, user)
    entry = LedgerEntry(
        entry_date=date.today(),
        direction="incoming",
        channel="email",
        counterparty="sender@example.test",
        subject="Open",
        owner_user_id=user.id,
        message_id="<open@example.test>",
    )
    db_session.add(entry)
    db_session.commit()
    raw = bridge.create_handoff(
        db_session, owner_user_id=user.id, kind="open", payload={"ledger_entry_id": entry.id}
    )

    def fail_enrichment(*_args, **_kwargs):
        raise bridge.HandoffInvalid("location lookup failed")

    monkeypatch.setattr(bridge, "_enrich_open_payload", fail_enrichment)
    with pytest.raises(bridge.HandoffInvalid):
        bridge.redeem_handoff(
            db_session,
            raw_token=raw,
            device_credential=credential,
            mailbox_address="owner@example.test",
        )
    row = db_session.scalar(select(bridge.OutlookHandoff))
    assert row is not None and row.redeemed_at is None


def test_employee_summary_carries_position(db_session) -> None:
    employee = Employee(id="G3082", name_en="Alice", name_ar="أليس", position="Manager")
    db_session.add(employee)
    db_session.commit()
    assert bridge._summary(db_session, employee, recording_pending=False).position == "Manager"


def test_expired_handoff_payload_is_erased_and_terminalized(db_session) -> None:
    user = _user(db_session, "owner@example.test")
    row_token = bridge.create_handoff(
        db_session,
        owner_user_id=user.id,
        kind="compose",
        payload={
            "to": ["recipient@example.test"],
            "cc": [],
            "subject": "x",
            "body_html": "",
            "basket_key": "b",
            "attachments": [],
        },
    )
    row = bridge.handoff_for_token(db_session, row_token, owner_user_id=user.id)
    row.redeemed_at = bridge._utcnow()
    row.expires_at = bridge._utcnow() - timedelta(seconds=1)
    db_session.commit()
    assert bridge.expire_handoff_if_needed(db_session, row) is True
    db_session.refresh(row)
    assert row.payload == {}
    assert row.completed_at is not None
    assert row.failure_code == "HANDOFF_EXPIRED"


def test_message_id_dedup_is_scoped_to_mailbox_owner(db_session) -> None:
    first = _user(db_session, "first@example.test")
    second = _user(db_session, "second@example.test")
    db_session.add_all(
        [
            LedgerEntry(
                entry_date=date.today(),
                direction="incoming",
                channel="email",
                counterparty="sender@example.test",
                subject="first",
                owner_user_id=first.id,
                tags=["email", "msgid:same@example.test"],
            ),
            LedgerEntry(
                entry_date=date.today(),
                direction="incoming",
                channel="email",
                counterparty="sender@example.test",
                subject="second",
                owner_user_id=second.id,
                tags=["email", "msgid:same@example.test"],
            ),
        ]
    )
    db_session.commit()
    assert len(email_service._existing_msgids(db_session, owner_user_id=first.id)) == 1
    assert len(email_service._existing_msgids(db_session, owner_user_id=second.id)) == 1
