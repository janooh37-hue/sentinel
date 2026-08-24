"""Absence record schemas.

The ``date`` field shadows :class:`datetime.date` — imported under an alias for
the same reason as ``schemas/violation.py``: Pydantic re-evaluates annotations
after the class body, when ``date`` would resolve to the field default.
"""

from __future__ import annotations

from datetime import date as date_t
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


class AbsenceCreate(BaseModel):
    """Mark every day in ``[start_date, end_date]`` (inclusive) as absent."""

    start_date: date_t
    end_date: date_t
    note: str | None = Field(default=None, max_length=2000)


class AbsenceRead(ORMBase):
    id: int
    employee_id: str
    date: date_t
    note: str | None
    created_at: datetime


class AbsenceCreateResult(BaseModel):
    """The days recorded, and the requested days refused as off-roster."""

    created: list[AbsenceRead]
    skipped_off_roster: list[date_t]


__all__ = ["AbsenceCreate", "AbsenceCreateResult", "AbsenceRead"]
