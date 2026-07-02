# backend/app/api/v1/sms.py
"""Employee SMS notification routes (on-site SIM gateway channel).

  POST /sms/send             — manually send a notification for a record
  GET  /sms/status           — most recent send attempt for a record

Both require the ``employees.notify`` capability.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.config import get_settings
from app.db.models import User
from app.db.session import get_db
from app.schemas.sms import (
    SmsSendRequest,
    SmsSendResponse,
    SmsStatusItem,
    SmsStatusResponse,
)
from app.services import sms_service

router = APIRouter(prefix="/sms", tags=["sms"])


@router.post("/send", response_model=SmsSendResponse)
def send(
    payload: SmsSendRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("employees.notify"))],
) -> SmsSendResponse:
    try:
        row = sms_service.send_for_event(db, payload.event_type, payload.record_id, sent_by=user.id)
    except sms_service.SmsDisabledError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    except sms_service.RecordNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    return SmsSendResponse(status=row.status, message_id=row.provider_msg_id, error=row.error)


@router.get("/status", response_model=SmsStatusResponse)
def get_status(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.notify"))],
    event_type: str = Query(...),
    record_id: int = Query(...),
) -> SmsStatusResponse:
    row = sms_service.last_status(db, event_type, record_id)
    return SmsStatusResponse(
        enabled=get_settings().sms_enabled,
        last=SmsStatusItem.model_validate(row) if row else None,
    )


__all__ = ["router"]
