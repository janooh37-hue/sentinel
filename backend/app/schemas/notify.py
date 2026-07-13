from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotifySendRequest(BaseModel):
    event_type: str
    record_id: int


class NotifySendResponse(BaseModel):
    status: str  # queued | sent | failed
    channel: str | None  # whatsapp | sms | None
    fell_back: bool
    fallback_reason: str | None = None
    message_id: str | None = None
    error: str | None = None


class NotifyStatusItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    event_type: str
    event_ref: str
    language: str
    channel: str | None
    status: str
    delivery_state: str | None
    fell_back: bool
    fallback_reason: str | None
    error: str | None
    created_at: datetime


class NotifyStatusResponse(BaseModel):
    enabled: bool  # any channel enabled
    last: NotifyStatusItem | None


class NotifyMessageRead(NotifyStatusItem):
    provider_msg_id: str | None
    delivery_checked_at: datetime | None
    phone: str
    body: str | None = None
