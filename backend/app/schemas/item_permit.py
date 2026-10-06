"""Item-permit (إدخال مواد) schemas — wire shapes for ``/item-permits``."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas._base import ORMBase

ItemPermitZone = Literal["red", "green"]
_Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]

DEFAULT_RECIPIENT = "مسؤول وحدة التفتيش"
DEFAULT_SITE = "مبنى مركز الإصلاح والتأهيل الوثبة - 2"


class ItemPermitItem(BaseModel):
    name: _Text
    quantity: int = Field(ge=1, le=1_000_000)


class ItemPermitCreate(BaseModel):
    """POST /item-permits — issue a new item-entry permit."""

    model_config = ConfigDict(extra="forbid")

    employee_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    recipient: _Text = DEFAULT_RECIPIENT
    zone: ItemPermitZone = "red"
    site: _Text = DEFAULT_SITE
    items: list[ItemPermitItem] = Field(min_length=1, max_length=50)
    manager_id: int | None = None
    # Mirrors PermitCreate: submit the generated letter straight into approval.
    send_for_approval: bool = True


class ItemPermitUpdate(BaseModel):
    """PATCH /item-permits/{id} — every field optional; omitted = unchanged."""

    model_config = ConfigDict(extra="forbid")

    employee_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] | None = (
        None
    )
    recipient: _Text | None = None
    zone: ItemPermitZone | None = None
    site: _Text | None = None
    items: list[ItemPermitItem] | None = Field(default=None, min_length=1, max_length=50)
    manager_id: int | None = None


class ItemPermitRead(ORMBase):
    id: int
    employee_id: str
    employee_name: str
    employee_name_en: str
    employee_title: str | None
    recipient: str
    zone: ItemPermitZone
    site: str
    items: list[ItemPermitItem]
    manager_id: int | None
    book_id: int | None
    book_ref: str | None
    # none | pending | approved | rejected | returned
    approval_state: str | None
    created_at: datetime
    updated_at: datetime | None


class ItemPermitListResponse(BaseModel):
    items: list[ItemPermitRead]
    total: int
    limit: int
