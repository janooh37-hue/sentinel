"""Pairing, device authentication, selection, and one-time handoffs for Outlook."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.gnumber import detect_g_numbers
from app.db.models import (
    CorrespondenceEmployeeLink,
    EmailAccount,
    Employee,
    LedgerEntry,
    OutlookBridgeDevice,
    OutlookHandoff,
    OutlookItemLocation,
    OutlookPairing,
    User,
    VaultFile,
)
from app.schemas.outlook_bridge import (
    OutlookComposePayload,
    OutlookEmployeeSummary,
    OutlookOpenPayload,
    OutlookSelectionRead,
)
from app.services import correspondence_link_service, employee_service, photo_service

PAIRING_TTL = timedelta(minutes=5)
HANDOFF_TTL = timedelta(minutes=5)
MAX_EMPLOYEE_SEARCH_LIMIT = 50


class BridgeInvalid(ValueError):
    """Base class for invalid or expired bridge credentials."""


class PairingInvalid(BridgeInvalid):
    """Pairing token is missing, expired, redeemed, or mailbox-mismatched."""


class DeviceInvalid(BridgeInvalid):
    """Device credential is missing, revoked, or no longer valid."""


class HandoffInvalid(BridgeInvalid):
    """Handoff token is missing, expired, redeemed, or owner-mismatched."""


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _issue_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hashlib.sha256(raw.encode("ascii")).hexdigest()


def _hash_token(raw: str) -> str:
    try:
        return hashlib.sha256(raw.encode("ascii")).hexdigest()
    except UnicodeEncodeError as exc:
        raise BridgeInvalid("invalid bridge credential") from exc


def _matches(stored: str | None, digest: str) -> bool:
    """Compare fixed-size hashes without exposing credential presence."""
    return hmac.compare_digest(stored or ("0" * len(digest)), digest)


def _mailbox(value: str) -> str:
    return value.strip().casefold()


def _assert_current_mailbox(device: OutlookBridgeDevice, mailbox_address: str | None) -> None:
    if mailbox_address is not None and _mailbox(mailbox_address) != _mailbox(
        device.mailbox_address
    ):
        raise DeviceInvalid("mailbox mismatch")


def _account_for(db: Session, owner_user_id: int) -> EmailAccount:
    account = db.scalar(
        select(EmailAccount)
        .where(EmailAccount.owner_user_id == owner_user_id)
        .order_by(EmailAccount.id.asc())
    )
    if account is None:
        raise PairingInvalid("no mailbox configured")
    return account


def create_pairing(
    db: Session,
    *,
    owner_user_id: int,
    expected_mailbox: str | None = None,
) -> str:
    """Issue a short-lived, single-use pairing token and return its raw value."""
    account = _account_for(db, owner_user_id)
    mailbox = _mailbox(account.email)
    if expected_mailbox is not None and _mailbox(expected_mailbox) != mailbox:
        raise PairingInvalid("mailbox does not belong to this account")
    raw, digest = _issue_token()
    db.add(
        OutlookPairing(
            token_hash=digest,
            owner_user_id=owner_user_id,
            expected_mailbox=mailbox,
            expires_at=_utcnow() + PAIRING_TTL,
        )
    )
    db.commit()
    return raw


def pairing_for_token(
    db: Session, raw_token: str, *, owner_user_id: int | None = None
) -> OutlookPairing:
    try:
        digest = _hash_token(raw_token)
    except BridgeInvalid as exc:
        raise PairingInvalid("invalid pairing token") from exc
    query = select(OutlookPairing).where(OutlookPairing.token_hash == digest)
    if owner_user_id is not None:
        query = query.where(OutlookPairing.owner_user_id == owner_user_id)
    row = db.scalar(query)
    if row is None or not _matches(row.token_hash, digest):
        raise PairingInvalid("invalid pairing token")
    return row


def redeem_pairing(
    db: Session,
    *,
    raw_token: str,
    device_id: str,
    device_label: str,
    mailbox_address: str,
) -> tuple[OutlookBridgeDevice, str]:
    """Redeem pairing once, returning the device and raw bearer credential."""
    row = pairing_for_token(db, raw_token)
    now = _utcnow()
    if row.redeemed_at is not None or now >= row.expires_at:
        raise PairingInvalid("pairing token expired or already redeemed")
    if _mailbox(mailbox_address) != row.expected_mailbox:
        raise PairingInvalid("mailbox mismatch")
    existing = db.get(OutlookBridgeDevice, device_id)
    if existing is not None and (
        existing.owner_user_id != row.owner_user_id or existing.revoked_at is None
    ):
        raise PairingInvalid("device id already exists")
    claimed = db.execute(
        update(OutlookPairing)
        .where(
            OutlookPairing.id == row.id,
            OutlookPairing.redeemed_at.is_(None),
            OutlookPairing.expires_at > now,
        )
        .values(redeemed_at=now)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise PairingInvalid("pairing token expired or already redeemed")

    credential, credential_hash = _issue_token()
    if existing is None:
        device = OutlookBridgeDevice(
            id=device_id,
            owner_user_id=row.owner_user_id,
            mailbox_address=row.expected_mailbox,
            device_label=device_label.strip(),
            device_credential_hash=credential_hash,
            created_at=now,
            last_seen_at=now,
        )
        db.add(device)
    else:
        existing.mailbox_address = row.expected_mailbox
        existing.device_label = device_label.strip()
        existing.device_credential_hash = credential_hash
        existing.last_seen_at = now
        existing.revoked_at = None
        device = existing
    row.redeemed_at = now
    db.commit()
    return device, credential


def authenticate_device(db: Session, raw_credential: str) -> OutlookBridgeDevice:
    """Authenticate a bearer token and update its last-seen timestamp."""
    try:
        digest = _hash_token(raw_credential)
    except BridgeInvalid as exc:
        raise DeviceInvalid("invalid or revoked device credential") from exc
    row = db.scalar(
        select(OutlookBridgeDevice).where(OutlookBridgeDevice.device_credential_hash == digest)
    )
    if (
        row is None
        or not _matches(row.device_credential_hash, digest)
        or row.revoked_at is not None
    ):
        raise DeviceInvalid("invalid or revoked device credential")
    owner = db.get(User, row.owner_user_id) if row is not None else None
    if owner is None or owner.status.casefold() != "active" or owner.locked_at is not None:
        raise DeviceInvalid("device owner is inactive or locked")
    row.last_seen_at = _utcnow()
    db.commit()
    return row


def list_devices(db: Session, *, owner_user_id: int) -> list[OutlookBridgeDevice]:
    return list(
        db.scalars(
            select(OutlookBridgeDevice)
            .where(OutlookBridgeDevice.owner_user_id == owner_user_id)
            .order_by(OutlookBridgeDevice.created_at.desc(), OutlookBridgeDevice.id.desc())
        ).all()
    )


def revoke_device(db: Session, *, owner_user_id: int, device_id: str) -> None:
    row = db.scalar(
        select(OutlookBridgeDevice).where(
            OutlookBridgeDevice.id == device_id,
            OutlookBridgeDevice.owner_user_id == owner_user_id,
        )
    )
    if row is None:
        raise DeviceInvalid("device not found")
    if row.revoked_at is None:
        row.revoked_at = _utcnow()
        db.commit()


def _payload_dict(
    payload: dict[str, object] | OutlookComposePayload | OutlookOpenPayload,
) -> dict[str, object]:
    if isinstance(payload, (OutlookComposePayload, OutlookOpenPayload)):
        return payload.model_dump(mode="json")
    return dict(payload)


def create_handoff(
    db: Session,
    *,
    owner_user_id: int,
    kind: str,
    payload: dict[str, object] | OutlookComposePayload | OutlookOpenPayload,
) -> str:
    """Persist a typed, five-minute handoff and return its raw one-time token."""
    if kind not in {"compose", "open"}:
        raise HandoffInvalid("unsupported handoff kind")
    values = _payload_dict(payload)
    if kind == "open":
        try:
            values = OutlookOpenPayload.model_validate(values).model_dump(mode="json")
        except ValueError as exc:
            raise HandoffInvalid("open handoff payload is not typed") from exc
        entry = db.scalar(
            select(LedgerEntry).where(
                LedgerEntry.id == values["ledger_entry_id"],
                LedgerEntry.owner_user_id == owner_user_id,
                LedgerEntry.channel == "email",
                LedgerEntry.deleted_at.is_(None),
            )
        )
        if entry is None:
            raise HandoffInvalid("email correspondence was not found")
        if entry.message_id:
            values["internet_message_id"] = entry.message_id
    else:
        try:
            values = OutlookComposePayload.model_validate(values).model_dump(mode="json")
        except ValueError as exc:
            raise HandoffInvalid("compose handoff payload is not typed") from exc
    raw, digest = _issue_token()
    db.add(
        OutlookHandoff(
            token_hash=digest,
            owner_user_id=owner_user_id,
            kind=kind,
            payload=values,
            expires_at=_utcnow() + HANDOFF_TTL,
        )
    )
    db.commit()
    return raw


def handoff_for_id(db: Session, *, handoff_id: int, owner_user_id: int) -> OutlookHandoff:
    row = db.scalar(
        select(OutlookHandoff).where(
            OutlookHandoff.id == handoff_id,
            OutlookHandoff.owner_user_id == owner_user_id,
        )
    )
    if row is None:
        raise HandoffInvalid("handoff not found")
    return row


def _handoff_for_token(db: Session, raw_token: str) -> OutlookHandoff:
    try:
        digest = _hash_token(raw_token)
    except BridgeInvalid as exc:
        raise HandoffInvalid("invalid handoff token") from exc
    row = db.scalar(select(OutlookHandoff).where(OutlookHandoff.token_hash == digest))
    if row is None or not _matches(row.token_hash, digest):
        raise HandoffInvalid("invalid handoff token")
    return row


def handoff_for_token(
    db: Session, raw_token: str, *, owner_user_id: int | None = None
) -> OutlookHandoff:
    row = _handoff_for_token(db, raw_token)
    if owner_user_id is not None and row.owner_user_id != owner_user_id:
        raise HandoffInvalid("handoff does not belong to this owner")
    return row


def redeem_handoff(
    db: Session,
    *,
    raw_token: str,
    device_credential: str,
    mailbox_address: str | None = None,
) -> OutlookHandoff:
    device = authenticate_device(db, device_credential)
    _assert_current_mailbox(device, mailbox_address)
    row = _handoff_for_token(db, raw_token)
    now = _utcnow()
    if row.owner_user_id != device.owner_user_id:
        raise HandoffInvalid("handoff does not belong to this device")
    if row.redeemed_at is not None or row.completed_at is not None:
        raise HandoffInvalid("handoff already used")
    if now >= row.expires_at:
        raise HandoffInvalid("handoff expired")

    enriched_payload = _enrich_open_payload(db, row, device) if row.kind == "open" else None
    claimed = db.execute(
        update(OutlookHandoff)
        .where(
            OutlookHandoff.id == row.id,
            OutlookHandoff.redeemed_at.is_(None),
            OutlookHandoff.completed_at.is_(None),
            OutlookHandoff.expires_at > now,
        )
        .values(redeemed_at=now)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise HandoffInvalid("handoff already used or expired")
    row.redeemed_at = now
    if enriched_payload is not None:
        row.payload = enriched_payload
    db.commit()
    return row


def _enrich_open_payload(
    db: Session, handoff: OutlookHandoff, device: OutlookBridgeDevice
) -> dict[str, object]:
    payload = dict(handoff.payload or {})
    entry_id = payload.get("ledger_entry_id")
    if not isinstance(entry_id, int) or entry_id <= 0:
        raise HandoffInvalid("open handoff payload is invalid")
    location = db.scalar(
        select(OutlookItemLocation)
        .join(
            CorrespondenceEmployeeLink,
            CorrespondenceEmployeeLink.id == OutlookItemLocation.correspondence_employee_link_id,
        )
        .join(LedgerEntry, LedgerEntry.id == CorrespondenceEmployeeLink.ledger_entry_id)
        .where(
            OutlookItemLocation.device_id == device.id,
            LedgerEntry.id == entry_id,
            LedgerEntry.owner_user_id == device.owner_user_id,
            LedgerEntry.channel == "email",
            LedgerEntry.deleted_at.is_(None),
        )
        .order_by(OutlookItemLocation.last_verified_at.desc(), OutlookItemLocation.id.desc())
    )
    if location is not None:
        payload.update(
            {
                "outlook_store_id": location.store_id,
                "outlook_entry_id": location.entry_id,
                "internet_message_id": location.internet_message_id,
            }
        )
    return payload


def handoff_payload_for_device(
    db: Session,
    *,
    handoff: OutlookHandoff,
    device_credential: str,
) -> dict[str, object]:
    """Return a redeemed handoff payload enriched with this device's exact location."""
    device = authenticate_device(db, device_credential)
    if device.owner_user_id != handoff.owner_user_id:
        raise HandoffInvalid("handoff does not belong to this device")
    if handoff.kind != "open":
        return dict(handoff.payload or {})
    return _enrich_open_payload(db, handoff, device)


def expire_handoff_if_needed(db: Session, row: OutlookHandoff) -> bool:
    """Erase expired payloads; redeemed rows become terminal failure records."""
    if _utcnow() < row.expires_at or row.completed_at is not None:
        return False
    row.payload = {}
    if row.redeemed_at is not None:
        row.completed_at = _utcnow()
        row.failure_code = "HANDOFF_EXPIRED"
    db.commit()
    return True


def _finish_handoff(
    db: Session, *, handoff_id: int, owner_user_id: int, failure_code: str | None
) -> OutlookHandoff:
    row = handoff_for_id(db, handoff_id=handoff_id, owner_user_id=owner_user_id)
    if row.redeemed_at is None or row.completed_at is not None:
        raise HandoffInvalid("handoff is not awaiting completion")
    row.completed_at = _utcnow()
    row.failure_code = failure_code
    # Compose HTML, recipients, and attachment refs are no longer needed after
    # the native client reports its terminal state.
    row.payload = {}
    db.commit()
    return row


def complete_handoff(db: Session, *, handoff_id: int, owner_user_id: int) -> OutlookHandoff:
    return _finish_handoff(
        db, handoff_id=handoff_id, owner_user_id=owner_user_id, failure_code=None
    )


def fail_handoff(
    db: Session, *, handoff_id: int, owner_user_id: int, failure_code: str
) -> OutlookHandoff:
    code = failure_code.strip().upper()
    if not code or len(code) > 64 or not code.replace("_", "").isalnum():
        raise HandoffInvalid("invalid failure code")
    return _finish_handoff(
        db, handoff_id=handoff_id, owner_user_id=owner_user_id, failure_code=code
    )


def _summary(db: Session, employee: Employee, *, recording_pending: bool) -> OutlookEmployeeSummary:
    return OutlookEmployeeSummary(
        employee_id=employee.id,
        name_en=employee.name_en,
        name_ar=employee.name_ar,
        position=employee.position,
        status=employee.status,
        photo_version=photo_service.get_photo_version(db, employee.id),
        recording_pending=recording_pending,
    )


def _active_employees(db: Session, employee_ids: list[str]) -> list[Employee]:
    normalized = list(
        dict.fromkeys(value.strip().upper() for value in employee_ids if value.strip())
    )
    if not normalized:
        return []
    rows = list(
        db.scalars(
            select(Employee).where(Employee.id.in_(normalized), Employee.status == "Active")
        ).all()
    )
    by_id = {row.id: row for row in rows}
    return [by_id[value] for value in normalized if value in by_id]


def resolve_selection(
    db: Session,
    *,
    device_credential: str,
    internet_message_id: str,
    outlook_store_id: str,
    outlook_entry_id: str,
    g_numbers: list[str] | tuple[str, ...],
    mailbox_address: str | None = None,
) -> OutlookSelectionRead:
    """Resolve a selected message inside the paired owner's mailbox only."""
    device = authenticate_device(db, device_credential)
    _assert_current_mailbox(device, mailbox_address)
    message_id = internet_message_id.strip()
    entry = db.scalar(
        select(LedgerEntry).where(
            LedgerEntry.owner_user_id == device.owner_user_id,
            LedgerEntry.channel == "email",
            LedgerEntry.message_id == message_id,
            LedgerEntry.deleted_at.is_(None),
        )
    )
    if entry is None:
        employees = _active_employees(db, list(g_numbers))
        return OutlookSelectionRead(
            indexed=False,
            recording_pending=True,
            employees=[_summary(db, row, recording_pending=True) for row in employees],
        )

    detected = detect_g_numbers(" ".join(g_numbers))
    correspondence_link_service.sync_detected_links(db, entry_id=entry.id, employee_ids=detected)
    links = list(
        db.scalars(
            select(CorrespondenceEmployeeLink)
            .join(Employee, Employee.id == CorrespondenceEmployeeLink.employee_id)
            .where(
                CorrespondenceEmployeeLink.ledger_entry_id == entry.id,
                CorrespondenceEmployeeLink.state == "linked",
                Employee.status == "Active",
            )
            .order_by(CorrespondenceEmployeeLink.employee_id.asc())
        ).all()
    )
    now = _utcnow()
    for link in links:
        location = db.scalar(
            select(OutlookItemLocation).where(
                OutlookItemLocation.device_id == device.id,
                OutlookItemLocation.correspondence_employee_link_id == link.id,
            )
        )
        if location is None:
            db.add(
                OutlookItemLocation(
                    device_id=device.id,
                    correspondence_employee_link_id=link.id,
                    store_id=outlook_store_id,
                    entry_id=outlook_entry_id,
                    internet_message_id=message_id,
                    last_verified_at=now,
                )
            )
        else:
            location.store_id = outlook_store_id
            location.entry_id = outlook_entry_id
            location.internet_message_id = message_id
            location.last_verified_at = now
    db.commit()
    return OutlookSelectionRead(
        indexed=True,
        recording_pending=False,
        entry_id=entry.id,
        employees=[
            _summary(db, link.employee, recording_pending=False)
            for link in links
            if link.employee is not None
        ],
    )


def search_employees(
    db: Session, *, device_credential: str, query: str | None, limit: int
) -> list[OutlookEmployeeSummary]:
    authenticate_device(db, device_credential)
    bounded = max(1, min(limit, MAX_EMPLOYEE_SEARCH_LIMIT))
    rows, _ = employee_service.list_employees(db, q=query, status="Active", limit=bounded, offset=0)
    return [_summary(db, row, recording_pending=False) for row in rows]


def manual_link(
    db: Session,
    *,
    device_credential: str,
    entry_id: int,
    employee_id: str,
    mailbox_address: str | None = None,
) -> CorrespondenceEmployeeLink:
    device = authenticate_device(db, device_credential)
    _assert_current_mailbox(device, mailbox_address)
    entry = db.scalar(
        select(LedgerEntry).where(
            LedgerEntry.id == entry_id,
            LedgerEntry.owner_user_id == device.owner_user_id,
            LedgerEntry.channel == "email",
            LedgerEntry.deleted_at.is_(None),
        )
    )
    if entry is None:
        raise DeviceInvalid("message not found")
    row = correspondence_link_service.set_manual_link(
        db, entry_id=entry_id, employee_id=employee_id, actor_user_id=device.owner_user_id
    )
    db.commit()
    return row


def dismiss_manual_link(
    db: Session,
    *,
    device_credential: str,
    entry_id: int,
    employee_id: str,
    mailbox_address: str | None = None,
) -> CorrespondenceEmployeeLink:
    device = authenticate_device(db, device_credential)
    _assert_current_mailbox(device, mailbox_address)
    entry = db.scalar(
        select(LedgerEntry).where(
            LedgerEntry.id == entry_id,
            LedgerEntry.owner_user_id == device.owner_user_id,
            LedgerEntry.channel == "email",
            LedgerEntry.deleted_at.is_(None),
        )
    )
    if entry is None:
        raise DeviceInvalid("message not found")
    row = correspondence_link_service.dismiss_link(
        db, entry_id=entry_id, employee_id=employee_id, actor_user_id=device.owner_user_id
    )
    db.commit()
    return row


def search_employees_for_device(
    db: Session, *, device: OutlookBridgeDevice, query: str | None, limit: int
) -> list[OutlookEmployeeSummary]:
    bounded = max(1, min(limit, MAX_EMPLOYEE_SEARCH_LIMIT))
    rows, _ = employee_service.list_employees(db, q=query, status="Active", limit=bounded, offset=0)
    return [_summary(db, row, recording_pending=False) for row in rows]


def employee_photo_path(db: Session, employee_id: str) -> tuple[Path, str]:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise DeviceInvalid("employee not found")
    row = db.scalar(
        select(VaultFile)
        .where(VaultFile.employee_id == employee.id, VaultFile.kind == "photo")
        .order_by(VaultFile.created_at.asc())
    )
    if row is None:
        raise DeviceInvalid("photo not found")
    root = get_settings().vault_dir.resolve()
    path = (root / row.path).resolve()
    if root not in path.parents or not path.is_file():
        raise DeviceInvalid("photo not found")
    return path, row.filename


__all__ = [
    "HANDOFF_TTL",
    "PAIRING_TTL",
    "BridgeInvalid",
    "DeviceInvalid",
    "HandoffInvalid",
    "PairingInvalid",
    "authenticate_device",
    "complete_handoff",
    "create_handoff",
    "create_pairing",
    "dismiss_manual_link",
    "employee_photo_path",
    "expire_handoff_if_needed",
    "fail_handoff",
    "handoff_for_id",
    "handoff_for_token",
    "handoff_payload_for_device",
    "manual_link",
    "pairing_for_token",
    "redeem_handoff",
    "redeem_pairing",
    "resolve_selection",
    "revoke_device",
    "search_employees",
    "search_employees_for_device",
]
