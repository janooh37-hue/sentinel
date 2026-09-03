"""Fleet vehicle, fine, accident, maintenance, and file schemas."""

from __future__ import annotations

from datetime import date as date_t
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas._base import ORMBase

VehicleFileKind = Literal["photo", "license", "gallery", "accident", "receipt"]
VehicleExpiryStatus = Literal["valid", "due", "expired"]
MaintenanceDueState = Literal["overdue", "due", "scheduled"]
MaintenanceType = Literal["service", "repair", "tires", "other"]
AccidentStatus = Literal["open", "closed"]

_TIME_PATTERN = r"^(?:[01]\d|2[0-3]):[0-5]\d$"


class VehicleSiteCreate(BaseModel):
    name_ar: str = Field(min_length=1)
    name_en: str = Field(min_length=1)


class VehicleSiteUpdate(BaseModel):
    name_ar: str | None = Field(default=None, min_length=1)
    name_en: str | None = Field(default=None, min_length=1)
    active: bool | None = None


class VehicleSiteRead(ORMBase):
    id: int
    name_ar: str
    name_en: str
    active: bool
    vehicle_count: int = 0


class VehicleFileRead(ORMBase):
    id: int
    kind: VehicleFileKind
    label_ar: str | None
    label_en: str | None
    original_name: str
    media_type: str
    url: str = ""


class VehicleCreate(BaseModel):
    plate_code: str | None = Field(default=None, pattern=r"^\d{1,3}$")
    plate_number: str = Field(pattern=r"^\d{1,6}$")
    traffic_code: str = Field(pattern=r"^\d{4,12}$")
    type_ar: str = Field(min_length=1)
    type_en: str = Field(min_length=1)
    class_ar: str = Field(min_length=1)
    class_en: str = Field(min_length=1)
    vin: str | None = None
    site_id: int | None = None
    new_site: VehicleSiteCreate | None = None
    contract_note_ar: str | None = None
    contract_note_en: str | None = None
    license_start: date_t
    license_expiry: date_t
    photo_file_id: int | None = None
    license_file_id: int | None = None

    @model_validator(mode="after")
    def _validate_site_and_dates(self) -> VehicleCreate:
        if (self.site_id is None) == (self.new_site is None):
            raise ValueError("Exactly one of site_id or new_site is required")
        if self.license_expiry <= self.license_start:
            raise ValueError("license_expiry must be after license_start")
        return self


class VehicleUpdate(BaseModel):
    plate_code: str | None = Field(default=None, pattern=r"^\d{1,3}$")
    plate_number: str | None = Field(default=None, pattern=r"^\d{1,6}$")
    traffic_code: str | None = Field(default=None, pattern=r"^\d{4,12}$")
    type_ar: str | None = Field(default=None, min_length=1)
    type_en: str | None = Field(default=None, min_length=1)
    class_ar: str | None = Field(default=None, min_length=1)
    class_en: str | None = Field(default=None, min_length=1)
    vin: str | None = None
    site_id: int | None = None
    contract_note_ar: str | None = None
    contract_note_en: str | None = None
    license_start: date_t | None = None
    license_expiry: date_t | None = None
    photo_file_id: int | None = None
    license_file_id: int | None = None

    @model_validator(mode="after")
    def _validate_dates(self) -> VehicleUpdate:
        if (
            self.license_start is not None
            and self.license_expiry is not None
            and self.license_expiry <= self.license_start
        ):
            raise ValueError("license_expiry must be after license_start")
        return self


class VehicleListItem(ORMBase):
    id: int
    plate_code: str | None
    plate_number: str
    plate_label: str = ""
    traffic_code: str
    type_ar: str
    type_en: str
    class_ar: str
    class_en: str
    vin: str | None
    site_id: int
    license_start: date_t
    license_expiry: date_t
    expiry_status: VehicleExpiryStatus = "valid"
    days_to_expiry: int = 0
    fines_count: int = 0
    fines_amount: int = 0
    black_points: int = 0
    photo_url: str | None = None


class VehicleFineCreate(BaseModel):
    employee_id: str | None = None
    date: date_t
    time: str | None = None
    amount: int = Field(ge=1)
    black_points: int = Field(default=0, ge=0)
    location: str | None = None
    description: str | None = None


class VehicleFineUpdate(BaseModel):
    employee_id: str | None = None
    date: date_t | None = None
    time: str | None = None
    amount: int | None = Field(default=None, ge=1)
    black_points: int | None = Field(default=None, ge=0)
    location: str | None = None
    description: str | None = None


class VehicleFineRead(ORMBase):
    id: int
    vehicle_id: int
    employee_id: str | None
    employee_name_ar: str | None = None
    employee_name_en: str | None = None
    date: date_t
    time: str | None
    amount: int
    amount_after_discount: int | None
    black_points: int
    source: Literal["manual", "evg"]
    evg_ticket_no: str | None
    location: str | None
    description: str | None
    fine_type: str | None
    created_at: datetime
    vehicle_plate_label: str = ""
    vehicle_type_ar: str = ""
    vehicle_type_en: str = ""
    vehicle_site_id: int = 0


class FinesLetterRequest(BaseModel):
    fine_ids: list[int] = Field(min_length=1)
    hide_names: bool = False


class LetterResult(BaseModel):
    book_id: int
    document_id: int
    ref_number: str
    pdf_available: bool


class LicenseRenewCreate(BaseModel):
    start: date_t
    expiry: date_t
    cost: int = Field(ge=0)
    scan_file_id: int | None = None

    @model_validator(mode="after")
    def _validate_dates(self) -> LicenseRenewCreate:
        if self.expiry <= self.start:
            raise ValueError("expiry must be after start")
        return self


class LicenseRenewalRead(ORMBase):
    id: int
    start: date_t
    expiry: date_t
    renewed_on: date_t
    cost: int | None
    scan_url: str | None = None


class VehicleAccidentCreate(BaseModel):
    vehicle_id: int
    employee_id: str | None = None
    date: date_t
    time: str = Field(pattern=_TIME_PATTERN)
    location_ar: str = Field(min_length=1)
    location_en: str | None = None
    description_ar: str = Field(min_length=1)
    description_en: str | None = None
    police_ref: str | None = None
    damage_cost: int = Field(default=0, ge=0)
    photo_file_ids: list[int] = Field(default_factory=list)


class VehicleAccidentStatusUpdate(BaseModel):
    status: AccidentStatus


class VehicleAccidentRead(ORMBase):
    id: int
    vehicle_id: int
    employee_id: str | None
    employee_name_ar: str | None = None
    employee_name_en: str | None = None
    date: date_t
    time: str | None
    location_ar: str
    location_en: str | None
    description_ar: str
    description_en: str | None
    police_ref: str | None
    damage_cost: int
    status: AccidentStatus
    photo_file_ids: list[int]
    photos: list[VehicleFileRead] = Field(default_factory=list)
    letter_book_id: int | None
    created_at: datetime
    updated_at: datetime | None
    vehicle_plate_label: str = ""
    vehicle_type_ar: str = ""
    vehicle_type_en: str = ""
    vehicle_vin: str | None = None
    vehicle_site_id: int = 0


class VehicleMaintenanceCreate(BaseModel):
    vehicle_id: int
    date: date_t
    type: MaintenanceType
    odometer_km: int | None = None
    cost: int = Field(default=0, ge=0)
    vendor_ar: str | None = None
    vendor_en: str | None = None
    next_due: date_t | None = None
    receipt_file_id: int | None = None


class VehicleMaintenanceRead(ORMBase):
    id: int
    vehicle_id: int
    date: date_t
    type: MaintenanceType
    odometer_km: int | None
    cost: int
    vendor_ar: str | None
    vendor_en: str | None
    next_due: date_t | None
    receipt_file_id: int | None
    created_at: datetime
    due_state: MaintenanceDueState | None = None
    receipt_url: str | None = None
    vehicle_plate_label: str = ""
    vehicle_type_ar: str = ""
    vehicle_type_en: str = ""


class VehicleRead(VehicleListItem):
    contract_note_ar: str | None
    contract_note_en: str | None
    license_url: str | None = None
    fines: list[VehicleFineRead] = Field(default_factory=list)
    renewals: list[LicenseRenewalRead] = Field(default_factory=list)
    accidents: list[VehicleAccidentRead] = Field(default_factory=list)
    maintenance: list[VehicleMaintenanceRead] = Field(default_factory=list)
    photos: list[VehicleFileRead] = Field(default_factory=list)


class VehiclesSummary(BaseModel):
    vehicles: int
    fines_count: int
    fines_amount: int
    black_points: int
    license_attention: int
    open_accidents: int
    maintenance_due: int
    active_sites: int
    notify_days: int


class NotifyDaysUpdate(BaseModel):
    days: int = Field(ge=1, le=365)


EvgMatch = Literal[
    "matched",
    "ambiguous",
    "unmatched",
    "already_imported",
]


class EvgPreviewRequest(BaseModel):
    traffic_codes: list[str] | None = None


class EvgPreviewRow(BaseModel):
    ticket_no: str
    date: date_t
    time: str | None
    location: str
    plate_number: str
    plate_code: str | None
    amount: int = Field(ge=1)
    amount_after_discount: int | None = Field(default=None, ge=0)
    black_points: int = Field(ge=0)
    fine_type: str
    description: str | None
    vehicle_id: int | None
    match: EvgMatch


class EvgVehicleOption(BaseModel):
    id: int
    plate_label: str


class EvgPreviewResponse(BaseModel):
    rows: list[EvgPreviewRow]
    traffic_codes: list[str]
    fetched_at: datetime
    vehicles: list[EvgVehicleOption]


class EvgConfirmRow(EvgPreviewRow):
    vehicle_id: int


class EvgConfirmRequest(BaseModel):
    rows: list[EvgConfirmRow]


class EvgConfirmResult(BaseModel):
    created: int
    skipped: int
