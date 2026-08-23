"""Typed contracts for the classic Outlook bridge."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

MailboxAddress = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320)
]


class OutlookPairingCreate(BaseModel):
    """Optional mailbox override used only to select the user's configured account."""

    mailbox_address: MailboxAddress | None = None


class OutlookPairingRead(BaseModel):
    token: str
    expires_at: datetime


class OutlookDevicePairRequest(BaseModel):
    token: str = Field(min_length=1, max_length=512)
    device_id: str = Field(min_length=1, max_length=64)
    device_label: str = Field(min_length=1, max_length=128)
    mailbox_address: MailboxAddress

    @field_validator("device_id", "device_label")
    @classmethod
    def _trim_device_fields(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("device field must not be blank")
        return value


class OutlookDeviceRead(BaseModel):
    id: str
    mailbox_address: str
    device_label: str
    created_at: datetime
    last_seen_at: datetime
    revoked_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class OutlookDevicePairRead(OutlookDeviceRead):
    credential: str


class OutlookAttachmentRef(BaseModel):
    kind: Literal["document_pdf"]
    document_id: int = Field(gt=0)
    filename: str = Field(min_length=1, max_length=200)
    model_config = ConfigDict(extra="forbid")

    @field_validator("filename")
    @classmethod
    def _safe_filename(cls, value: str) -> str:
        value = value.strip()
        if not value or value in {".", ".."} or "/" in value or "\\" in value:
            raise ValueError("filename must be a basename")
        if any(ord(char) < 32 for char in value):
            raise ValueError("filename contains control characters")
        return value


class OutlookComposePayload(BaseModel):
    to: list[str]
    cc: list[str] = Field(default_factory=list)
    subject: str = Field(max_length=255)
    body_html: str = Field(max_length=500_000)
    basket_key: str = Field(max_length=160)
    attachments: list[OutlookAttachmentRef] = Field(max_length=50)
    model_config = ConfigDict(extra="forbid")


class OutlookOpenPayload(BaseModel):
    ledger_entry_id: int = Field(gt=0)
    model_config = ConfigDict(extra="forbid")


class OutlookHandoffCreate(BaseModel):
    kind: Literal["compose", "open"]
    payload: OutlookComposePayload | OutlookOpenPayload
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _payload_matches_kind(self) -> OutlookHandoffCreate:
        if self.kind == "compose" and not isinstance(self.payload, OutlookComposePayload):
            raise ValueError("compose handoffs require a compose payload")
        if self.kind == "open" and not isinstance(self.payload, OutlookOpenPayload):
            raise ValueError("open handoffs require an open payload")
        return self


class OutlookHandoffRead(BaseModel):
    id: int
    kind: Literal["compose", "open"]
    status: Literal["pending", "redeemed", "completed", "failed", "expired"]
    expires_at: datetime
    redeemed_at: datetime | None = None
    completed_at: datetime | None = None
    failure_code: str | None = None
    payload: dict[str, object] | None = None


class OutlookHandoffCreated(OutlookHandoffRead):
    token: str


class OutlookHandoffRedeemRequest(BaseModel):
    token: str = Field(min_length=1, max_length=512)


class OutlookSelectionRequest(BaseModel):
    internet_message_id: str = Field(min_length=1, max_length=512)
    outlook_store_id: str = Field(min_length=1, max_length=512)
    outlook_entry_id: str = Field(min_length=1, max_length=512)
    g_numbers: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("g_numbers")
    @classmethod
    def _normalize_g_numbers(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(value.strip().upper() for value in values if value.strip()))


class OutlookEmployeeSummary(BaseModel):
    employee_id: str
    name_en: str
    name_ar: str | None = None
    status: str
    photo_version: str | None = None
    recording_pending: bool = False


class OutlookSelectionRead(BaseModel):
    indexed: bool
    recording_pending: bool
    entry_id: int | None = None
    employees: list[OutlookEmployeeSummary]


class OutlookHandoffRedeemRead(BaseModel):
    handoff_id: int
    kind: Literal["compose", "open"]
    payload: dict[str, object]


class OutlookHandoffFailure(BaseModel):
    failure_code: str = Field(min_length=1, max_length=64)


__all__ = [
    "OutlookAttachmentRef",
    "OutlookComposePayload",
    "OutlookDevicePairRead",
    "OutlookDevicePairRequest",
    "OutlookDeviceRead",
    "OutlookEmployeeSummary",
    "OutlookHandoffCreate",
    "OutlookHandoffCreated",
    "OutlookHandoffFailure",
    "OutlookHandoffRead",
    "OutlookHandoffRedeemRequest",
    "OutlookOpenPayload",
    "OutlookPairingCreate",
    "OutlookPairingRead",
    "OutlookSelectionRead",
    "OutlookSelectionRequest",
]
