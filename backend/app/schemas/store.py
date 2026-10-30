"""Assets store schemas: categories, Store items, Batches, deliveries, counts, disposals."""

from __future__ import annotations

import calendar
import re
from datetime import date as date_t
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.clock import organization_today
from app.schemas._base import ORMBase

StoreDisposalReason = Literal["expired", "damaged"]
StoreMovementKind = Literal["in", "out", "disposed"]

_EXPIRY_PATTERN = re.compile(r"^(\d{4})-(\d{2})(?:-(\d{2}))?$")


def parse_expiry(value: str | None) -> tuple[date_t | None, bool]:
    """``YYYY-MM-DD`` → (date, False); ``YYYY-MM`` → (last day, True); null → undated."""
    if value is None:
        return None, False
    match = _EXPIRY_PATTERN.fullmatch(value)
    if match is None:
        raise ValueError("expiry must be YYYY-MM-DD, YYYY-MM, or null")
    year, month = int(match.group(1)), int(match.group(2))
    if match.group(3) is None:
        if not 1 <= month <= 12:
            raise ValueError("expiry month must be 01-12")
        return date_t(year, month, calendar.monthrange(year, month)[1]), True
    return date_t(year, month, int(match.group(3))), False


def _strip(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


# ── Categories ───────────────────────────────────────────────────────────────


class StoreCategoryCreate(BaseModel):
    name_en: str = Field(min_length=1, max_length=128)
    name_ar: str = Field(min_length=1, max_length=128)


class StoreCategoryUpdate(BaseModel):
    name_en: str | None = Field(default=None, min_length=1, max_length=128)
    name_ar: str | None = Field(default=None, min_length=1, max_length=128)


class StoreCategoryRead(ORMBase):
    id: int
    name_en: str
    name_ar: str


# ── Store items ──────────────────────────────────────────────────────────────


class StoreItemCreate(BaseModel):
    name_en: str = Field(min_length=1, max_length=255)
    name_ar: str | None = Field(default=None, max_length=255)
    category_id: int
    counting_unit_en: str = Field(default="Carton", min_length=1, max_length=64)
    counting_unit_ar: str = Field(default="كرتون", min_length=1, max_length=64)
    contains_qty: int | None = Field(default=None, ge=2)
    contains_unit_en: str | None = Field(default=None, max_length=64)
    contains_unit_ar: str | None = Field(default=None, max_length=64)
    minimum_level: int | None = Field(default=None, ge=0)
    art_kind: str | None = None
    art_color: str | None = None

    @field_validator("name_ar", "contains_unit_en", "contains_unit_ar")
    @classmethod
    def _blank_is_null(cls, value: str | None) -> str | None:
        return _strip(value)


class StoreItemUpdate(BaseModel):
    """Partial update; send ``contains_qty`` with both units, or all three null."""

    name_en: str | None = Field(default=None, min_length=1, max_length=255)
    name_ar: str | None = Field(default=None, max_length=255)
    category_id: int | None = None
    counting_unit_en: str | None = Field(default=None, min_length=1, max_length=64)
    counting_unit_ar: str | None = Field(default=None, min_length=1, max_length=64)
    contains_qty: int | None = Field(default=None, ge=2)
    contains_unit_en: str | None = Field(default=None, max_length=64)
    contains_unit_ar: str | None = Field(default=None, max_length=64)
    minimum_level: int | None = Field(default=None, ge=0)
    art_kind: str | None = None
    art_color: str | None = None

    @field_validator("name_ar", "contains_unit_en", "contains_unit_ar")
    @classmethod
    def _blank_is_null(cls, value: str | None) -> str | None:
        return _strip(value)


class StoreItemRead(ORMBase):
    id: int
    code: str
    name_en: str
    name_ar: str | None
    category_id: int
    category: StoreCategoryRead
    counting_unit_en: str
    counting_unit_ar: str
    contains_qty: int | None
    contains_unit_en: str | None
    contains_unit_ar: str | None
    minimum_level: int | None
    art_kind: str | None
    art_color: str | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime | None
    on_hand: int
    version: str


class StorePickerItem(BaseModel):
    id: int
    code: str
    name_en: str
    name_ar: str | None
    counting_unit_en: str
    counting_unit_ar: str
    contains_qty: int | None
    contains_unit_en: str | None
    contains_unit_ar: str | None
    art_kind: str | None
    art_color: str | None


# ── Batches and lines ────────────────────────────────────────────────────────


class StoreItemRef(ORMBase):
    """The Store item fields every Batch-level row carries."""

    item_id: int
    item_code: str
    item_name_en: str
    item_name_ar: str | None
    counting_unit_en: str
    counting_unit_ar: str
    contains_qty: int | None
    contains_unit_en: str | None
    contains_unit_ar: str | None
    art_kind: str | None
    art_color: str | None


class StoreBatchRead(StoreItemRef):
    id: int
    expiry_date: date_t | None
    expiry_month_only: bool
    on_hand: int
    days_to_expiry: int | None


class _LineInput(BaseModel):
    item_id: int
    expiry: str | None = Field(
        default=None,
        description="YYYY-MM-DD, YYYY-MM (expires at the end of that month), or null (undated).",
        examples=["2027-04-26", "2029-01", None],
    )

    @field_validator("expiry")
    @classmethod
    def _valid_expiry(cls, value: str | None) -> str | None:
        parse_expiry(value)
        return value


class StoreDeliveryLineInput(_LineInput):
    quantity: int = Field(ge=1)


class StoreCountLineInput(_LineInput):
    quantity: int = Field(ge=0)


class StoreLineRead(StoreItemRef):
    id: int
    batch_id: int
    expiry_date: date_t | None
    expiry_month_only: bool
    quantity: int


# ── Deliveries ───────────────────────────────────────────────────────────────


class StoreDeliveryCreate(BaseModel):
    received_on: date_t
    note: str | None = None
    lines: list[StoreDeliveryLineInput] = Field(min_length=1)


class StoreDeliveryNoteFile(BaseModel):
    name: str
    media_type: str
    size: int
    url: str


class StoreDeliveryRead(ORMBase):
    id: int
    received_on: date_t
    note: str | None
    note_file: StoreDeliveryNoteFile | None
    lines: list[StoreLineRead]
    created_by_user_id: int | None
    created_at: datetime
    updated_at: datetime | None


# ── Stock counts ─────────────────────────────────────────────────────────────


class StoreCountWrite(BaseModel):
    counted_on: date_t
    note: str | None = None
    lines: list[StoreCountLineInput] = Field(default_factory=list)


class StoreCountRead(ORMBase):
    id: int
    month: str
    counted_on: date_t
    note: str | None
    lines: list[StoreLineRead]
    created_by_user_id: int | None
    created_at: datetime
    updated_at: datetime | None


class StoreExpectedBatch(StoreItemRef):
    """A Batch the count must include. Never carries a quantity (ADR 0009)."""

    batch_id: int
    expiry_date: date_t | None
    expiry_month_only: bool


# ── Disposals ────────────────────────────────────────────────────────────────


class StoreDisposalCreate(BaseModel):
    disposed_on: date_t
    item_id: int
    expiry: str | None = None
    quantity: int = Field(ge=1)
    reason: StoreDisposalReason
    note: str | None = None

    @field_validator("expiry")
    @classmethod
    def _valid_expiry(cls, value: str | None) -> str | None:
        parse_expiry(value)
        return value


class StoreDisposalRead(StoreItemRef):
    id: int
    batch_id: int
    expiry_date: date_t | None
    expiry_month_only: bool
    disposed_on: date_t
    quantity: int
    reason: StoreDisposalReason
    note: str | None
    created_by_user_id: int | None
    created_at: datetime


# ── Handovers ────────────────────────────────────────────────────────────────


class StoreHandoverLineInput(BaseModel):
    item_id: int
    quantity: int = Field(ge=1)


class StoreHandoverCreate(BaseModel):
    handed_on: date_t = Field(default_factory=organization_today)
    taken_by: str = Field(min_length=1, max_length=128)
    note: str | None = None
    lines: list[StoreHandoverLineInput] = Field(min_length=1)


class StoreHandoverRead(BaseModel):
    id: int
    handed_on: date_t
    taken_by: str
    note: str | None
    lines: list[StoreLineRead]
    created_by_user_id: int | None
    created_at: datetime
    recorded_by_name: str | None
    recorded_by_name_ar: str | None


# ── In & out ─────────────────────────────────────────────────────────────────


class StoreMovementRead(BaseModel):
    kind: StoreMovementKind
    id: int
    on: date_t
    created_at: datetime
    recorded_by_name: str | None
    recorded_by_name_ar: str | None
    taken_by: str | None = None
    note: str | None = None
    reason: StoreDisposalReason | None = None
    note_file: StoreDeliveryNoteFile | None = None
    lines: list[StoreLineRead]


# ── Dashboard ────────────────────────────────────────────────────────────────


class StoreDashboardBatch(StoreItemRef):
    batch_id: int
    expiry_date: date_t | None
    expiry_month_only: bool
    on_hand: int
    days_left: int | None


class StoreDashboardLowStock(StoreItemRef):
    on_hand: int
    minimum_level: int


class StoreUsageRow(StoreItemRef):
    values: list[int | None]


class StoreUsage(BaseModel):
    months: list[str]
    rows: list[StoreUsageRow]


class StoreSuggestion(StoreItemRef):
    average_usage: float
    on_hand: int
    suggested: int
    suggested_units: int


class StoreDashboard(BaseModel):
    today: date_t
    expiring_soon_days: int
    expired: list[StoreDashboardBatch]
    expiring_soon: list[StoreDashboardBatch]
    low_stock: list[StoreDashboardLowStock]
    usage: StoreUsage
    suggestions: list[StoreSuggestion]
    last_count_on: date_t | None
    last_delivery_on: date_t | None
    counts_recorded: int
    usage_ready: bool
    suggestion_count: int
