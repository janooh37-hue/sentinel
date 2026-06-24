"""Duty-transfer request/result schemas.

``POST /api/v1/duty/transfer`` moves one or more employees to a destination
unit/post and mints a General Book transfer letter (from→to table) as the
audit record. Contract is frozen — see the design doc.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class DutyTransferRequest(BaseModel):
    # Bound the id list (each id is a db.get + a rendered <tr>) and the free-text
    # fields so a single transfer can't generate a runaway DOCX / DB write (API-02).
    employee_ids: list[str] = Field(min_length=1, max_length=500)
    to_unit: str = Field(min_length=1, max_length=128)
    to_post: str | None = Field(default=None, max_length=128)
    effective_date: date
    reason: str | None = Field(default=None, max_length=4000)


class DutyTransferResult(BaseModel):
    book_id: int
    ref: str
    document_id: int
    moved: list[str]
