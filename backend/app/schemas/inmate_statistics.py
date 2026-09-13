"""Monthly inmate violation register — request/response contract.

One month endpoint serves both states: live entries while ``closed_at`` is NULL,
frozen entries once it is set. Two endpoints would guarantee drift between the
open and the sealed month across three export channels.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.inmate_wings import CanonicalWing, normalize_wing
from app.schemas._base import ORMBase


class NationalityOut(BaseModel):
    """One entry of the closed inmate nationality list."""

    code: str
    label_ar: str
    label_en: str
    #: ``غير محدد`` is reachable only through the history bridge, never picked.
    selectable: bool


class NationalityListOut(BaseModel):
    items: list[NationalityOut]
    #: Normalized label (and historical spelling) → code, so the entry form
    #: resolves a filed value to its canonical label exactly as the register
    #: does. Filed payloads are never rewritten; resolution is a read.
    aliases: dict[str, str]


class ManualProvenanceOut(ORMBase):
    """Why a hand-typed entry exists, and who typed it. Screen only."""

    row_id: int | None = None
    reason: str | None = None
    created_by: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None


class RegisterEntryOut(BaseModel):
    #: ``{book_id}:{version_no}:{row_index}`` or ``manual:{id}`` — identical
    #: whether the month is open or sealed. The display ordinal is ``row_no``.
    id: str
    origin: str
    row_no: int
    population: str
    name: str
    uid: str
    nationality_label: str
    nationality_code: str | None
    violation_date: date
    duty_unit: str
    details_text: str
    wing: str
    holding_no: str
    reporter_id: str | None
    reporter_name: str | None
    source_book_id: int | None
    source_version_no: int | None
    source_row_index: int | None
    source_ref_number: str | None
    #: Values permanently missing on this entry (forced close / bridge miss).
    incomplete_marks: list[str]
    #: Values still required before the month may close.
    missing: list[str]
    #: Handle of the derived entry this manual entry shadows, if any.
    duplicate_of: str | None
    #: The imported Record whose completion form fills this entry in.
    completion_book_id: int | None
    manual: ManualProvenanceOut | None


class UncountedRecordOut(BaseModel):
    """A filed Record that belongs to no Violation month."""

    book_id: int
    ref_number: str
    reason: str


class ArrivedAfterCloseOut(BaseModel):
    """An occurrence edited into this month after it was sealed."""

    id: str
    name: str
    violation_date: date
    ref_number: str | None
    source_book_id: int | None


class BlockingEntryOut(BaseModel):
    id: str
    name: str
    missing: list[str]


class MonthCountsOut(BaseModel):
    citizens: int
    expats: int
    pending: int
    total: int


class WingCountOut(BaseModel):
    wing: CanonicalWing
    violations: int


class WingSummaryOut(BaseModel):
    counts: list[WingCountOut]
    most: list[CanonicalWing]
    most_count: int
    least: list[CanonicalWing]
    least_count: int
    zero: list[CanonicalWing]
    unassigned_count: int


class WorkflowActorOut(ORMBase):
    user_id: int
    name_ar: str
    employee_id: str
    acted_at: datetime


class WorkflowCandidateOut(BaseModel):
    user_id: int
    name_ar: str
    employee_id: str


class WorkflowAssignmentOut(BaseModel):
    user_id: int | None
    name_ar: str | None
    employee_id: str | None
    eligible: bool


class WorkflowBlockerOut(BaseModel):
    code: str
    details: dict[str, Any] = Field(default_factory=dict)


class WorkflowEventOut(ORMBase):
    """The last return or reopen, kept until the next preparation replaces it."""

    action: Literal["returned", "reopened"]
    user_id: int | None
    name_ar: str | None
    employee_id: str | None
    acted_at: datetime
    reason: str | None


class WorkflowOut(BaseModel):
    version: int
    state: Literal["draft", "awaiting_review", "awaiting_manager", "closed"]
    reviewer: WorkflowAssignmentOut | None
    manager: WorkflowAssignmentOut | None
    prepared: WorkflowActorOut | None
    reviewed: WorkflowActorOut | None
    approved: WorkflowActorOut | None
    last_event: WorkflowEventOut | None
    needs_review: bool
    blockers: list[WorkflowBlockerOut]
    allowed_actions: list[Literal["prepare", "review", "return", "approve", "reopen"]]


class MonthOut(ORMBase):
    year: int
    month: int
    closed: bool
    closed_at: datetime | None
    closed_by: int | None
    closed_by_name: str | None
    reopened_at: datetime | None
    reopened_by: int | None
    reopened_by_name: str | None
    #: Read-only history of a month forced closed before the approval workflow.
    force_reason: str | None
    force_closed: bool
    projection_fingerprint: str
    wing_summary: WingSummaryOut
    workflow: WorkflowOut
    first_closable_date: date
    #: A workbook copy was written at close and is available to download.
    export_ready: bool
    counts: MonthCountsOut
    entries: list[RegisterEntryOut]
    uncounted: list[UncountedRecordOut]
    arrived_after_close: list[ArrivedAfterCloseOut]
    blocking: list[BlockingEntryOut]


class AwaitingMonthOut(BaseModel):
    year: int
    month: int
    row_count: int
    pending_count: int
    closable: bool
    #: The stage this month waits on, and whether the caller is its actor.
    stage: Literal["prepare", "review", "approve"]
    assigned: bool


class AwaitingCloseOut(BaseModel):
    """Unsealed months the caller can move. A standing state, not an event."""

    months: list[AwaitingMonthOut]
    count: int


class WingInput(BaseModel):
    @field_validator("wing", check_fields=False)
    @classmethod
    def canonical_wing(cls, value: str | None) -> str | None:
        return normalize_wing(value)


class ManualRowIn(WingInput):
    name: str = Field(min_length=1, max_length=160)
    violation_date: date
    reason: str = Field(min_length=1)
    uid: str | None = Field(default=None, max_length=64)
    nationality_label: str | None = Field(default=None, max_length=64)
    wing: str | None = Field(default=None, max_length=8)
    holding_no: str | None = Field(default=None, max_length=32)
    reporter_id: str | None = Field(default=None, max_length=16)
    details_text: str | None = None


class ManualRowPatch(WingInput):
    """Only the supplied cells change; the rest keep their stored values."""

    name: str | None = Field(default=None, min_length=1, max_length=160)
    violation_date: date | None = None
    reason: str | None = Field(default=None, min_length=1)
    uid: str | None = Field(default=None, max_length=64)
    nationality_label: str | None = Field(default=None, max_length=64)
    wing: str | None = Field(default=None, max_length=8)
    holding_no: str | None = Field(default=None, max_length=32)
    reporter_id: str | None = Field(default=None, max_length=16)
    details_text: str | None = None


class CompletionInmateIn(WingInput):
    name: str = Field(min_length=1, max_length=160)
    uid: str | None = Field(default=None, max_length=64)
    nationality: str | None = Field(default=None, max_length=64)
    wing: str | None = Field(default=None, max_length=8)
    holding_no: str | None = Field(default=None, max_length=32)


class CompletionIn(BaseModel):
    """``report_time``, ``reporter_id`` and the narrative are the save gate."""

    report_time: str = Field(min_length=1, max_length=5)
    reporter_id: str = Field(min_length=1, max_length=16)
    violation_details: str = Field(min_length=1)
    inmates: list[CompletionInmateIn] = Field(min_length=1)


class WorkflowVersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=0)


class PrepareIn(WorkflowVersionIn):
    """The fingerprint is the report the preparer actually previewed."""

    expected_projection_fingerprint: str = Field(pattern="^[a-f0-9]{64}$")
    reviewer_user_id: int = Field(gt=0)


class ReviewIn(WorkflowVersionIn):
    manager_user_id: int = Field(gt=0)


class ReturnIn(WorkflowVersionIn):
    reason: str = Field(min_length=1)


class ApproveIn(WorkflowVersionIn):
    pass


class ReopenIn(WorkflowVersionIn):
    reason: str = Field(min_length=1)
