"""Security-permit schemas.

Wire shapes for the ``/permits`` register. Zone and lifecycle values are
constrained with ``Literal`` (the codebase has no DB-level enums — allowed
values live in the schema and the service). ``derived_status`` and
``days_remaining`` are computed in the service and never client-settable.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas._base import ORMBase

# green-only, red-only, or valid in both zones.
PermitZone = Literal["green", "red", "both"]
# Stored lifecycle. Expiry is derived, not stored (see models.Permit).
PermitStatus = Literal["active", "revoked"]
# What the UI shows — stored status widened with the date-derived states.
PermitDerivedStatus = Literal["active", "expiring", "expired", "revoked"]


class PermitPersonCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    uae_id: str | None = Field(default=None, max_length=32)
    nationality: str | None = Field(default=None, max_length=64)
    role: str | None = Field(default=None, max_length=128)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        return v


class PermitPersonRead(ORMBase):
    id: int
    permit_id: int
    name: str
    uae_id: str | None = None
    nationality: str | None = None
    role: str | None = None
    created_at: datetime
    removed_at: datetime | None = None


class PermitCreate(BaseModel):
    """POST /permits — issue a new permit."""

    company: str = Field(min_length=1, max_length=255)
    zone: PermitZone = "green"
    start_date: date
    end_date: date
    purpose: str | None = None
    notes: str | None = None
    people: list[PermitPersonCreate] = Field(default_factory=list)

    @field_validator("company")
    @classmethod
    def _strip_company(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("company must not be empty")
        return v


class PermitUpdate(BaseModel):
    """PATCH /permits/{id} — edit header fields (not the lifecycle status)."""

    company: str | None = Field(default=None, min_length=1, max_length=255)
    zone: PermitZone | None = None
    start_date: date | None = None
    end_date: date | None = None
    purpose: str | None = None
    notes: str | None = None


class PermitRenew(BaseModel):
    """POST /permits/{id}/renew — extend the permit window."""

    new_end_date: date
    reason: str | None = None


class PermitRevoke(BaseModel):
    """POST /permits/{id}/revoke — end a permit before its expiry."""

    reason: str | None = None


class PermitVisitCreate(BaseModel):
    """POST /permits/{id}/visits — gate/UAE-ID scanner hook (no v1 UI)."""

    direction: Literal["in", "out"] = "in"
    person_id: int | None = None
    uae_id: str | None = Field(default=None, max_length=32)
    gate: str | None = Field(default=None, max_length=64)
    occurred_at: datetime | None = None
    source: Literal["manual", "gate"] = "manual"


class PermitVisitRead(ORMBase):
    id: int
    permit_id: int
    person_id: int | None = None
    direction: str
    occurred_at: datetime
    uae_id: str | None = None
    gate: str | None = None
    source: str
    created_at: datetime


class PermitRead(ORMBase):
    id: int
    permit_no: str | None = None
    company: str
    zone: PermitZone
    start_date: date
    end_date: date
    status: PermitStatus
    purpose: str | None = None
    notes: str | None = None
    revoked_at: datetime | None = None
    revoke_reason: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    # Computed fields (stamped by the service).
    derived_status: PermitDerivedStatus = "active"
    duration_days: int = 0
    days_remaining: int | None = None
    people_count: int = 0
    people: list[PermitPersonRead] = Field(default_factory=list)


class PermitListItem(ORMBase):
    id: int
    permit_no: str | None = None
    company: str
    zone: PermitZone
    start_date: date
    end_date: date
    status: PermitStatus
    created_at: datetime
    derived_status: PermitDerivedStatus = "active"
    duration_days: int = 0
    days_remaining: int | None = None
    people_count: int = 0


class PermitListResponse(BaseModel):
    items: list[PermitListItem]
    total: int
    limit: int
    offset: int


class PermitSummary(BaseModel):
    """Dashboard-tile counts for the register."""

    active: int
    expiring: int
    expired: int
    revoked: int
    people_active: int
    people_green: int
    people_red: int
