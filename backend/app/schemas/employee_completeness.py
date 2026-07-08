"""Pydantic schemas for employee-profile completeness data."""

from __future__ import annotations

from pydantic import BaseModel


class CompletenessRead(BaseModel):
    filled: int
    tracked: int


class MissingFieldCount(BaseModel):
    field: str
    count: int


class CompletenessSummaryOut(BaseModel):
    incomplete: int
    tracked: int
    top_missing: list[MissingFieldCount]
    first_incomplete_id: str | None
