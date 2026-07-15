"""Employee schemas.

Two non-obvious rules enforced here so the route layer stays thin:

* **Canonical status.** v3 stored bilingual labels like ``"Active - نشط"`` in
  the spreadsheet, but Phase 02's importer collapsed them to the English half
  before insert. Phase 03 locks that in: the API only accepts and returns
  ``Active``, ``Resigned``, ``Terminated``. Frontend renders the bilingual
  label from i18n.
* **status / end_date invariant.** Mirrors v3.5.4's
  ``_emp_sync_end_date_widget`` (line 3282): once an employee is no longer
  Active, an ``end_date`` is required. We enforce it on Create and on Update
  (where the validator has to merge the patch against the current row, hence
  :func:`validate_status_end_date` exposed for the service layer to call).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Final, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas._base import ORMBase

# Canonical English-only status values stored in DB.
EMPLOYEE_STATUS_ACTIVE: Final = "Active"
EMPLOYEE_STATUS_RESIGNED: Final = "Resigned"
EMPLOYEE_STATUS_TERMINATED: Final = "Terminated"

EmployeeStatus = Literal["Active", "Resigned", "Terminated"]
EMPLOYEE_STATUSES: Final[tuple[EmployeeStatus, ...]] = (
    EMPLOYEE_STATUS_ACTIVE,
    EMPLOYEE_STATUS_RESIGNED,
    EMPLOYEE_STATUS_TERMINATED,
)

MsgLanguage = Literal["ar", "en"]

# Upper bounds for free-text fields so a single write can't bloat the shared DB
# (API-02). Short identity/contact fields get a tight cap; free-form prose
# (notes/other) gets a generous one.
_SHORT_TEXT_MAX: Final = 256
_FIELD_TEXT_MAX: Final = 128
_LONG_TEXT_MAX: Final = 4000


def validate_status_end_date(status: str, end_date: date | None) -> None:
    """Raise ``ValueError`` if status implies an end_date and one is missing.

    Exposed at module level so the service layer can re-run it after merging
    a partial PATCH against the current DB row.
    """
    if status != EMPLOYEE_STATUS_ACTIVE and end_date is None:
        raise ValueError(f"end_date is required when status is {status!r}")


class EmployeeCreate(BaseModel):
    id: str = Field(min_length=1, max_length=16)
    name_en: str = Field(min_length=1, max_length=256)
    name_ar: str | None = Field(default=None, max_length=_SHORT_TEXT_MAX)
    dob: date | None = None
    doj: date | None = None
    doj_company: date | None = None
    status: EmployeeStatus = EMPLOYEE_STATUS_ACTIVE
    end_date: date | None = None
    department: str | None = Field(default=None, max_length=_SHORT_TEXT_MAX)
    position: str | None = Field(default=None, max_length=_SHORT_TEXT_MAX)
    position_ar: str | None = Field(default=None, max_length=_SHORT_TEXT_MAX)
    other: str | None = Field(default=None, max_length=_LONG_TEXT_MAX)
    duty_unit: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    duty_post: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    notes: str | None = Field(default=None, max_length=_LONG_TEXT_MAX)
    passport_no: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    uae_id_no: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    nationality: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    contact: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    msg_language: MsgLanguage = "ar"
    passport_expiry: date | None = None
    uae_id_expiry: date | None = None
    iban: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)

    @model_validator(mode="after")
    def _check_status_end_date(self) -> EmployeeCreate:
        validate_status_end_date(self.status, self.end_date)
        return self


class EmployeeUpdate(BaseModel):
    name_en: str | None = Field(default=None, min_length=1, max_length=256)
    name_ar: str | None = Field(default=None, max_length=_SHORT_TEXT_MAX)
    dob: date | None = None
    doj: date | None = None
    doj_company: date | None = None
    status: EmployeeStatus | None = None
    end_date: date | None = None
    department: str | None = Field(default=None, max_length=_SHORT_TEXT_MAX)
    position: str | None = Field(default=None, max_length=_SHORT_TEXT_MAX)
    position_ar: str | None = Field(default=None, max_length=_SHORT_TEXT_MAX)
    other: str | None = Field(default=None, max_length=_LONG_TEXT_MAX)
    duty_unit: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    duty_post: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    notes: str | None = Field(default=None, max_length=_LONG_TEXT_MAX)
    passport_no: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    uae_id_no: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    nationality: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    contact: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)
    msg_language: MsgLanguage | None = None
    passport_expiry: date | None = None
    uae_id_expiry: date | None = None
    iban: str | None = Field(default=None, max_length=_FIELD_TEXT_MAX)

    # Note: the status / end_date invariant on PATCH requires the current
    # row, so the service layer (`update_employee`) runs
    # `validate_status_end_date` on the merged values instead.


class EmployeeRead(ORMBase):
    id: str
    name_en: str
    name_ar: str | None
    dob: date | None
    doj: date | None
    doj_company: date | None
    status: EmployeeStatus
    end_date: date | None
    department: str | None
    position: str | None
    position_ar: str | None
    other: str | None
    duty_unit: str | None
    duty_post: str | None
    notes: str | None
    passport_no: str | None
    uae_id_no: str | None
    nationality: str | None
    contact: str | None
    msg_language: str = "ar"
    passport_expiry: date | None
    uae_id_expiry: date | None
    iban: str | None
    created_at: datetime
    updated_at: datetime
    # True when the employee has a vault photo on file (kind='photo').
    has_photo: bool = False
    # Cache-bust token (the photo VaultFile.id as a string) so the avatar <img>
    # refetches after a replace. None when the employee has no photo.
    photo_version: str | None = None
    passport_no_source: str | None = None
    # True when the employee has at least one passport-kind vault scan on file.
    has_passport_scan: bool = False


class EmployeeListItem(ORMBase):
    """Minimal projection for the list endpoint — keep the wire small."""

    id: str
    name_en: str
    name_ar: str | None
    status: EmployeeStatus
    department: str | None
    position: str | None
    position_ar: str | None = None
    duty_unit: str | None = None
    duty_post: str | None = None
    # True when the employee has a vault photo on file (kind='photo').
    has_photo: bool = False
    # Raw contact number as stored on the employee (used for WhatsApp mentions).
    contact: str | None = None


class EmployeeListResponse(BaseModel):
    items: list[EmployeeListItem]
    total: int
    limit: int
    offset: int
