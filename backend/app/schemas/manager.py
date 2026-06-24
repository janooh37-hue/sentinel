"""Manager schemas."""

from __future__ import annotations

from pydantic import BaseModel

from app.schemas._base import ORMBase


class ManagerCreate(BaseModel):
    name_en: str | None = None
    name_ar: str | None = None
    title: str | None = None
    sig_path: str | None = None
    active: bool = True


class ManagerUpdate(BaseModel):
    name_en: str | None = None
    name_ar: str | None = None
    title: str | None = None
    sig_path: str | None = None
    active: bool | None = None


class ManagerRead(ORMBase):
    id: int
    name_en: str | None
    name_ar: str | None
    title: str | None
    active: bool
    # Linked login account this manager approves with (reviewer/manager-routed
    # approvals). `user_name` is resolved for display.
    user_id: int | None = None
    user_name: str | None = None
    # `sig_path` (a filesystem path) is intentionally NOT exposed.


class ManagerLinkUpdate(BaseModel):
    user_id: int | None = None
