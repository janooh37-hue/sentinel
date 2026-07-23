from __future__ import annotations

from pydantic import BaseModel, Field


class ReportCreate(BaseModel):
    signer_employee_id: str = Field(min_length=1)
    recipient_id: int | None = None
    subject: str = Field(min_length=1)
    date: str | None = None
    body_html: str = Field(min_length=1)
    sign: bool = True
