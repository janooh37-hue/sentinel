"""Violation schemas.

The ``date`` field shadows :class:`datetime.date`. Pydantic re-evaluates
annotations after the class body runs, by which point ``date`` resolves to
the field's default value (``None``) rather than the type. We import the
type under an alias to side-step that — there's no nicer fix without
renaming the field, and the wire/DB name is fixed.
"""

from __future__ import annotations

from datetime import date as date_t
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


class ViolationCreate(BaseModel):
    employee_id: str
    violation_type: str = Field(min_length=1)
    date: date_t
    description: str | None = None
    action_taken: str | None = None
    deduction_days: int = Field(default=0, ge=0)
    status: str = "Open"
    doc_path: str | None = None


class ViolationUpdate(BaseModel):
    violation_type: str | None = None
    date: date_t | None = None
    description: str | None = None
    action_taken: str | None = None
    deduction_days: int | None = Field(default=None, ge=0)
    status: str | None = None
    doc_path: str | None = None


class ViolationRead(ORMBase):
    id: int
    employee_id: str
    violation_type: str
    date: date_t
    description: str | None
    action_taken: str | None
    deduction_days: int
    status: str
    doc_path: str | None
    created_at: datetime
