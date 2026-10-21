from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


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


class NotifyStatusItem(ORMBase):
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


class MessageText(BaseModel):
    ar: str
    en: str


class MessageSegments(BaseModel):
    ar: int
    en: int


class MessageVariable(BaseModel):
    name: str
    label_en: str
    label_ar: str
    sample: str


class MessageTemplateRead(BaseModel):
    event: str
    label: MessageText
    group: Literal["leaves", "forms", "violations", "reminders"]
    services: list[str]
    timing: Literal["on_approval", "on_save", "on_status_change", "scheduled", "manual"]
    default: MessageText
    override: MessageText | None
    variables: list[MessageVariable]


class MessageRenderRead(BaseModel):
    text: MessageText
    segments: MessageSegments


class NotifyPreviewRequest(BaseModel):
    template_id: str
    employee_id: str | None = None
    fields: dict[str, Any] = Field(default_factory=dict)
    revise_of_book_id: int | None = None


class NotifyPreviewRead(BaseModel):
    event: str | None
    language: Literal["ar", "en"]
    timing: Literal["on_approval", "on_save", "on_status_change", "scheduled", "manual"]
    text: MessageText | None
    segments: MessageSegments | None
