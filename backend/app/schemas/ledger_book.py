"""Ledger Book API schemas (ADR 0007 Drafts + Save & Send, ADR 0008 Revisions)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas._base import ORMBase
from app.schemas.book import BookGrade, BookUrgency


class LedgerDraftCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tab: int | None = Field(default=None, ge=1, le=15)
    grade: BookGrade = "unclassified"
    urgency: BookUrgency = "Normal"
    subjects: list[str] = Field(default_factory=list, max_length=20)
    body_html: str = Field(default="", max_length=2_000_000)


class LedgerDraftUpdate(BaseModel):
    """Partial update: only the fields sent change."""

    model_config = ConfigDict(extra="forbid")

    tab: int | None = Field(default=None, ge=1, le=15)
    grade: BookGrade | None = None
    urgency: BookUrgency | None = None
    subjects: list[str] | None = Field(default=None, max_length=20)
    body_html: str | None = Field(default=None, max_length=2_000_000)


class LedgerDraftRead(ORMBase):
    id: int
    # Zero-padded internal number; the UI adds the DRAFT / مسودة prefix.
    draft_number: str
    tab: int | None
    grade: BookGrade
    urgency: BookUrgency
    subjects: list[str]
    body_html: str
    created_at: datetime
    updated_at: datetime


class LedgerDraftImageRead(ORMBase):
    name: str
    src: str


class LedgerRevisionRead(ORMBase):
    version_id: int
    version_no: int
    trigger: str
    created_at: datetime
    signed_at: datetime | None
    # A later Revision exists.
    superseded: bool
    # Signed: no change except through a correction Revision.
    locked: bool


class LedgerBookRead(ORMBase):
    id: int
    ref_number: str
    grade: BookGrade
    urgency: BookUrgency
    tab: int | None
    classification_code: str | None
    # dd-mm-YYYY, as printed and as scan-back reads it.
    paper_date: str | None
    approval_state: str
    created_by_user_id: int | None
    voided: bool
    revisions: list[LedgerRevisionRead]
    selected_version_id: int
    subjects: list[str]
    body_html: str
    content_sha256: str


class LedgerContentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subjects: list[str] = Field(max_length=20)
    body_html: str = Field(max_length=2_000_000)


class LedgerSaveRead(ORMBase):
    id: int
    saved_by_user_id: int
    saved_by_name: str | None
    saved_at: datetime
    content_sha256: str
