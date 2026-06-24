"""Pydantic schemas for per-user recipient (distribution) lists — Ledger compose."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


class RecipientListMember(BaseModel):
    """One recipient in a list — pinned to the To or Cc field on apply."""

    field: Literal["to", "cc"] = "to"
    address: str = Field(min_length=1, max_length=320)
    display_name: str = Field(default="", max_length=256)


class RecipientListCreate(BaseModel):
    """Payload to create a list. Owner comes from the session, never here."""

    name: str = Field(min_length=1, max_length=128)
    members: list[RecipientListMember] = Field(default_factory=list)


class RecipientListUpdate(BaseModel):
    """Partial update — rename and/or replace the whole members array."""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    members: list[RecipientListMember] | None = None


class RecipientListRead(ORMBase):
    id: int
    name: str
    members: list[RecipientListMember]
    created_at: datetime
    updated_at: datetime | None


__all__ = [
    "RecipientListCreate",
    "RecipientListMember",
    "RecipientListRead",
    "RecipientListUpdate",
]
