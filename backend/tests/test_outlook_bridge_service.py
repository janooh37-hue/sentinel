from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    CorrespondenceEmployeeLink,
    EmailAccount,
    Employee,
    LedgerEntry,
    User,
)
from app.schemas.outlook_bridge import OutlookComposePayload
from app.services import outlook_bridge_service as bridge
from app.services.outlook_bridge_service import (
    DeviceInvalid,
    HandoffInvalid,
    PairingInvalid,
    authenticate_device,
    complete_handoff,
    create_handoff,
    create_pairing,
    fail_handoff,
    redeem_handoff,
    redeem_pairing,
    resolve_selection,
    revoke_device,
)


def _user(db: Session, email: str) -> User:
    row = User(email=email, password_hash="x", role="operator", status="active")
    db.add(row)
    db.flush()
    db.add(
        EmailAccount(
            email=email,
            imap_host="imap.ionos.com",
            imap_port=993,
            use_ssl=True,
            smtp_host="smtp.ionos.com",
            smtp_port=465,
            smtp_use_tls=True,
            username=email,
            password_encrypted="secret",
            owner_user_id=row.id,
        )
    )
    db.commit()
    db.refresh(row)
    return row


def _employee(db: Session, employee_id: str, name: str = "A") -> Employee:
    row = Employee(id=employee_id, name_en=name, name_ar=name, status="Active")
    db.add(row)
    db.commit()
    return row


def test_pairing_redeems_once_and_hashes_secret(db_session: Session) -> None:
    user = _user(db_session, "owner@example.test")
    raw = create_pairing(db_session, owner_user_id=user.id)

    device, credential = redeem_pairing(
        db_session,
        raw_token=raw,
        device_id="pc-1",
        device_label="HR-01",
        mailbox_address="OWNER@example.test",
    )

    assert credential not in device.device_credential_hash
    assert authenticate_device(db_session, credential).id == "pc-1"
    with pytest.raises(PairingInvalid):
        redeem_pairing(
            db_session,
            raw_token=raw,
            device_id="pc-2",
            device_label="HR-02",
            mailbox_address="owner@example.test",
        )


def test_pairing_rejects_mailbox_mismatch(db_session: Session) -> None:
    user = _user(db_session, "owner@example.test")
    raw = create_pairing(db_session, owner_user_id=user.id)
    with pytest.raises(PairingInvalid):
        redeem_pairing(
            db_session,
            raw_token=raw,
            device_id="pc-1",
            device_label="HR-01",
            mailbox_address="other@example.test",
        )


def test_expired_pairing_cannot_be_redeemed(db_session: Session, monkeypatch) -> None:
    user = _user(db_session, "owner@example.test")
    raw = create_pairing(db_session, owner_user_id=user.id)
    future = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=6)
    monkeypatch.setattr(bridge, "_utcnow", lambda: future)
    with pytest.raises(PairingInvalid):
        redeem_pairing(
            db_session,
            raw_token=raw,
            device_id="pc-1",
            device_label="HR-01",
            mailbox_address="owner@example.test",
        )


def test_same_owner_can_repair_revoked_stable_device_id(db_session: Session) -> None:
    user = _user(db_session, "owner@example.test")
    first_pairing = create_pairing(db_session, owner_user_id=user.id)
    device, old_credential = redeem_pairing(
        db_session,
        raw_token=first_pairing,
        device_id="pc-1",
        device_label="HR-01",
        mailbox_address="owner@example.test",
    )
    revoke_device(db_session, owner_user_id=user.id, device_id=device.id)

    _, new_credential = redeem_pairing(
        db_session,
        raw_token=create_pairing(db_session, owner_user_id=user.id),
        device_id="pc-1",
        device_label="HR-01-reinstalled",
        mailbox_address="owner@example.test",
    )

    assert new_credential != old_credential
    assert authenticate_device(db_session, new_credential).device_label == "HR-01-reinstalled"
    with pytest.raises(DeviceInvalid):
        authenticate_device(db_session, old_credential)


def test_handoff_is_single_use_and_erases_compose_payload(db_session: Session) -> None:
    user = _user(db_session, "owner@example.test")
    _, credential = redeem_pairing(
        db_session,
        raw_token=create_pairing(db_session, owner_user_id=user.id),
        device_id="pc-1",
        device_label="HR-01",
        mailbox_address="owner@example.test",
    )
    payload = OutlookComposePayload(
        to=["recipient@example.test"],
        subject="Subject",
        body_html="<p>Body</p>",
        basket_key="basket-1",
        attachments=[],
    )
    raw = create_handoff(db_session, owner_user_id=user.id, kind="compose", payload=payload)
    handoff = redeem_handoff(db_session, raw_token=raw, device_credential=credential)
    assert handoff.payload["subject"] == "Subject"
    complete_handoff(db_session, handoff_id=handoff.id, owner_user_id=user.id)
    db_session.refresh(handoff)
    assert handoff.payload == {}
    with pytest.raises(HandoffInvalid):
        redeem_handoff(db_session, raw_token=raw, device_credential=credential)


def test_failed_handoff_records_failure_without_retry(db_session: Session) -> None:
    user = _user(db_session, "owner@example.test")
    pairing_raw = create_pairing(db_session, owner_user_id=user.id)
    _, credential = redeem_pairing(
        db_session,
        raw_token=pairing_raw,
        device_id="pc-1",
        device_label="HR-01",
        mailbox_address="owner@example.test",
    )
    db_session.add(
        LedgerEntry(
            entry_date=date.today(),
            direction="in",
            channel="email",
            counterparty="sender@example.test",
            subject="Open me",
            owner_user_id=user.id,
        )
    )
    db_session.commit()
    raw = create_handoff(
        db_session,
        owner_user_id=user.id,
        kind="open",
        payload={"ledger_entry_id": 1},
    )
    handoff = redeem_handoff(db_session, raw_token=raw, device_credential=credential)
    fail_handoff(
        db_session, handoff_id=handoff.id, owner_user_id=user.id, failure_code="OPEN_FAILED"
    )
    db_session.refresh(handoff)
    assert handoff.failure_code == "OPEN_FAILED"
    assert handoff.completed_at is not None
    assert handoff.payload == {}


def test_handoff_owner_isolation(db_session: Session) -> None:
    owner = _user(db_session, "owner@example.test")
    other = _user(db_session, "other@example.test")
    db_session.add(
        LedgerEntry(
            entry_date=date.today(),
            direction="in",
            channel="email",
            counterparty="sender@example.test",
            subject="Other mailbox",
            owner_user_id=other.id,
        )
    )
    db_session.commit()
    _, credential = redeem_pairing(
        db_session,
        raw_token=create_pairing(db_session, owner_user_id=owner.id),
        device_id="pc-1",
        device_label="HR-01",
        mailbox_address="owner@example.test",
    )
    raw = create_handoff(
        db_session,
        owner_user_id=other.id,
        kind="open",
        payload={"ledger_entry_id": 1},
    )
    with pytest.raises(HandoffInvalid):
        redeem_handoff(db_session, raw_token=raw, device_credential=credential)


def test_selection_indexes_owned_message_and_returns_active_employees(db_session: Session) -> None:
    user = _user(db_session, "owner@example.test")
    _employee(db_session, "G3082", "Alice")
    entry = LedgerEntry(
        entry_date=date.today(),
        direction="in",
        channel="email",
        counterparty="sender@example.test",
        subject="Hello",
        message_id="<message-1>",
        owner_user_id=user.id,
    )
    db_session.add(entry)
    db_session.flush()
    db_session.add(
        CorrespondenceEmployeeLink(
            ledger_entry_id=entry.id,
            employee_id="G3082",
            state="linked",
            source="detected",
        )
    )
    db_session.commit()
    _, credential = redeem_pairing(
        db_session,
        raw_token=create_pairing(db_session, owner_user_id=user.id),
        device_id="pc-1",
        device_label="HR-01",
        mailbox_address="owner@example.test",
    )

    result = resolve_selection(
        db_session,
        device_credential=credential,
        internet_message_id="<message-1>",
        outlook_store_id="store",
        outlook_entry_id="entry",
        g_numbers=["G3082"],
    )

    assert result.recording_pending is False
    assert [employee.employee_id for employee in result.employees] == ["G3082"]


def test_unknown_selection_is_pending_without_creating_ledger_entry(db_session: Session) -> None:
    user = _user(db_session, "owner@example.test")
    _employee(db_session, "G3082", "Alice")
    _, credential = redeem_pairing(
        db_session,
        raw_token=create_pairing(db_session, owner_user_id=user.id),
        device_id="pc-1",
        device_label="HR-01",
        mailbox_address="owner@example.test",
    )

    result = resolve_selection(
        db_session,
        device_credential=credential,
        internet_message_id="<unknown>",
        outlook_store_id="store",
        outlook_entry_id="entry",
        g_numbers=["g3082", "G9999"],
    )

    assert result.recording_pending is True
    assert [employee.employee_id for employee in result.employees] == ["G3082"]
    assert db_session.scalar(select(func.count()).select_from(LedgerEntry)) == 0
