"""Uniform request and response contracts."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.uniform_limits import MAX_QUANTITY
from app.schemas._base import ORMBase

Group = Literal["formal", "guard", "winter"]
Drawing = Literal[
    "suit",
    "boots",
    "polo",
    "cargo",
    "belt",
    "cap",
    "socks",
    "jacket",
    "vest",
    "parka",
    "dressshirt",
    "longsleeve",
]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, from_attributes=True)


class UniformItemCreate(Input):
    name_en: str = Field(min_length=1, max_length=120)
    name_ar: str = Field(min_length=1, max_length=120)
    description_en: str | None = Field(default=None, max_length=500)
    description_ar: str | None = Field(default=None, max_length=500)
    group_key: Group
    drawing: Drawing
    default_qty: int = Field(default=1, ge=1, le=MAX_QUANTITY, strict=True)
    sizes: list[str] = Field(min_length=1)


class UniformItemUpdate(Input):
    name_en: str | None = Field(default=None, min_length=1, max_length=120)
    name_ar: str | None = Field(default=None, min_length=1, max_length=120)
    description_en: str | None = Field(default=None, max_length=500)
    description_ar: str | None = Field(default=None, max_length=500)
    group_key: Group | None = None
    drawing: Drawing | None = None
    default_qty: int | None = Field(default=None, ge=1, le=MAX_QUANTITY, strict=True)
    sort_order: int | None = Field(default=None, strict=True)


class UniformSizeCreate(Input):
    label: str = Field(min_length=1, max_length=16)
    min_qty: int | None = Field(default=None, ge=0, le=MAX_QUANTITY, strict=True)


class UniformSizeUpdate(Input):
    label: str | None = Field(default=None, min_length=1, max_length=16)
    sort_order: int | None = Field(default=None, strict=True)
    min_qty: int | None = Field(default=None, ge=0, le=MAX_QUANTITY, strict=True)


class UniformSizeRead(ORMBase):
    id: int
    item_id: int
    label: str
    sort_order: int
    on_hand: int
    min_qty: int | None
    archived_at: datetime | None
    held_qty: int = 0
    is_low: bool = False


class UniformHolder(ORMBase):
    employee_id: str
    name_en: str
    name_ar: str | None
    qty: int


class UniformItemRead(ORMBase):
    id: int
    name_en: str
    name_ar: str
    description_en: str | None
    description_ar: str | None
    group_key: Group
    drawing: Drawing
    tracking: Literal["shelf", "holder"]
    default_qty: int
    sort_order: int
    archived_at: datetime | None
    version: str
    sizes: list[UniformSizeRead]
    holders: list[UniformHolder]


class UniformReceiptLine(Input):
    size_id: int
    qty: int = Field(ge=1, le=MAX_QUANTITY, strict=True)


class UniformIssueLine(Input):
    item_id: int
    size_id: int | None = None
    qty: int = Field(ge=1, le=MAX_QUANTITY, strict=True)


class UniformReturnLine(UniformIssueLine):
    condition: Literal["reusable", "damaged"]


class UniformAdjustmentLine(Input):
    size_id: int
    delta: int = Field(ge=-MAX_QUANTITY, le=MAX_QUANTITY, strict=True)
    expected_on_hand: int = Field(ge=0, le=MAX_QUANTITY, strict=True)


class UniformReceiptCreate(Input):
    received_on: date
    reference: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    lines: list[UniformReceiptLine] = Field(min_length=1)


class UniformIssueCreate(Input):
    employee_id: str
    issued_on: date | None = None
    note: str | None = Field(default=None, max_length=500)
    lines: list[UniformIssueLine] = Field(min_length=1)


class UniformReturnCreate(Input):
    employee_id: str
    returned_on: date | None = None
    note: str | None = Field(default=None, max_length=500)
    lines: list[UniformReturnLine] = Field(min_length=1)


class UniformAdjustmentCreate(Input):
    lines: list[UniformAdjustmentLine] = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=500)
    adjusted_on: date | None = None


class UniformVoid(Input):
    reason: str = Field(min_length=1, max_length=500)


class UniformPostingRead(ORMBase):
    id: int
    created_at: datetime
    created_by_id: int | None
    voided_at: datetime | None
    voided_by_id: int | None
    void_reason: str | None


class UniformReceiptRead(UniformPostingRead):
    received_on: date
    reference: str | None
    note: str | None
    lines: list[UniformReceiptLine]


class UniformIssueRead(UniformPostingRead):
    employee_id: str
    given_by_name_en: str | None = None
    given_by_name_ar: str | None = None
    issued_on: date
    note: str | None
    lines: list[UniformIssueLine]


class UniformReturnRead(UniformPostingRead):
    employee_id: str
    received_by_name_en: str | None = None
    received_by_name_ar: str | None = None
    returned_on: date
    note: str | None
    lines: list[UniformReturnLine]


class UniformAdjustmentRead(UniformPostingRead):
    size_id: int
    delta: int
    reason: str
    adjusted_on: date


class UniformHolding(ORMBase):
    employee_id: str
    item_id: int
    size_id: int | None
    qty: int


class UniformEmployeeRead(ORMBase):
    holdings: list[UniformHolding]
    issues: list[UniformIssueRead]
    returns: list[UniformReturnRead]


class UniformRecipient(ORMBase):
    employee_id: str
    name_en: str
    name_ar: str | None
    held_total: int
    issued_total: int
    last_issued_on: date


class UniformSummary(ORMBase):
    shelf_total: int
    holder_count: int
    suits_issued: int
    out_of_stock: int
    low_sizes: int
