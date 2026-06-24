"""Pydantic schemas for the per-user address book — Ledger→Outlook Phase 2."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


class AddressBookContactCreate(BaseModel):
    """Payload to save a contact. Owner comes from the session, never here."""

    display_name: str = Field(default="", max_length=256)
    address: str = Field(min_length=1, max_length=320)


class AddressBookContactRead(ORMBase):
    id: int
    display_name: str
    address: str
    created_at: datetime


__all__ = ["AddressBookContactCreate", "AddressBookContactRead"]
