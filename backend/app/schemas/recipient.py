"""General Book recipient schemas — picker source for the {{ recipient_name }} token."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


class RecipientCreate(BaseModel):
    name: str = Field(min_length=1)
    name_ar: str | None = None


class RecipientRead(ORMBase):
    id: int
    name: str
    name_ar: str | None
