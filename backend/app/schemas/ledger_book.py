"""Ledger Book API schemas (ADR 0007 Drafts + Save & Send, ADR 0008 Revisions)."""

from __future__ import annotations

from datetime import date as date_type
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


LedgerPaperPreset = Literal["normal", "report"]
MAX_REFERENCES = 20
MAX_FOLDERS = 10


class LedgerReferenceRead(BaseModel):
    """A «إشارة إلى:» entry; ``can_open`` false prints the ref without a link."""

    book_id: int
    ref: str
    date: date_type
    can_open: bool


class LedgerFolderRead(BaseModel):
    id: int
    name: str


class LedgerDraftCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tab: int | None = Field(default=None, ge=1, le=15)
    grade: BookGrade = "unclassified"
    importance: BookImportance | None = None
    addressed_to: str = Field(default_factory=lambda: "", max_length=500)
    subjects: list[str] = Field(default_factory=list, max_length=20)
    body_html: str = Field(default="", max_length=2_000_000)
    external: bool = False
    signer_manager_id: int | None = None
    addressees: list[LedgerAddresseeIn] = Field(default_factory=list, max_length=50)
    # default_factory keeps it optional in the generated TS create type.
    paper_preset: LedgerPaperPreset = Field(default_factory=lambda: "normal")
    # Books the writer can read; folders in their outgoing box. Service-validated.
    reference_book_ids: list[int] = Field(default_factory=list, max_length=MAX_REFERENCES)
    folder_ids: list[int] = Field(default_factory=list, max_length=MAX_FOLDERS)


class LedgerDraftUpdate(BaseModel):
    """Partial update: only the fields sent change."""

    model_config = ConfigDict(extra="forbid")

    tab: int | None = Field(default=None, ge=1, le=15)
    grade: BookGrade | None = None
    # Sent as null: clears the importance.
    importance: BookImportance | None = None
    addressed_to: str | None = Field(default=None, max_length=500)
    subjects: list[str] | None = Field(default=None, max_length=20)
    body_html: str | None = Field(default=None, max_length=2_000_000)
    external: bool | None = None
    signer_manager_id: int | None = None
    addressees: list[LedgerAddresseeIn] | None = Field(default=None, max_length=50)
    paper_preset: LedgerPaperPreset | None = None
    reference_book_ids: list[int] | None = Field(default=None, max_length=MAX_REFERENCES)
    folder_ids: list[int] | None = Field(default=None, max_length=MAX_FOLDERS)


class LedgerDraftRead(ORMBase):
    id: int
    # Zero-padded internal number; the UI adds the DRAFT / مسودة prefix.
    draft_number: str
    tab: int | None
    grade: BookGrade
    importance: BookImportance | None
    addressed_to: str
    subjects: list[str]
    body_html: str
    external: bool
    signer_manager_id: int | None
    addressees: list[LedgerAddresseeIn]
    paper_preset: LedgerPaperPreset
    reference_book_ids: list[int]
    folder_ids: list[int]
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
    addressed_to: str | None
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
    paper_preset: LedgerPaperPreset
    references: list[LedgerReferenceRead]
    folders: list[LedgerFolderRead]


class LedgerSignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version_id: int = Field(gt=0)
    expected_content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class LedgerContentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version_id: int = Field(gt=0)
    expected_content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    addressed_to: str = Field(max_length=500)
    subjects: list[str] = Field(max_length=20)
    body_html: str = Field(max_length=2_000_000)


class LedgerSaveRead(ORMBase):
    id: int
    saved_by_user_id: int
    saved_by_name: str | None
    saved_at: datetime
    content_sha256: str
