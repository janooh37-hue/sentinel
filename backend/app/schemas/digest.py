from __future__ import annotations

from pydantic import BaseModel


class DigestPreview(BaseModel):
    duty_unit: str
    month: str  # "YYYY-MM"
    count: int
    sample_ar: str
    sample_en: str


class DigestSendRequest(BaseModel):
    duty_unit: str | None = None


class DigestSkipOut(BaseModel):
    duty_unit: str
    reason: str


class DigestSendResult(BaseModel):
    sent: int
    skips: list[DigestSkipOut]
