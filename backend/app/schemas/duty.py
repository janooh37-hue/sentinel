"""Duty-transfer request/result schemas.

``POST /api/v1/duty/transfer`` moves one or more employees, EACH to its own
destination unit/post, and mints a General Book transfer letter (formal intro +
5-col red table + closing) as the audit record. One letter therefore covers a
whole transfer round: several source units, and a different destination per
employee (a swap). Contract is frozen — see the design doc.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class DutyTransferMove(BaseModel):
    """One employee's destination. ``to_post`` is optional (unit-only moves)."""

    employee_id: str = Field(min_length=1, max_length=16)  # Employee.id is String(16)
    to_unit: str = Field(min_length=1, max_length=128)
    to_post: str | None = Field(default=None, max_length=128)


class DutyTransferRequest(BaseModel):
    # Bound the move list and free-text fields so one transfer can't generate a
    # runaway DOCX / DB write (API-02).
    moves: list[DutyTransferMove] = Field(min_length=1, max_length=500)
    # Official-letter metadata — fed into the General Book pipeline.
    recipient_id: int | None = None  # addressee (recipient_name)
    manager_id: int | None = None  # signing manager
    cc: list[str] | None = Field(default=None, max_length=50)  # printed CC names


class DutyTransferResult(BaseModel):
    book_id: int | None = None
    ref: str | None = None
    document_id: int | None = None
    moved: list[str]
