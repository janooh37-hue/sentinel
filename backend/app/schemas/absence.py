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
    skipped_on_leave: list[date_t] = Field(default_factory=list)


class AbsenceEpisodeUpdate(BaseModel):
    """Redraw one register row: the span it has, then the span it should have."""

    start_date: date_t
    end_date: date_t
    new_start_date: date_t
    new_end_date: date_t
    note: str | None = Field(default=None, max_length=2000)


class AbsenceEpisodeRead(BaseModel):
    """One contiguous run of absence days — a register row."""

    start_date: date_t
    end_date: date_t
    days: int
    notes: str | None = None


class AbsenceRecordRead(BaseModel):
    """The employee's absence register: who, and the episode rows."""

    employee_id: str
    employee_name_en: str | None = None
    employee_name_ar: str | None = None
    duty_post: str | None = None
    duty_unit: str | None = None
    episodes: list[AbsenceEpisodeRead]


class AbsenceRegisterRowRead(BaseModel):
    """One register row across all employees: who, plus the episode."""

    employee_id: str
    employee_name_en: str | None = None
    employee_name_ar: str | None = None
    duty_post: str | None = None
    duty_unit: str | None = None
    start_date: date_t
    end_date: date_t
    days: int
    notes: str | None = None


class AbsenceRegisterRead(BaseModel):
    rows: list[AbsenceRegisterRowRead]


__all__ = [
    "AbsenceCreate",
    "AbsenceCreateResult",
    "AbsenceEpisodeRead",
    "AbsenceEpisodeUpdate",
    "AbsenceRead",
    "AbsenceRecordRead",
    "AbsenceRegisterRead",
    "AbsenceRegisterRowRead",
]
