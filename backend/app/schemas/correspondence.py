"""Pydantic schemas for the Correspondence Log — Ledger→Outlook Phase 3."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase

_TRIGGERS = ("document_generated", "book_signed", "intake_classified", "email_sent")


class CorrespondenceCategoryCreate(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    name_en: str = Field(default="", max_length=128)
    name_ar: str = Field(default="", max_length=128)
    sort: int = 0


class CorrespondenceCategoryUpdate(BaseModel):
    name_en: str | None = Field(default=None, max_length=128)
    name_ar: str | None = Field(default=None, max_length=128)
    sort: int | None = None


class CorrespondenceCategoryRead(ORMBase):
    id: int
    key: str
    name_en: str
    name_ar: str
    sort: int
    system: bool
    created_at: datetime


class CorrespondenceRuleCreate(BaseModel):
    trigger: str = Field(pattern="^(document_generated|book_signed|intake_classified|email_sent)$")
    condition_json: dict[str, str] = Field(default_factory=dict)
    category_id: int
    enabled: bool = True
    sort: int = 0


class CorrespondenceRuleUpdate(BaseModel):
    condition_json: dict[str, str] | None = None
    category_id: int | None = None
    enabled: bool | None = None
    sort: int | None = None


class CorrespondenceRuleRead(ORMBase):
    id: int
    trigger: str
    condition_json: dict[str, str]
    category_id: int
    enabled: bool
    sort: int
    created_at: datetime


class CorrespondenceLogItem(ORMBase):
    """A row in the shared log list — projection of a LedgerEntry."""

    id: int
    entry_date: date
    direction: str
    subject: str
    counterparty: str
    source_kind: str | None
    category_id: int | None
    related_book_id: int | None
    related_employee_id: str | None
    created_by: str | None
    read_at: datetime | None = None


class CorrespondenceLogRecord(CorrespondenceLogItem):
    """The record view — adds the resolved category + the linked Book's status."""

    category_key: str | None = None
    category_name_en: str | None = None
    category_name_ar: str | None = None
    book_ref_number: str | None = None
    book_approval_state: str | None = None


__all__ = [
    "CorrespondenceCategoryCreate",
    "CorrespondenceCategoryRead",
    "CorrespondenceCategoryUpdate",
    "CorrespondenceLogItem",
    "CorrespondenceLogRecord",
    "CorrespondenceRuleCreate",
    "CorrespondenceRuleRead",
    "CorrespondenceRuleUpdate",
]
