"""Security-permit schemas.

Wire shapes for the ``/permits`` register. Zone and lifecycle values are
constrained with ``Literal`` (the codebase has no DB-level enums — allowed
values live in the schema and the service). ``derived_status`` and
``days_remaining`` are computed in the service and never client-settable.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

from app.core.permit_validity import (
    PermitValidityUnit,
    validate_period,
    validate_period_read,
)
from app.schemas._base import ORMBase

# The security zones a permit can cover. A permit carries one or more.
PermitZone = Literal["green", "red", "work_residence"]
PermitLocationZone = Literal["green", "red"]
_LOCATION_ZONE_ORDER: tuple[PermitLocationZone, ...] = ("green", "red")
# Stored lifecycle. Expiry is derived, not stored (see models.Permit).
PermitStatus = Literal["active", "revoked"]
# What the UI shows — stored status widened with the date-derived states.
PermitDerivedStatus = Literal["active", "expiring", "expired", "revoked"]


class PermitValidityPeriod(BaseModel):
    value: int
    unit: PermitValidityUnit

    @model_validator(mode="after")
    def _validate_bounds(self) -> PermitValidityPeriod:
        validate_period(self.value, self.unit)
        return self


class PermitValidityRead(BaseModel):
    value: int
    unit: PermitValidityUnit

    @model_validator(mode="after")
    def _validate_positive(self) -> PermitValidityRead:
        validate_period_read(self.value, self.unit)
        return self


class PermitAccessAreas(BaseModel):
    al_wathba_1: list[PermitLocationZone] = Field(default_factory=list)
    al_wathba_2: list[PermitLocationZone] = Field(default_factory=list)
    work_residence: bool = False

    @field_validator("al_wathba_1", "al_wathba_2")
    @classmethod
    def _normalize_location_zones(
        cls, value: list[PermitLocationZone]
    ) -> list[PermitLocationZone]:
        return [zone for zone in _LOCATION_ZONE_ORDER if zone in value]

    @model_validator(mode="after")
    def _require_access(self) -> PermitAccessAreas:
        if not self.al_wathba_1 and not self.al_wathba_2 and not self.work_residence:
            raise ValueError("at least one access area is required")
        return self


class PermitPersonCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # UAE ID is mandatory for every person on a permit.
    uae_id: str = Field(min_length=1, max_length=32)
    nationality: str | None = Field(default=None, max_length=64)
    role: str = Field(min_length=1, max_length=128)

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

    @field_validator("role")
    @classmethod
    def _strip_role(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("role is required")
        return value


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


class PermitVehicleUpdate(BaseModel):
    """PATCH /permits/{id}/vehicles/{vid} — edit fields of an existing vehicle.

    A partial patch: only the fields sent are changed (``exclude_unset`` in the
    service). Used to back-fill the plate emirate on vehicles added before the
    dropdown existed.
    """

    plate_no: str | None = Field(default=None, max_length=32)
    plate_emirate: str | None = Field(default=None, max_length=32)
    make_model: str | None = Field(default=None, max_length=128)
    driver_name: str | None = Field(default=None, max_length=255)
    colour: str | None = Field(default=None, max_length=32)
    vehicle_type: str | None = Field(default=None, max_length=64)
    plate_category: str | None = Field(default=None, max_length=32)
    traffic_no: str | None = Field(default=None, max_length=32)
    reg_expiry: date | None = None


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



class PermitCreate(BaseModel):
    """POST /permits — issue a new permit."""

    model_config = ConfigDict(extra="forbid")

    company: str = Field(min_length=1, max_length=255)
    access_areas: PermitAccessAreas
    start_date: date
    validity: PermitValidityPeriod
    purpose: str | None = None
    notes: str | None = None
    people: list[PermitPersonCreate] = Field(default_factory=list)
    vehicles: list[PermitVehicleCreate] = Field(default_factory=list)
    manager_id: int | None = None
    # When True, the generated 1/5 letter is submitted straight into the book
    # approval chain. Default True = a new permit reaches its signing manager
    # without a second step; turn it off to hold the letter as a draft.
    send_for_approval: bool = True

    @field_validator("company")
    @classmethod
    def _strip_company(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("company must not be empty")
        return v


class PermitUpdate(BaseModel):
    """PATCH /permits/{id} — edit header fields (not the lifecycle status)."""

    model_config = ConfigDict(extra="forbid")

    company: str | None = Field(default=None, min_length=1, max_length=255)
    access_areas: PermitAccessAreas | SkipJsonSchema[None] = None
    start_date: date | None = None
    validity: PermitValidityPeriod | None = None
    purpose: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _reject_explicit_null_access(self) -> PermitUpdate:
        if "access_areas" in self.model_fields_set and self.access_areas is None:
            raise ValueError("access_areas must not be null when supplied")
        return self


class PermitRenew(BaseModel):
    """POST /permits/{id}/renew — extend the permit window."""

    model_config = ConfigDict(extra="forbid")

    validity: PermitValidityPeriod
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
    access_areas: PermitAccessAreas | None = None
    start_date: date
    validity: PermitValidityRead
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
    # The linked book's approval state, verbatim:
    # none | pending | approved | rejected | returned. None when no book.
    approval_state: str | None = None
    people: list[PermitPersonRead] = Field(default_factory=list)
    vehicles: list[PermitVehicleRead] = Field(default_factory=list)


class PermitListItem(ORMBase):
    id: int
    permit_no: str | None = None
    company: str
    zones: list[PermitZone]
    access_areas: PermitAccessAreas | None = None
    start_date: date
    validity: PermitValidityRead
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
