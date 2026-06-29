# backend/app/schemas/whatsapp.py
"""WhatsApp notification API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas._base import ORMBase

EventType = Literal["leave_approved", "duty_resumption", "violation"]


class WhatsAppSendRequest(BaseModel):
    event_type: EventType
    record_id: int


class WhatsAppSendResponse(BaseModel):
    status: Literal["sent", "failed"]
    message_id: str | None = None
    error: str | None = None


class WhatsAppStatusItem(ORMBase):
    event_type: str
    event_ref: str
    language: str
    status: str
    error: str | None
    created_at: datetime


class WhatsAppStatusResponse(BaseModel):
    enabled: bool = False
    last: WhatsAppStatusItem | None = None
