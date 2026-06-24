"""Book and BookCategory schemas — Phase 05."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase

# Direction must be one of these two values.
BookDirection = Literal["incoming", "outgoing"]

# Stamp style literals — kept in sync with app.core.constants.STAMP_STYLES.
BookStampStyle = Literal[
    "Header Text (Ref: XX-0000)",
    "Bold Top-Right Corner",
    "Watermark Style",
]


# ---------------------------------------------------------------------------
# Category schemas
# ---------------------------------------------------------------------------


class BookCategoryRead(ORMBase):
    id: str
    name_en: str | None
    name_ar: str | None
    prefix: str
    requires_approval: bool


# ---------------------------------------------------------------------------
# Book schemas
# ---------------------------------------------------------------------------


class BookCreate(BaseModel):
    """Caller-supplied fields for a new book entry.

    ``ref_number`` is NOT accepted — it is allocated atomically by the service.
    """

    category_id: str = Field(min_length=1, max_length=16)
    subject: str | None = Field(default=None, max_length=512)
    direction: BookDirection = "incoming"
    stamp_style: BookStampStyle = "Header Text (Ref: XX-0000)"
    doc_id: int | None = None  # optional link to a Document row


class BookUpdate(BaseModel):
    """Mutable fields.  ``category_id`` and ``ref_number`` are immutable."""

    subject: str | None = Field(default=None, max_length=512)
    direction: BookDirection | None = None
    stamp_style: BookStampStyle | None = None


class BookSubmitRequest(BaseModel):
    priority: Literal["Normal", "High"] = "Normal"
    # When None, the server routes to the doc's linked manager
    # (Book.doc_manager_id → Manager.user_id). An explicit id wins.
    approver_user_id: int | None = None
    reviewer_user_ids: list[int] = Field(default_factory=list)


class ReviewRequest(BaseModel):
    # Advisory reviewer verdict — never changes approval_state.
    decision: Literal["reviewed", "changes_requested"]
    note: str | None = Field(default=None, max_length=2000)


class ReviewersAddRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1)


class BookDecisionRequest(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class BookApprovalStepRead(ORMBase):
    id: int
    step_order: int
    stage_label: str
    assignee_user_id: int
    state: str
    note: str | None
    decided_at: datetime | None
    kind: str = "approver"
    seen_at: datetime | None = None
    assignee_name: str | None = None


class BookVersionRead(ORMBase):
    """One version of a book — for the detail drawer's version history."""

    id: int
    version_no: int
    trigger: str
    status: str
    template_id: str | None = None
    document_id: int | None = None
    has_fields: bool = False
    created_at: datetime
    created_by_name: str | None = None
    docx_url: str | None = None
    pdf_url: str | None = None
    manager_sig_embedded: bool = False
    signed_pdf_url: str | None = None
    # How this version got signed (derived, not stored): "scan" when
    # signed_pdf_path lives under book_attachments/ (a filed scan-back copy),
    # "in_app" for sign_book-rendered artifacts, None while unsigned.
    signed_source: Literal["in_app", "scan"] | None = None
    approval_steps: list[BookApprovalStepRead] = Field(default_factory=list)


class BookAnnotationCreate(BaseModel):
    """A markup the signing manager places during review."""

    page: int = Field(ge=1)
    kind: Literal["pin", "highlight"]
    geometry: dict[str, float]
    comment: str | None = Field(default=None, max_length=2000)


class BookAnnotationRead(ORMBase):
    id: int
    version_id: int
    page: int
    kind: str
    geometry: dict[str, float]
    comment: str | None
    author_user_id: int | None = None
    author_name: str | None = None
    created_at: datetime


class BookRead(ORMBase):
    id: int
    ref_number: str
    category_id: str
    # May be None when the FK target row is missing (legacy/alpha category ids).
    category: BookCategoryRead | None = None
    # Subject employee link (G-number) + name snapshot, straight off the Book row.
    # Lets clients resolve the employee record (designation / Arabic name / id)
    # without re-parsing the subject. None for admin-category books with no employee.
    employee_id: str | None = None
    employee_name_snapshot: str | None = None
    subject: str | None
    direction: str | None
    stamp_style: str | None
    doc_id: int | None = None  # mapped from doc_path placeholder; always None for now
    created_at: datetime
    deleted_at: datetime | None
    priority: str
    approval_state: str
    # Per-form signing path (core.form_policy) — derived from the current
    # version's template_id where versions are enriched; None for legacy
    # books / unknown templates.
    signing_path: str | None = None
    submitted_by_user_id: int | None = None
    submitted_by_name: str | None = None
    submitted_by_g: str | None = None
    # The doc's named manager resolved to a login account (auto-route target).
    doc_manager_user_id: int | None = None
    doc_manager_name: str | None = None
    # Whether that linked account has a signature on file — drives the submit
    # dialog's "manager has no signature, add one" warning (lenient submit).
    doc_manager_has_signature: bool = False
    # On the /books/awaiting payload only: "approver" | "reviewer" — the caller's
    # role on this pending record (label "To approve" vs "To review").
    your_step_kind: str | None = None
    approval_steps: list[BookApprovalStepRead] = Field(default_factory=list)
    attachment_paths: list[str] = Field(default_factory=list)
    versions: list[BookVersionRead] = Field(default_factory=list)


class BookListResponse(BaseModel):
    items: list[BookRead]
    total: int
    limit: int
    offset: int


class ApproverOptionRead(BaseModel):
    """Minimal user info for the submit-for-approval approver picker."""

    id: int
    name: str
    # True for the admin-set default manager — the picker preselects them.
    is_default: bool = False
