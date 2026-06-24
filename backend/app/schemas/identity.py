"""Pydantic schemas for the identity endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field


class IdentityRead(BaseModel):
    """Resolved identity for the configured EmailAccount.

    Returns ``linked=False`` plus operator defaults when no account is
    configured, or no employee has been linked. This lets the frontend
    handle one shape unconditionally.
    """

    linked: bool
    employee_id: str | None = None
    email: str | None = None
    name_en: str | None = None
    name_ar: str | None = None
    position: str | None = None
    department: str | None = None
    photo_url: str | None = None
    role: str = "operator"
    is_admin: bool = False
    is_manager: bool = False


class TransferAdminRequest(BaseModel):
    employee_id: str = Field(min_length=1, max_length=16)
