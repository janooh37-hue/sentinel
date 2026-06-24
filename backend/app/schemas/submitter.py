"""Submitter schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


class SubmitterCreate(BaseModel):
    employee_id: str | None = None
    name: str = Field(min_length=1)
    stored_sig_path: str | None = None


class SubmitterUpdate(BaseModel):
    employee_id: str | None = None
    name: str | None = None
    stored_sig_path: str | None = None


class SubmitterRead(ORMBase):
    id: int
    employee_id: str | None
    name: str
    stored_sig_path: str | None
