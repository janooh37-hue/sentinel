"""Announcements API — list WhatsApp groups + multipart fan-out send."""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import AuditLog, User
from app.db.session import get_db
from app.schemas.announcement import (
    AnnouncementOut,
    DirectSendOut,
    GatewayQrOut,
    GatewayStatusOut,
    GatewayUnlinkOut,
    GroupOut,
    GroupSendOut,
)
from app.services import announce_service, notify_dispatch, openwa_client

router = APIRouter(prefix="/announcements", tags=["announcements"])


@router.get("/groups", response_model=list[GroupOut])
def list_groups(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("messages.broadcast"))],
) -> list[GroupOut]:
    """Return the WhatsApp groups the connected number belongs to."""
    return [GroupOut(id=g.id, name=g.name) for g in announce_service.groups_available(db)]


@router.get("/status", response_model=GatewayStatusOut)
def gateway_status(
    _user: Annotated[User, Depends(require_capability("messages.broadcast"))],
) -> GatewayStatusOut:
    """Return the current OpenWA session state."""
    return GatewayStatusOut(state=openwa_client.cached_session_state())


@router.get("/qr", response_model=GatewayQrOut)
def gateway_qr(
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> GatewayQrOut:
    """Return the current QR code for pairing the WhatsApp session (admin only)."""
    return GatewayQrOut(qr=openwa_client.fetch_qr())


@router.post("/unlink", response_model=GatewayUnlinkOut)
def gateway_unlink(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> GatewayUnlinkOut:
    """Unlink the current WhatsApp session (admin only). Audit-logged; dormant behind openwa_enabled."""
    ok = openwa_client.logout()
    try:
        db.add(
            AuditLog(
                actor=user.display_name or user.email,
                action="unlink_whatsapp",
                entity_type="gateway",
                entity_id=None,
                payload=json.dumps({"ok": ok}, ensure_ascii=False),
            )
        )
        db.commit()
    finally:
        openwa_client.reset_status_cache()
    return GatewayUnlinkOut(ok=ok)


@router.post("/send", response_model=AnnouncementOut)
async def send_announcement(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("messages.broadcast"))],
    group_ids: Annotated[list[str] | None, Form()] = None,
    employee_ids: Annotated[list[str] | None, Form()] = None,
    text: Annotated[str, Form()] = "",
    book_id: Annotated[int | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
    mentions: Annotated[list[str] | None, Form()] = None,
) -> AnnouncementOut:
    """Fan-out a message to groups and/or directly to employees (private chats)."""
    if not (group_ids or employee_ids):
        raise HTTPException(status_code=422, detail="at least one group or employee required")

    # Resolve attachment.
    attachment: announce_service.Attachment | None = None
    if file is not None:
        attachment = announce_service.Attachment(
            filename=file.filename or "file",
            data=await file.read(),
        )
    elif book_id is not None:
        try:
            filename, data = announce_service.resolve_book_pdf(db, book_id)
        except announce_service.BookPdfError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        attachment = announce_service.Attachment(filename=filename, data=data)

    # Require text or attachment.
    if not text.strip() and attachment is None:
        raise HTTPException(status_code=422, detail="text or attachment required")

    # Group fan-out (unchanged) — only when groups were requested.
    result = None
    if group_ids:
        available = announce_service.groups_available(db)
        target_ids = set(group_ids)
        groups = [(g.id, g.name) for g in available if g.id in target_ids]
        if not groups:
            raise HTTPException(status_code=422, detail="no matching groups found")
        result = announce_service.send_announcement(
            db,
            groups=groups,
            text=text,
            attachment=attachment,
            book_id=(book_id if file is None else None),
            sent_by=user.id,
            mentions=mentions or [],
        )

    # Direct (private) fan-out. @mentions are a group-chat concept — the plain
    # text is sent as-is to each employee.
    try:
        direct = (
            announce_service.send_direct_announcement(
                db,
                employee_ids=employee_ids,
                text=text.strip(),
                attachment=attachment,
                sent_by=user.id,
            )
            if employee_ids
            else []
        )
    except notify_dispatch.NotifyDisabledError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    sent = (result.sent if result else 0) + sum(1 for d in direct if d.ok)
    failed = (result.failed if result else 0) + sum(1 for d in direct if not d.ok)
    return AnnouncementOut(
        announcement_id=result.announcement_id if result else None,
        sent=sent,
        failed=failed,
        results=[
            GroupSendOut(
                group_id=r.group_id,
                group_name=r.group_name,
                ok=r.ok,
                error=r.error,
            )
            for r in (result.results if result else [])
        ],
        direct_results=[
            DirectSendOut(
                employee_id=d.employee_id,
                employee_name=d.employee_name,
                ok=d.ok,
                fell_back=d.fell_back,
                error=d.error,
            )
            for d in direct
        ],
    )
