# backend/app/api/v1/whatsapp.py
"""Employee WhatsApp notification routes.

  POST /whatsapp/send             — manually send a notification for a record
  GET  /whatsapp/status           — most recent send attempt for a record

Both require the ``employees.notify`` capability.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.whatsapp import (
    WhatsAppSendRequest,
    WhatsAppSendResponse,
    WhatsAppStatusItem,
    WhatsAppStatusResponse,
)
from app.services import whatsapp_service

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


@router.post("/send", response_model=WhatsAppSendResponse)
def send(
    payload: WhatsAppSendRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("employees.notify"))],
) -> WhatsAppSendResponse:
    try:
        row = whatsapp_service.send_for_event(
            db, payload.event_type, payload.record_id, sent_by=user.id
        )
    except whatsapp_service.WhatsAppDisabledError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except whatsapp_service.RecordNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return WhatsAppSendResponse(status=row.status, message_id=row.provider_msg_id, error=row.error)


@router.get("/status", response_model=WhatsAppStatusResponse)
def get_status(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.notify"))],
    event_type: str = Query(...),
    record_id: int = Query(...),
) -> WhatsAppStatusResponse:
    row = whatsapp_service.last_status(db, event_type, record_id)
    return WhatsAppStatusResponse(
        last=WhatsAppStatusItem.model_validate(row) if row else None
    )


__all__ = ["router"]
