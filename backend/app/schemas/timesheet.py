"""Time-sheet schemas — the grid response and the four write payloads.

The read models mirror ``services.timesheet_service``'s dataclasses field for
field. Nothing is dropped: the page reads ``removed`` and ``closed_by`` off the
grid and ``stat_filler``, ``joined_day``, ``left_day``, ``start_confirmed`` and
``notes`` off every row, so a model that silently omits one disables a feature.

``TimesheetRow.notes`` is ``dict[int, str]`` because the service keys it by day
number; JSON has no integer keys, so it serialises as ``{"9": "no show"}`` and
the page indexes it with ``row.notes[String(day)]``.

Day codes are **not** a ``Literal`` here. ``timesheet_service.CELL_CODES`` is the
one source of truth and it is a runtime set, so the service validates the code
and answers ``TIMESHEET_BAD_CODE`` — a duplicated literal list would drift, and
would replace that message with a generic envelope.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase

#: The two workbooks and the two deliverables, as static types: a mistyped value
#: is refused at the door rather than yielding an empty roster. Neither
#: ``timesheet_service.SHEETS`` nor ``timesheet_xlsx.VARIANTS`` can be spelled as
#: a ``Literal``, so ``test_timesheet_api`` pins these against them.
Sheet = Literal["main", "drivers"]
Variant = Literal["attendance", "statistics"]


class TimesheetIssue(ORMBase):
    """One preflight finding. Blocking stops a download; a warning never does.

    Reported per employee, never nested inside a row: ``warnings`` is recomputed
    live even on a closed month, so an ``employee_id`` here may name someone with
    no row in the same response (a departure, or someone hired after the seal).
    """

    employee_id: str
    kind: str
    detail: str


class TimesheetRemoved(ORMBase):
    """Someone who finished last month and is therefore off this roster."""

    employee_id: str
    name_en: str
    end_date: date
    last_day: int
    month: int
    year: int


class TimesheetRow(ORMBase):
    """One printed row: the identity block, 31 cells, and both statistics."""

    employee_id: str
    row_no: int
    name_en: str
    nationality_en: str | None
    designation_en: str | None
    designation_ar: str | None
    rank_order: int | None
    codes: list[str | None]
    stat_codes: list[str | None]
    stat_block: int
    stat_filler: str | None
    joined_day: int | None
    left_day: int | None
    start_confirmed: bool
    notes: dict[int, str]


class TimesheetGridResponse(ORMBase):
    """One month of one workbook, live or sealed."""

    year: int
    month: int
    days_in_month: int
    sheet: str
    post_count: int
    rows: list[TimesheetRow]
    blocking: list[TimesheetIssue]
    warnings: list[TimesheetIssue]
    removed: list[TimesheetRemoved]
    closed_at: datetime | None
    closed_by: str | None


class TimesheetDesignationRead(ORMBase):
    """One printable designation from the catalog."""

    id: int
    name_en: str
    name_ar: str
    rank_order: int
    sheet: str
    active: bool


class TimesheetDesignationOrder(BaseModel):
    """The full designation catalog in its new order — every id, exactly once."""

    ids: list[int]


class TimesheetCellUpdate(BaseModel):
    """Force one cell. ``code: null`` clears it back to the derived value."""

    employee_id: str
    day: int = Field(ge=1, le=31)
    code: str | None = None
    note: str | None = None


class TimesheetFillerUpdate(BaseModel):
    """The code statistics block 2 prints for one employee."""

    employee_id: str
    code: str


class TimesheetPeriodPatch(BaseModel):
    """The month's contracted post count and any block-2 filler choices."""

    post_count: int | None = Field(default=None, ge=0)
    fillers: list[TimesheetFillerUpdate] = Field(default_factory=list)


class TimesheetStartAckRequest(BaseModel):
    """Accept a mid-month joiner's starting point. Changes no cell."""

    employee_id: str


__all__ = [
    "Sheet",
    "TimesheetCellUpdate",
    "TimesheetDesignationOrder",
    "TimesheetDesignationRead",
    "TimesheetFillerUpdate",
    "TimesheetGridResponse",
    "TimesheetIssue",
    "TimesheetPeriodPatch",
    "TimesheetRemoved",
    "TimesheetRow",
    "TimesheetStartAckRequest",
    "Variant",
]
