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

# The security zones a permit can cover. A permit carries one or more.
PermitZone = Literal["green", "red", "work_residence"]
# Stored lifecycle. Expiry is derived, not stored (see models.Permit).
PermitStatus = Literal["active", "revoked"]
# What the UI shows — stored status widened with the date-derived states.
PermitDerivedStatus = Literal["active", "expiring", "expired", "revoked"]


class PermitPersonCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # UAE ID is mandatory for every person on a permit.
    uae_id: str = Field(min_length=1, max_length=32)
    nationality: str | None = Field(default=None, max_length=64)
    role: str | None = Field(default=None, max_length=128)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        return v

    @field_validator("uae_id")
    @classmethod
    def _strip_uae_id(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("uae_id is required")
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
    # Basename of the attached UAE ID scan, if any (path is never exposed).
    id_doc_name: str | None = None


class PermitVehicleCreate(BaseModel):
    # Optional — a vehicle may be added from its licence scan (OCR fills it).
    plate_no: str | None = Field(default=None, max_length=32)
    plate_emirate: str | None = Field(default=None, max_length=32)
    make_model: str | None = Field(default=None, max_length=128)
    driver_name: str | None = Field(default=None, max_length=255)
    colour: str | None = Field(default=None, max_length=32)
    vehicle_type: str | None = Field(default=None, max_length=64)
    plate_category: str | None = Field(default=None, max_length=32)
    traffic_no: str | None = Field(default=None, max_length=32)
    reg_expiry: date | None = None

    @field_validator("plate_no")
    @classmethod
    def _strip_plate(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class PermitVehicleRead(ORMBase):
    id: int
    permit_id: int
    plate_no: str | None = None
    plate_emirate: str | None = None
    make_model: str | None = None
    driver_name: str | None = None
    colour: str | None = None
    vehicle_type: str | None = None
    plate_category: str | None = None
    traffic_no: str | None = None
    reg_expiry: date | None = None
    created_at: datetime
    removed_at: datetime | None = None
    # Basename of the attached vehicle-licence scan, if any.
    license_doc_name: str | None = None


def _clean_zones(v: list[str]) -> list[str]:
    """De-duplicate (order-preserving) and require at least one zone."""
    seen: list[str] = []
    for z in v:
        if z not in seen:
            seen.append(z)
    if not seen:
        raise ValueError("at least one zone is required")
    return seen


class PermitCreate(BaseModel):
    """POST /permits — issue a new permit."""

    company: str = Field(min_length=1, max_length=255)
    zones: list[PermitZone] = Field(min_length=1)
    start_date: date
    end_date: date
    purpose: str | None = None
    notes: str | None = None
    people: list[PermitPersonCreate] = Field(default_factory=list)
    vehicles: list[PermitVehicleCreate] = Field(default_factory=list)
    manager_id: int | None = None

    @field_validator("company")
    @classmethod
    def _strip_company(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("company must not be empty")
        return v

    @field_validator("zones")
    @classmethod
    def _dedupe_zones(cls, v: list[str]) -> list[str]:
        return _clean_zones(v)


class PermitUpdate(BaseModel):
    """PATCH /permits/{id} — edit header fields (not the lifecycle status)."""

    company: str | None = Field(default=None, min_length=1, max_length=255)
    zones: list[PermitZone] | None = None
    start_date: date | None = None
    end_date: date | None = None
    purpose: str | None = None
    notes: str | None = None

    @field_validator("zones")
    @classmethod
    def _dedupe_zones(cls, v: list[str] | None) -> list[str] | None:
        return _clean_zones(v) if v is not None else None


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
    zones: list[PermitZone]
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
    vehicle_count: int = 0
    # Basename of the attached permit scan, if any (path is never exposed).
    document_name: str | None = None
    manager_id: int | None = None
    book_id: int | None = None
    book_ref: str | None = None
    people: list[PermitPersonRead] = Field(default_factory=list)
    vehicles: list[PermitVehicleRead] = Field(default_factory=list)


class PermitListItem(ORMBase):
    id: int
    permit_no: str | None = None
    company: str
    zones: list[PermitZone]
    start_date: date
    end_date: date
    status: PermitStatus
    created_at: datetime
    derived_status: PermitDerivedStatus = "active"
    duration_days: int = 0
    days_remaining: int | None = None
    people_count: int = 0
    vehicle_count: int = 0
    has_document: bool = False


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
    people_work_residence: int


class VehicleLicenceScan(BaseModel):
    """OCR pre-fill result for a vehicle licence (mulkiya). All optional; the
    operator confirms/edits every field before saving."""

    plate_no: str | None = None
    plate_emirate: str | None = None
    plate_category: str | None = None
    traffic_no: str | None = None
    make_model: str | None = None
    vehicle_type: str | None = None
    colour: str | None = None
    reg_expiry: date | None = None
    driver_name: str | None = None


class PersonIdScan(BaseModel):
    """OCR pre-fill result for an Emirates ID."""

    name: str | None = None
    uae_id: str | None = None
    nationality: str | None = None
