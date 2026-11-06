"""Ledger Book API schemas (ADR 0007 Drafts + Save & Send, ADR 0008 Revisions)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas._base import ORMBase
from app.schemas.book import BookGrade, BookImportance


class LedgerAddresseeIn(BaseModel):
    """Exactly one id; service validation uses the ADDRESSEE_INVALID field error."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["to", "cc"]
    user_id: int | None = None
    contact_id: int | None = None


class LedgerAddresseeRead(ORMBase):
    role: Literal["to", "cc"]
    user_id: int | None
    contact_id: int | None
    name: str
    name_ar: str | None
    email: str | None
    g_number: str | None


class LedgerSignerRead(ORMBase):
    manager_id: int
    user_id: int
    name: str
    name_ar: str | None
    title: str | None


class LedgerReturnIn(BaseModel):
    note: str = Field(min_length=1, max_length=4000)


class LedgerSignerIn(BaseModel):
    manager_id: int


class LedgerOutlookDraftRead(BaseModel):
    id: int


class LedgerDraftCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tab: int | None = Field(default=None, ge=1, le=15)
    grade: BookGrade = "unclassified"
    importance: BookImportance | None = None
    subjects: list[str] = Field(default_factory=list, max_length=20)
    body_html: str = Field(default="", max_length=2_000_000)
    external: bool = False
    signer_manager_id: int | None = None
    addressees: list[LedgerAddresseeIn] = Field(default_factory=list, max_length=50)


class LedgerDraftUpdate(BaseModel):
    """Partial update: only the fields sent change."""

    model_config = ConfigDict(extra="forbid")

    tab: int | None = Field(default=None, ge=1, le=15)
    grade: BookGrade | None = None
    # Sent as null: clears the importance.
    importance: BookImportance | None = None
    subjects: list[str] | None = Field(default=None, max_length=20)
    body_html: str | None = Field(default=None, max_length=2_000_000)
    external: bool | None = None
    signer_manager_id: int | None = None
    addressees: list[LedgerAddresseeIn] | None = Field(default=None, max_length=50)


class LedgerDraftRead(ORMBase):
    id: int
    # Zero-padded internal number; the UI adds the DRAFT / مسودة prefix.
    draft_number: str
    tab: int | None
    grade: BookGrade
    importance: BookImportance | None
    subjects: list[str]
    body_html: str
    external: bool
    signer_manager_id: int | None
    addressees: list[LedgerAddresseeIn]
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
    importance: BookImportance | None
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
    external: bool
    addressees: list[LedgerAddresseeRead]
    signer: LedgerSignerRead | None
    can_sign: bool
    can_return: bool
    can_change_signer: bool
    can_resubmit: bool
    can_create_outlook_draft: bool
    return_note: str | None


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
