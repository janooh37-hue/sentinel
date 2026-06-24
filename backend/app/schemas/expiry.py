from __future__ import annotations

from pydantic import BaseModel


class ExpiryItemOut(BaseModel):
    employee_id: str
    name_en: str
    name_ar: str | None = None
    doc_type: str
    expiry_date: str
    days_remaining: int
    bucket: str


class ExpirySummaryOut(BaseModel):
    expired: int
    critical: int
    urgent: int
