"""SMS notification API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas._base import ORMBase

EventType = Literal["leave_approved", "duty_resumption", "violation"]


class SmsSendRequest(BaseModel):
    event_type: EventType
    record_id: int


class SmsSendResponse(BaseModel):
    status: Literal["sent", "failed"]
    message_id: str | None = None
    error: str | None = None


class SmsStatusItem(ORMBase):
    event_type: str
    event_ref: str
    language: str
    status: str
    error: str | None
    created_at: datetime


class SmsStatusResponse(BaseModel):
    enabled: bool = False
    last: SmsStatusItem | None = None
