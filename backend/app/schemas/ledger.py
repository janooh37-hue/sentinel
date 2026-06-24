"""Pydantic schemas for LedgerEntry — Phase 07."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase


class LedgerAddress(BaseModel):
    name: str = ""
    address: str

# ---------------------------------------------------------------------------
# Enum literals
# ---------------------------------------------------------------------------

LedgerDirection = Literal["incoming", "outgoing", "internal"]
LedgerChannel = Literal["email", "phone", "in_person", "fax", "letter", "other"]


# ---------------------------------------------------------------------------
# Write schemas
# ---------------------------------------------------------------------------


class LedgerEntryCreate(BaseModel):
    """Fields accepted when creating a new ledger entry."""

    entry_date: date
    direction: LedgerDirection
    channel: LedgerChannel
    counterparty: str = Field(min_length=1, max_length=255)
    subject: str = Field(min_length=1, max_length=255)
    notes_html: str | None = None
    tags: list[str] = Field(default_factory=list)
    related_book_id: int | None = None
    related_employee_id: str | None = None
    created_by: str | None = None


class LedgerEntryUpdate(BaseModel):
    """All fields optional — partial update (PATCH semantics)."""

    entry_date: date | None = None
    direction: LedgerDirection | None = None
    channel: LedgerChannel | None = None
    counterparty: str | None = Field(default=None, max_length=255)
    subject: str | None = Field(default=None, max_length=255)
    notes_html: str | None = None
    tags: list[str] | None = None
    related_book_id: int | None = None
    related_employee_id: str | None = None


# ---------------------------------------------------------------------------
# Read schemas
# ---------------------------------------------------------------------------


class LedgerAttachmentMeta(BaseModel):
    """Per-attachment metadata for the detail view.

    Populated by ``GET /{id}`` from disk; the other endpoints that return
    ``LedgerEntryRead`` leave it empty (the drawer only reads the full entry).
    ``index`` is the position in ``attachment_paths`` (stable; used to address
    the file by ``/attachments/by-index/{index}`` so Arabic/spaced filenames
    never go in the URL path). ``size`` is the on-disk byte count, or 0 when the
    file is missing.
    """

    index: int
    name: str
    size: int


class LedgerEntryRead(ORMBase):
    """Full row — returned by GET /{id}, POST, and PATCH."""

    id: int
    entry_date: date
    direction: str
    channel: str
    counterparty: str
    subject: str
    notes_html: str | None
    attachment_paths: list[str]
    attachments: list[LedgerAttachmentMeta] = Field(default_factory=list)
    tags: list[str]
    inline_images: dict[str, str] = Field(default_factory=dict)
    draft_meta: dict[str, str | bool | list[str] | None] | None = None
    related_book_id: int | None
    related_employee_id: str | None
    created_at: datetime
    updated_at: datetime | None
    created_by: str | None
    created_by_name_en: str | None = None
    created_by_name_ar: str | None = None
    deleted_at: datetime | None
    read_at: datetime | None = None
    to_recipients: list[LedgerAddress] = Field(default_factory=list)
    cc_recipients: list[LedgerAddress] = Field(default_factory=list)
    bcc_recipients: list[LedgerAddress] = Field(default_factory=list)
    message_id: str | None = None
    in_reply_to: str | None = None
    email_references: str | None = None


class LedgerListItem(ORMBase):
    """Slim projection for list / timeline views.

    Omits ``notes_html`` (can be large). ``attachment_count`` is exposed
    instead of ``attachment_paths`` so the timeline can show a paperclip
    glyph without paying the full-paths-of-every-row cost.
    """

    id: int
    entry_date: date
    direction: str
    channel: str
    counterparty: str
    subject: str
    tags: list[str]
    attachment_count: int = 0
    related_book_id: int | None
    related_employee_id: str | None
    created_at: datetime
    updated_at: datetime | None
    deleted_at: datetime | None
    read_at: datetime | None = None
    snippet: str = ""


class LedgerListResponse(BaseModel):
    items: list[LedgerListItem]
    total: int
    limit: int
    offset: int


class DraftWrite(BaseModel):
    """Payload for creating or updating an email draft.

    Drafts borrow the LedgerEntry shape (channel='email', direction='outgoing',
    tag='draft'). ``to``/``cc``/``in_reply_to``/``references`` aren't first-
    class on LedgerEntry, so they're persisted as ``draft_meta`` JSON.
    ``subject`` and ``html`` map to ``subject`` and ``notes_html``.
    ``use_signature`` is persisted in draft_meta and forwarded to
    ``email_service.send_email`` when the draft is promoted to sent.
    """

    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    subject: str = ""
    html: str = ""
    in_reply_to: str | None = None
    references: str | None = None
    use_signature: bool = True


__all__ = [
    "DraftWrite",
    "LedgerAddress",
    "LedgerAttachmentMeta",
    "LedgerChannel",
    "LedgerDirection",
    "LedgerEntryCreate",
    "LedgerEntryRead",
    "LedgerEntryUpdate",
    "LedgerListItem",
    "LedgerListResponse",
]
