"""Session and device-authenticated endpoints for the classic Outlook bridge."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.db.models import LedgerEntry, OutlookBridgeDevice, OutlookHandoff, User
from app.db.session import get_db
from app.schemas.outlook_bridge import (
    OutlookComposePayload,
    OutlookDevicePairRead,
    OutlookDevicePairRequest,
    OutlookDeviceRead,
    OutlookEmployeeSummary,
    OutlookHandoffCreate,
    OutlookHandoffCreated,
    OutlookHandoffFailure,
    OutlookHandoffRead,
    OutlookHandoffRedeemRead,
    OutlookHandoffRedeemRequest,
    OutlookOpenPayload,
    OutlookPairingCreate,
    OutlookPairingRead,
    OutlookSelectionRead,
    OutlookSelectionRequest,
)
from app.services import document_service, outlook_bridge_service

router = APIRouter(prefix="/outlook", tags=["outlook"])
device_router = APIRouter(prefix="/outlook/device", tags=["outlook-device"])


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _handoff_status(row: OutlookHandoff) -> str:
    if row.completed_at is not None:
        return "failed" if row.failure_code else "completed"
    if row.redeemed_at is not None:
        return "redeemed"
    if _now() >= row.expires_at:
        return "expired"
    return "pending"


def _handoff_read(row: OutlookHandoff) -> OutlookHandoffRead:
    return OutlookHandoffRead(
        id=row.id,
        kind=row.kind,
        status=_handoff_status(row),
        expires_at=row.expires_at,
        redeemed_at=row.redeemed_at,
        completed_at=row.completed_at,
        failure_code=row.failure_code,
        payload=row.payload or None,
    )


def _unauthorized(message: str = "Invalid Outlook bridge credential") -> AppError:
    return AppError("NOT_AUTHENTICATED", message, http_status=401)


def parse_bearer(authorization: str | None) -> str:
    if not authorization:
        raise _unauthorized()
    scheme, separator, value = authorization.partition(" ")
    if not separator or scheme.casefold() != "bearer" or not value.strip():
        raise _unauthorized()
    return value.strip()


def require_outlook_device(
    authorization: Annotated[str | None, Header()] = None,
    db: Annotated[Session, Depends(get_db)] = None,  # type: ignore[assignment]
) -> OutlookBridgeDevice:
    raw = parse_bearer(authorization)
    try:
        return outlook_bridge_service.authenticate_device(db, raw)
    except outlook_bridge_service.DeviceInvalid as exc:
        raise _unauthorized() from exc


@router.post("/pairings", response_model=OutlookPairingRead)
def issue_pairing(
    payload: OutlookPairingCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> OutlookPairingRead:
    try:
        raw = outlook_bridge_service.create_pairing(
            db, owner_user_id=user.id, expected_mailbox=payload.mailbox_address
        )
        pairing = outlook_bridge_service.pairing_for_token(db, raw, owner_user_id=user.id)
    except outlook_bridge_service.PairingInvalid as exc:
        raise ValidationFailedError("OUTLOOK_PAIRING_INVALID", str(exc)) from exc
    return OutlookPairingRead(token=raw, expires_at=pairing.expires_at)


@router.get("/devices", response_model=list[OutlookDeviceRead])
def get_devices(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[OutlookDeviceRead]:
    return [
        OutlookDeviceRead.model_validate(row)
        for row in outlook_bridge_service.list_devices(db, owner_user_id=user.id)
    ]


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(
    device_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    try:
        outlook_bridge_service.revoke_device(db, owner_user_id=user.id, device_id=device_id)
    except outlook_bridge_service.DeviceInvalid as exc:
        raise NotFoundError("OUTLOOK_DEVICE_NOT_FOUND", "Outlook device was not found") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/handoffs", response_model=OutlookHandoffCreated)
def issue_handoff(
    request: OutlookHandoffCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> OutlookHandoffCreated:
    if request.kind == "open":
        payload = request.payload
        assert isinstance(payload, OutlookOpenPayload)
        entry = db.scalar(
            select(LedgerEntry).where(
                LedgerEntry.id == payload.ledger_entry_id,
                LedgerEntry.owner_user_id == user.id,
                LedgerEntry.channel == "email",
                LedgerEntry.deleted_at.is_(None),
            )
        )
        if entry is None:
            raise NotFoundError("CORRESPONDENCE_NOT_FOUND", "Email correspondence was not found")
    else:
        payload = request.payload
        assert isinstance(payload, OutlookComposePayload)
        for attachment in payload.attachments:
            # Validate access now so a handoff cannot be created for an
            # inaccessible document. The device endpoint repeats this check at
            # download time in case permissions change during the five-minute TTL.
            document_service.resolve_pdf_for_access(db, attachment.document_id, user)

    try:
        raw = outlook_bridge_service.create_handoff(
            db, owner_user_id=user.id, kind=request.kind, payload=payload
        )
        row = outlook_bridge_service.handoff_for_token(db, raw, owner_user_id=user.id)
    except outlook_bridge_service.HandoffInvalid as exc:
        raise ValidationFailedError("OUTLOOK_HANDOFF_INVALID", str(exc)) from exc
    return OutlookHandoffCreated(
        id=row.id,
        token=raw,
        kind=row.kind,
        status=_handoff_status(row),
        expires_at=row.expires_at,
        payload=row.payload,
    )


@router.get("/handoffs/{handoff_id}", response_model=OutlookHandoffRead)
def get_handoff(
    handoff_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> OutlookHandoffRead:
    try:
        row = outlook_bridge_service.handoff_for_id(
            db, handoff_id=handoff_id, owner_user_id=user.id
        )
    except outlook_bridge_service.HandoffInvalid as exc:
        raise NotFoundError("OUTLOOK_HANDOFF_NOT_FOUND", "Outlook handoff was not found") from exc
    return _handoff_read(row)


@device_router.post("/pair", response_model=OutlookDevicePairRead)
def pair_device(
    payload: OutlookDevicePairRequest,
    db: Annotated[Session, Depends(get_db)],
) -> OutlookDevicePairRead:
    try:
        row, credential = outlook_bridge_service.redeem_pairing(
            db,
            raw_token=payload.token,
            device_id=payload.device_id,
            device_label=payload.device_label,
            mailbox_address=payload.mailbox_address,
        )
    except outlook_bridge_service.PairingInvalid as exc:
        raise _unauthorized("Invalid or expired Outlook pairing") from exc
    return OutlookDevicePairRead.model_validate(
        {**OutlookDeviceRead.model_validate(row).model_dump(), "credential": credential}
    )


@device_router.post("/selection", response_model=OutlookSelectionRead)
def select_message(
    payload: OutlookSelectionRequest,
    authorization: Annotated[str | None, Header()] = None,
    device: Annotated[OutlookBridgeDevice, Depends(require_outlook_device)] = None,  # type: ignore[assignment]
    db: Annotated[Session, Depends(get_db)] = None,  # type: ignore[assignment]
) -> OutlookSelectionRead:
    try:
        parse_bearer(authorization)
        return outlook_bridge_service.resolve_selection(
            db,
            device_credential=parse_bearer(authorization),
            internet_message_id=payload.internet_message_id,
            outlook_store_id=payload.outlook_store_id,
            outlook_entry_id=payload.outlook_entry_id,
            g_numbers=payload.g_numbers,
        )
    except AppError:
        raise
    except outlook_bridge_service.BridgeInvalid as exc:
        raise _unauthorized() from exc


@device_router.get("/employees", response_model=list[OutlookEmployeeSummary])
def search_employees(
    device: Annotated[OutlookBridgeDevice, Depends(require_outlook_device)],
    db: Annotated[Session, Depends(get_db)],
    q: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=20, ge=1, le=50),
) -> list[OutlookEmployeeSummary]:
    # The dependency already authenticated the bearer. Use the device id to
    # resolve its owner without ever copying the raw secret into logs/state.
    return outlook_bridge_service.search_employees_for_device(
        db, device=device, query=q, limit=limit
    )


@device_router.get("/employees/{employee_id}/photo", response_class=FileResponse)
def employee_photo(
    employee_id: str,
    _: Annotated[OutlookBridgeDevice, Depends(require_outlook_device)],
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    try:
        path, filename = outlook_bridge_service.employee_photo_path(db, employee_id)
    except outlook_bridge_service.DeviceInvalid as exc:
        raise NotFoundError("EMPLOYEE_PHOTO_NOT_FOUND", "Employee photo was not found") from exc
    return FileResponse(
        str(path), filename=filename, headers={"Cache-Control": "private, max-age=60"}
    )


@device_router.put("/messages/{entry_id}/employees/{employee_id}")
def link_employee(
    entry_id: int,
    employee_id: str,
    authorization: Annotated[str | None, Header()] = None,
    _: Annotated[OutlookBridgeDevice, Depends(require_outlook_device)] = None,  # type: ignore[assignment]
    db: Annotated[Session, Depends(get_db)] = None,  # type: ignore[assignment]
) -> dict[str, object]:
    try:
        row = outlook_bridge_service.manual_link(
            db,
            device_credential=parse_bearer(authorization),
            entry_id=entry_id,
            employee_id=employee_id,
        )
    except outlook_bridge_service.DeviceInvalid as exc:
        raise NotFoundError(
            "OUTLOOK_MESSAGE_NOT_FOUND", "Email correspondence was not found"
        ) from exc
    except ValueError as exc:
        raise NotFoundError("EMPLOYEE_NOT_FOUND", "Employee was not found") from exc
    return {"entry_id": row.ledger_entry_id, "employee_id": row.employee_id, "state": row.state}


@device_router.delete("/messages/{entry_id}/employees/{employee_id}", status_code=204)
def unlink_employee(
    entry_id: int,
    employee_id: str,
    authorization: Annotated[str | None, Header()] = None,
    _: Annotated[OutlookBridgeDevice, Depends(require_outlook_device)] = None,  # type: ignore[assignment]
    db: Annotated[Session, Depends(get_db)] = None,  # type: ignore[assignment]
) -> Response:
    try:
        outlook_bridge_service.dismiss_manual_link(
            db,
            device_credential=parse_bearer(authorization),
            entry_id=entry_id,
            employee_id=employee_id,
        )
    except outlook_bridge_service.DeviceInvalid as exc:
        raise NotFoundError(
            "OUTLOOK_MESSAGE_NOT_FOUND", "Email correspondence was not found"
        ) from exc
    except ValueError as exc:
        raise NotFoundError("EMPLOYEE_NOT_FOUND", "Employee was not found") from exc
    return Response(status_code=204)


@device_router.post("/handoffs/redeem", response_model=OutlookHandoffRedeemRead)
def redeem_device_handoff(
    payload: OutlookHandoffRedeemRequest,
    authorization: Annotated[str | None, Header()] = None,
    db: Annotated[Session, Depends(get_db)] = None,  # type: ignore[assignment]
) -> OutlookHandoffRedeemRead:
    raw_credential = parse_bearer(authorization)
    try:
        row = outlook_bridge_service.redeem_handoff(
            db, raw_token=payload.token, device_credential=raw_credential
        )
    except outlook_bridge_service.BridgeInvalid as exc:
        raise _unauthorized("Invalid, expired, or already used Outlook handoff") from exc
    return OutlookHandoffRedeemRead(handoff_id=row.id, kind=row.kind, payload=row.payload)


@device_router.get("/handoffs/{handoff_id}/attachments/{index}", response_class=FileResponse)
def download_handoff_attachment(
    handoff_id: int,
    index: int,
    device: Annotated[OutlookBridgeDevice, Depends(require_outlook_device)],
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    if index < 0:
        raise NotFoundError("OUTLOOK_ATTACHMENT_NOT_FOUND", "Attachment was not found")
    try:
        row = outlook_bridge_service.handoff_for_id(
            db, handoff_id=handoff_id, owner_user_id=device.owner_user_id
        )
    except outlook_bridge_service.HandoffInvalid as exc:
        raise NotFoundError("OUTLOOK_HANDOFF_NOT_FOUND", "Outlook handoff was not found") from exc
    if row.kind != "compose" or row.redeemed_at is None or row.completed_at is not None:
        raise NotFoundError("OUTLOOK_ATTACHMENT_NOT_FOUND", "Attachment was not found")
    refs = row.payload.get("attachments")
    if not isinstance(refs, list) or index >= len(refs):
        raise NotFoundError("OUTLOOK_ATTACHMENT_NOT_FOUND", "Attachment was not found")
    try:
        from app.schemas.outlook_bridge import OutlookAttachmentRef

        ref = OutlookAttachmentRef.model_validate(refs[index])
        owner = db.get(User, device.owner_user_id)
        if owner is None:
            raise FileNotFoundError
        path, _ = document_service.resolve_pdf_for_access(db, ref.document_id, owner)
    except (ValueError, FileNotFoundError) as exc:
        raise NotFoundError("OUTLOOK_ATTACHMENT_NOT_FOUND", "Attachment was not found") from exc
    return FileResponse(str(path), filename=ref.filename, media_type="application/pdf")


@device_router.post("/handoffs/{handoff_id}/complete", response_model=OutlookHandoffRead)
def complete_device_handoff(
    handoff_id: int,
    device: Annotated[OutlookBridgeDevice, Depends(require_outlook_device)],
    db: Annotated[Session, Depends(get_db)],
) -> OutlookHandoffRead:
    try:
        row = outlook_bridge_service.complete_handoff(
            db, handoff_id=handoff_id, owner_user_id=device.owner_user_id
        )
    except outlook_bridge_service.HandoffInvalid as exc:
        raise AppError("OUTLOOK_HANDOFF_INVALID", str(exc), http_status=409) from exc
    return _handoff_read(row)


@device_router.post("/handoffs/{handoff_id}/fail", response_model=OutlookHandoffRead)
def fail_device_handoff(
    handoff_id: int,
    payload: OutlookHandoffFailure,
    device: Annotated[OutlookBridgeDevice, Depends(require_outlook_device)],
    db: Annotated[Session, Depends(get_db)],
) -> OutlookHandoffRead:
    try:
        row = outlook_bridge_service.fail_handoff(
            db,
            handoff_id=handoff_id,
            owner_user_id=device.owner_user_id,
            failure_code=payload.failure_code,
        )
    except outlook_bridge_service.HandoffInvalid as exc:
        raise AppError("OUTLOOK_HANDOFF_INVALID", str(exc), http_status=409) from exc
    return _handoff_read(row)


__all__ = ["device_router", "parse_bearer", "require_outlook_device", "router"]
