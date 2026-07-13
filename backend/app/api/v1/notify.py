"""Channel-agnostic employee notification routes (WhatsApp-first, SMS fallback).

  POST /notify/send                    — send a notification for a record
  GET  /notify/status                  — most recent attempt for a record
  POST /notify/{msg_id}/refresh-delivery — re-check delivery for one message

send/status require ``employees.notify``; refresh requires ``books.manage``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.config import get_settings
from app.db.models import User
from app.db.session import get_db
from app.schemas.notify import (
    NotifyMessageRead,
    NotifySendRequest,
    NotifySendResponse,
    NotifyStatusItem,
    NotifyStatusResponse,
)
from app.services import notify_dispatch

router = APIRouter(prefix="/notify", tags=["notify"])


@router.post("/send", response_model=NotifySendResponse)
def send(
    payload: NotifySendRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("employees.notify"))],
) -> NotifySendResponse:
    try:
        row = notify_dispatch.send_for_event(
            db, payload.event_type, payload.record_id, sent_by=user.id
        )
    except notify_dispatch.NotifyDisabledError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    except notify_dispatch.RecordNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    return NotifySendResponse(
        status=row.status,
        channel=row.channel,
        fell_back=row.fell_back,
        fallback_reason=row.fallback_reason,
        message_id=row.provider_msg_id,
        error=row.error,
    )


@router.get("/status", response_model=NotifyStatusResponse)
def get_status(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.notify"))],
    event_type: str = Query(...),
    record_id: int = Query(...),
) -> NotifyStatusResponse:
    cfg = get_settings()
    row = notify_dispatch.last_status(db, event_type, record_id)
    return NotifyStatusResponse(
        enabled=bool(cfg.openwa_enabled or cfg.sms_enabled),
        last=NotifyStatusItem.model_validate(row) if row else None,
    )


@router.post("/{msg_id}/refresh-delivery", response_model=NotifyMessageRead)
def refresh_delivery(
    msg_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> NotifyMessageRead:
    row = notify_dispatch.refresh_delivery(db, msg_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return NotifyMessageRead.model_validate(row)


__all__ = ["router"]
