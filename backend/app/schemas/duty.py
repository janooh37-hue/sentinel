"""Duty-transfer request/result schemas.

``POST /api/v1/duty/transfer`` moves one or more employees to a destination
unit/post and mints a General Book transfer letter (formal intro + 5-col
red table + closing) as the audit record. Contract is frozen — see the
design doc.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class DutyTransferRequest(BaseModel):
    # Bound the id list and free-text fields so one transfer can't generate a
    # runaway DOCX / DB write (API-02).
    employee_ids: list[str] = Field(min_length=1, max_length=500)
    to_unit: str = Field(min_length=1, max_length=128)
    to_post: str | None = Field(default=None, max_length=128)
    # Official-letter metadata — fed into the General Book pipeline.
    recipient_id: int | None = None      # addressee (recipient_name)
    manager_id: int | None = None        # signing manager
    cc: list[str] | None = Field(default=None, max_length=50)  # printed CC names


class DutyTransferResult(BaseModel):
    book_id: int
    ref: str
    document_id: int
    moved: list[str]
