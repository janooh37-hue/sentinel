"""Fleet vehicle, fine, accident, maintenance, and file schemas."""

from __future__ import annotations

from datetime import date as date_t
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

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


class VehiclePhotoRead(ORMBase):
    id: int
    label_ar: str | None
    label_en: str | None
    original_name: str
    thumbnail_url: str
    preview_url: str
    full_url: str
    width: int | None
    height: int | None
    usage_count: int


class _VehicleOptionalText(BaseModel):
    """Blank optional vehicle text means "not recorded", so it is stored as NULL.

    Shared by ``VehicleCreate`` and ``VehicleUpdate`` so a field cannot be
    normalized on one and left raw on the other. ``check_fields=False`` is
    required because the fields live on the subclasses;
    ``test_blank_optional_text_becomes_null`` covers every listed field on both
    verbs, so a field renamed out from under this list fails a test rather than
    silently losing its normalization.
    """

    @field_validator(
        "vin",
        "contract_note_ar",
        "contract_note_en",
        "make",
        "model",
        "colour",
        "accessories_ar",
        "accessories_en",
        "notes_ar",
        "notes_en",
        check_fields=False,
    )
    @classmethod
    def _blank_is_unknown(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


class VehicleCreate(_VehicleOptionalText):
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
    photo_asset_id: int | None = None
    license_file_id: int | None = None
    make: str | None = Field(default=None, max_length=128)
    model: str | None = Field(default=None, max_length=128)
    model_year: int | None = Field(default=None, ge=1000, le=9999)
    colour: str | None = Field(default=None, max_length=64)
    insurance_expiry: date_t | None = None
    inmate_capacity: int | None = Field(default=None, ge=0)
    passenger_capacity: int | None = Field(default=None, ge=0)
    accessories_ar: str | None = Field(default=None, max_length=2048)
    accessories_en: str | None = Field(default=None, max_length=2048)
    notes_ar: str | None = Field(default=None, max_length=2048)
    notes_en: str | None = Field(default=None, max_length=2048)

    @model_validator(mode="after")
    def _validate_site_and_dates(self) -> VehicleCreate:
        if (self.site_id is None) == (self.new_site is None):
            raise ValueError("Exactly one of site_id or new_site is required")
        if self.license_expiry <= self.license_start:
            raise ValueError("license_expiry must be after license_start")
        return self


class VehicleUpdate(_VehicleOptionalText):
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
    photo_asset_id: int | None = None
    license_file_id: int | None = None
    make: str | None = Field(default=None, max_length=128)
    model: str | None = Field(default=None, max_length=128)
    model_year: int | None = Field(default=None, ge=1000, le=9999)
    colour: str | None = Field(default=None, max_length=64)
    insurance_expiry: date_t | None = None
    inmate_capacity: int | None = Field(default=None, ge=0)
    passenger_capacity: int | None = Field(default=None, ge=0)
    accessories_ar: str | None = Field(default=None, max_length=2048)
    accessories_en: str | None = Field(default=None, max_length=2048)
    notes_ar: str | None = Field(default=None, max_length=2048)
    notes_en: str | None = Field(default=None, max_length=2048)

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
    photo_asset_id: int | None = None
    photo_url: str | None = None
    photo_thumbnail_url: str | None = None
    photo_full_url: str | None = None
    make: str | None = None
    model: str | None = None
    model_year: int | None = None
    colour: str | None = None
    insurance_expiry: date_t | None = None
    insurance_status: VehicleExpiryStatus | None = None
    days_to_insurance_expiry: int | None = None
    archived_at: datetime | None = None


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
    inmate_capacity: int | None = None
    passenger_capacity: int | None = None
    accessories_ar: str | None = None
    accessories_en: str | None = None
    notes_ar: str | None = None
    notes_en: str | None = None
    photo_asset_id: int | None = None
    license_file_id: int | None = None
    license_files: list[VehicleFileRead] = Field(default_factory=list)


class VehiclesSummary(BaseModel):
    vehicles: int
    fines_count: int
    fines_amount: int
    black_points: int
    license_attention: int
    insurance_attention: int
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


class EvgPreviewResponse(ORMBase):
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


class EvgPreviewJobCreated(BaseModel):
    job_id: str


class EvgPreviewJobStatus(BaseModel):
    job_id: str
    status: Literal["queued", "running", "done", "failed"]
    result: EvgPreviewResponse | None = None
    error_code: str | None = None
    error_message: str | None = None


VehicleScanWarning = Literal["OCR_UNAVAILABLE", "OCR_NO_FIELDS", "OCR_REVIEW_REQUIRED"]


class VehicleProfileScan(BaseModel):
    plate_code: str | None = None
    plate_number: str | None = None
    traffic_code: str | None = None
    vin: str | None = None
    make: str | None = None
    model: str | None = None
    model_year: int | None = None
    colour: str | None = None
    type_ar: str | None = None
    type_en: str | None = None
    class_ar: str | None = None
    class_en: str | None = None
    license_start: date_t | None = None
    license_expiry: date_t | None = None
    insurance_expiry: date_t | None = None
    unmapped: dict[str, str] = Field(default_factory=dict)
    warnings: list[VehicleScanWarning] = Field(default_factory=list)


VehicleImportImageKind = Literal["photo", "license"]
VehicleImportAction = Literal[
    "create",
    "update",
    "unchanged",
    "invalid",
    "archived",
    "excluded",
]
VehicleImportFileAction = Literal["keep_current", "use_imported"]
VehicleImportScalar = str | int | None


class VehicleImportIssue(BaseModel):
    row_id: str | None = None
    field: str | None = None
    code: str
    message: str


class VehicleImportSection(BaseModel):
    id: str
    sheet: str
    title: str


class VehicleImportInspectRow(BaseModel):
    row_id: str
    section_id: str
    sheet: str
    row_number: int
    raw: dict[str, str | None]
    values: dict[str, VehicleImportScalar]
    image_ids: list[str] = Field(default_factory=list)


class VehicleImportImage(BaseModel):
    image_id: str
    url: str
    row_id: str | None = None
    original_name: str
    kind: VehicleImportImageKind | None = None


class VehicleImportInspection(ORMBase):
    token: str
    expires_at: datetime
    filename: str
    sections: list[VehicleImportSection]
    rows: list[VehicleImportInspectRow]
    images: list[VehicleImportImage]
    warnings: list[VehicleImportIssue] = Field(default_factory=list)


class VehicleImportPreviewDraftRow(BaseModel):
    row_id: str
    excluded: bool = False
    values: dict[str, VehicleImportScalar]
    image_ids: list[str] = Field(default_factory=list)
    image_roles: dict[str, VehicleImportImageKind] = Field(default_factory=dict)
    photo_action: VehicleImportFileAction | None = None
    primary_image_id: str | None = None
    license_action: VehicleImportFileAction | None = None
    license_image_id: str | None = None
    ocr_reviewed_image_ids: list[str] = Field(default_factory=list)
    ocr_manual_image_ids: list[str] = Field(default_factory=list)
    ocr_identity_confirmed_image_ids: list[str] = Field(default_factory=list)


class VehicleImportPreviewRequest(BaseModel):
    site_mappings: dict[str, int] = Field(default_factory=dict)
    rows: list[VehicleImportPreviewDraftRow]
    excluded_image_ids: list[str] = Field(default_factory=list)


class VehicleImportChange(BaseModel):
    field: str
    before: VehicleImportScalar
    after: VehicleImportScalar


class VehicleImportPreviewRow(BaseModel):
    row_id: str
    action: VehicleImportAction
    vehicle_id: int | None = None
    values: dict[str, VehicleImportScalar]
    changes: list[VehicleImportChange] = Field(default_factory=list)
    errors: list[VehicleImportIssue] = Field(default_factory=list)
    warnings: list[VehicleImportIssue] = Field(default_factory=list)
    current_photo_url: str | None = None
    current_license_url: str | None = None
    images: list[VehicleImportImage] = Field(default_factory=list)
    photo_choice_required: bool = False
    license_choice_required: bool = False
    ocr_review_required: bool = False


class VehicleImportCounts(BaseModel):
    create: int = 0
    update: int = 0
    unchanged: int = 0
    invalid: int = 0
    archived: int = 0
    excluded: int = 0


class VehicleImportPreview(BaseModel):
    revision: str
    rows: list[VehicleImportPreviewRow]
    counts: VehicleImportCounts


class VehicleImportConfirmRequest(BaseModel):
    revision: str
    row_ids: list[str]


class VehicleImportResult(BaseModel):
    created: int
    updated: int
    unchanged: int
    images_added: int
    images_skipped: int
    vehicle_ids: list[int]
