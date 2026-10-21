"""Book and BookCategory schemas — Phase 05."""

from __future__ import annotations

from datetime import datetime
from typing import ClassVar, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.core.form_kind import resolve_service, word_draft_service
from app.schemas._base import ORMBase
from app.schemas.notify import NotifyMessageRead

# Direction must be one of these two values.
BookDirection = Literal["incoming", "outgoing"]

# Stamp style literals — kept in sync with app.core.constants.STAMP_STYLES.
BookStampStyle = Literal[
    "Header Text (Ref: XX-0000)",
    "Bold Top-Right Corner",
    "Watermark Style",
]

# Record level (Book.confidentiality) and direct-send purpose.
BookConfidentiality = Literal["general", "personal", "secret", "directed"]
SendPurpose = Literal["info", "action", "reply", "circulate"]


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
    confidentiality: BookConfidentiality = "general"


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
    version_id: int = Field(gt=0)
    decision: Literal["reviewed", "changes_requested"]
    note: str | None = Field(default=None, max_length=2000)


class ReviewersAddRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1)


class BookDecisionRequest(BaseModel):
    version_id: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=2000)


class BookSignRequest(BaseModel):
    version_id: int = Field(gt=0)


class BookStateOverrideRequest(BaseModel):
    """Admin state override (``books.override_state``). ``state`` spans the six
    approval states plus ``voided`` — the discarded-draft marker, which reads as
    a state on every records surface. ``reason`` is required for the negative
    verdicts, mirroring the normal return/reject contract."""

    state: Literal["none", "pending", "awaiting_scan", "approved", "returned", "rejected", "voided"]
    reason: str | None = Field(default=None, max_length=2000)


class ScanBackResult(BaseModel):
    book_id: int | None
    ref_number: str
    outcome: Literal["filed", "parked"]


class RevokeRevisionAccessRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    reason: str = Field(min_length=1, max_length=2000)


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
    assignee_name_ar: str | None = None


class RetainedDecisionRead(ORMBase):
    kind: str
    state: str
    note: str | None
    decided_at: datetime
    assignee_user_id: int
    assignee_name: str | None = None
    assignee_name_ar: str | None = None


class BookRevisionAccessRead(ORMBase):
    id: int
    version_id: int
    version_no: int
    user_id: int
    user_name: str | None = None
    user_name_ar: str | None = None
    kind: str
    state: str
    note: str | None
    assigned_at: datetime | None
    decided_at: datetime
    revoked_at: datetime | None
    revoked_by_user_id: int | None
    revocation_reason: str | None


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
    # Real assignment submission time; never inferred from revision creation.
    submitted_at: datetime | None = None
    created_by_name: str | None = None
    created_by_name_ar: str | None = None
    docx_url: str | None = None
    pdf_url: str | None = None
    manager_sig_embedded: bool = False
    signed_pdf_url: str | None = None
    # How this version got signed (derived, not stored): "scan" when
    # signed_pdf_path lives under book_attachments/ (a filed scan-back copy),
    # "in_app" for sign_book-rendered artifacts, None while unsigned.
    signed_source: Literal["in_app", "scan"] | None = None
    approval_steps: list[BookApprovalStepRead] = Field(default_factory=list)
    retained_decisions: list[RetainedDecisionRead] = Field(default_factory=list)

    # document_service stamps this with datetime.now() — local, not UTC.
    LOCAL_WALLCLOCK_FIELDS: ClassVar[frozenset[str]] = frozenset({"created_at"})


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
    author_name_ar: str | None = None
    created_at: datetime


class ImportedDocRead(BaseModel):
    """The local vault file backing a v3-imported record.

    Imported books store a stale absolute ``doc_path`` (the old pre-migration
    location) and have no generated Document/BookVersion, so the normal
    ``/documents/{id}/download`` route can't reach their file. The backend
    resolves ``doc_path`` to the copy already sitting in the employee's vault
    and exposes it here so the client can view / download it.
    """

    # Inline-viewable PDF URL — None when only a non-PDF (e.g. .docx) rendition
    # exists in the vault, in which case the client offers a download instead.
    pdf_url: str | None = None
    # Always present: downloads the best available file in its original format.
    download_url: str
    filename: str
    format: str  # lowercase extension without dot, e.g. "pdf" | "docx"


class BookEditSessionRead(ORMBase):
    """Active Word-editing session on a Book — only present when state='active'."""

    user_id: int
    user_name: str | None = None
    user_name_ar: str | None = None
    state: str
    last_put_at: datetime | None = None
    created_at: datetime


class WordSaveStatusRead(BaseModel):
    last_put_at: datetime | None


class ClassificationRead(BaseModel):
    code: str
    tab: int
    name_ar: str
    name_en: str
    unit_ar: str


class ClassificationListResponse(BaseModel):
    items: list[ClassificationRead]


class WordBookCreate(BaseModel):
    classification_code: str | None = None
    recipient_id: int | None = None
    subject: str
    cc: list[str] = Field(default_factory=list)
    manager_id: int | None = None
    template_name: str | None = None
    table_rows: list[dict[str, str]] | None = None
    confidentiality: BookConfidentiality = "general"
    # Report path only: present ⇒ create a Report (no classification/ref). `sign`
    # embeds the signer's signature at Finish; `date` is the report's document date.
    signer_employee_id: str | None = None
    sign: bool = True
    date: str | None = None


class WordSessionRead(BaseModel):
    book_id: int
    ref_number: str
    token: str
    filename: str
    word_url: str
    dav_url: str


class WordSessionDetailRead(WordSessionRead):
    created_at: datetime
    last_put_at: datetime | None
    template_name: str | None
    subject: str | None
    recipient_name: str | None
    cc: list[str]


class TemplateSessionRead(BaseModel):
    id: int
    name: str
    token: str
    filename: str
    word_url: str
    dav_url: str
    created_at: datetime
    last_put_at: datetime | None


class WordTemplateTableRead(BaseModel):
    has_table: bool
    columns: list[str]


class WordTemplateRead(ORMBase):
    name: str
    modified_at: datetime
    kind: Literal["base", "custom"] = "custom"


class SaveAsTemplateRequest(BaseModel):
    name: str


class RenameTemplateRequest(BaseModel):
    new_name: str


class IncludedPaperProposal(BaseModel):
    id: UUID
    staged_token: str | None = None
    original_name: str | None = None


class IncludedPapersRequest(BaseModel):
    revision: int = Field(ge=0)
    items: list[IncludedPaperProposal]


class IncludedPaperRead(ORMBase):
    id: UUID
    original_name: str
    slot_key: str | None = None
    media_type: str
    size: int
    page_count: int
    added_by_user_id: int | None = None
    added_at: datetime
    page_start: int | None = None
    page_end: int | None = None
    embedded_in_signed_base: bool = False


class IncludedPaperReplacementRead(BaseModel):
    from_name: str
    to_name: str


class IncludedPapersHistoryRead(ORMBase):
    actor_user_id: int | None = None
    actor_name: str
    actor_name_ar: str | None = None
    revision_before: int
    revision_after: int
    added: list[str] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)
    replaced: list[IncludedPaperReplacementRead] = Field(default_factory=list)
    reordered: list[str] = Field(default_factory=list)
    created_at: datetime


class IncludedPapersPreviewRead(BaseModel):
    revision: int
    fixed_page_count: int
    total_page_count: int
    papers: list[IncludedPaperRead]
    pdf_base64: str


class BookInboxRead(ORMBase):
    """The caller's own received send of a record (BookRead.my_inbox)."""

    id: int
    purpose: SendPurpose
    note: str | None = None
    sent_by_user_id: int
    sent_by_name: str | None = None
    sent_by_name_ar: str | None = None
    sent_at: datetime
    read_at: datetime | None = None
    done_at: datetime | None = None
    archived_at: datetime | None = None


class BookRecipientRead(ORMBase):
    id: int
    user_id: int
    user_name: str | None = None
    user_name_ar: str | None = None
    sent_by_user_id: int
    sent_by_name: str | None = None
    sent_by_name_ar: str | None = None
    purpose: SendPurpose
    note: str | None = None
    created_at: datetime
    read_at: datetime | None = None
    done_at: datetime | None = None
    archived_at: datetime | None = None
    revoked_at: datetime | None = None
    can_recall: bool = False


class BookSendRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=50)
    purpose: SendPurpose
    note: str | None = Field(default=None, max_length=500)
    # Personal records only: switch the level to directed in the same send.
    make_directed: bool = False
    include_references: bool = True


class BookSendSkipped(BaseModel):
    user_id: int
    reason: Literal["already_recipient", "self"]


class BookReferenceSkipped(BaseModel):
    user_id: int
    reason: Literal["not_cleared", "personal", "already_recipient", "self"]


class BookReferenceSendResult(BaseModel):
    book_id: int
    ref_number: str
    sent_user_ids: list[int]
    skipped: list[BookReferenceSkipped]


class BookSendResponse(BaseModel):
    sent: list[BookRecipientRead]
    skipped: list[BookSendSkipped]
    references: list[BookReferenceSendResult] = Field(default_factory=list)


class BookDeriveRequest(BaseModel):
    kind: Literal["reply", "based_on"]
    confidentiality: BookConfidentiality | None = None
    attach_reference: bool = True
    classification_code: str | None = None


class BookLinkCreate(BaseModel):
    target_book_id: int


class BookThreadItem(BaseModel):
    book_id: int
    ref_number: str
    subject: str | None
    confidentiality: BookConfidentiality
    created_at: datetime
    approval_state: str
    direction: Literal["outgoing", "incoming"]
    kind: Literal["reply", "based_on", "reference"]
    attached: bool
    can_unlink: bool
    addressee_user_id: int | None = None
    current_document_id: int | None = None


class BookConfidentialityUpdate(BaseModel):
    confidentiality: BookConfidentiality


class RecipientCandidateRead(BaseModel):
    id: int
    name: str
    name_ar: str | None = None
    g_number: str | None = None
    role: str
    has_secret_clearance: bool


class InboxPurposeCounts(BaseModel):
    info: int = 0
    action: int = 0
    reply: int = 0
    circulate: int = 0


class InboxSummaryRead(BaseModel):
    """Received counts exclude done/archived sends; archived counts whole records."""

    unread: int
    received: int
    sent: int
    archived: int = 0
    by_purpose: InboxPurposeCounts


class BookRead(ORMBase):
    id: int
    ref_number: str
    # Restricted historical projections may lack trustworthy category metadata.
    category_id: str | None
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
    # Set (detail + list enrichment) for v3-imported records whose original
    # file lives in the employee's vault rather than as a generated Document.
    imported_doc: ImportedDocRead | None = None
    created_at: datetime
    deleted_at: datetime | None
    priority: str | None
    approval_state: str
    access_scope: Literal["full", "assigned_revision"] = "full"
    confidentiality: BookConfidentiality = "general"
    # Full record write access; clients must also check the action's capability.
    can_write: bool = False
    # Caller may direct-send / forward this record (full access).
    can_send: bool = False
    # Caller may relabel the level (creator, manager, or admin with full access).
    can_change_confidentiality: bool = False
    # The caller's newest active received send of this record, if any.
    my_inbox: BookInboxRead | None = None
    selected_version_id: int | None = None
    can_sign: bool = False
    can_review: bool = False
    # Government classification code, e.g. "5/1"; None for plain books.
    classification_code: str | None = None
    # Non-None when a manager discarded the draft (ref stays in register).
    voided_at: datetime | None = None
    # True when the book has zero committed versions and is not voided.
    is_draft: bool = False
    # Active Word-editing session, if any.
    edit_session: BookEditSessionRead | None = None
    # Per-form signing path derived from the selected revision's template.
    signing_path: str | None = None
    submitted_by_user_id: int | None = None
    submitted_by_name: str | None = None
    submitted_by_name_ar: str | None = None
    submitted_by_g: str | None = None
    # Immutable original creator (books.created_by_user_id); distinct from the
    # submitter, who is only set on submit and reset on revision.
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_by_name_ar: str | None = None
    created_by_g: str | None = None
    # Captured submission instant for the selected revision, when trustworthy.
    submitted_at: datetime | None = None
    # The doc's named manager resolved to a login account (auto-route target).
    doc_manager_user_id: int | None = None
    doc_manager_name: str | None = None
    doc_manager_name_ar: str | None = None
    # Whether that linked account has a signature on file — drives the submit
    # dialog's "manager has no signature, add one" warning (lenient submit).
    doc_manager_has_signature: bool = False
    # Whether the selected revision is Word-authored. Mutation controls still
    # require full current-record access.
    is_word_book: bool = False
    # Caller responsibility on the selected current pending revision.
    your_step_kind: str | None = None
    approval_steps: list[BookApprovalStepRead] = Field(default_factory=list)
    attachment_paths: list[str] = Field(default_factory=list)
    versions: list[BookVersionRead] = Field(default_factory=list)
    original_creator_user_id: int | None = None
    included_papers_revision: int = 0
    included_papers_fixed_page_count: int = 0
    included_papers_total_page_count: int = 0
    included_papers: list[IncludedPaperRead] = Field(default_factory=list)
    included_papers_history: list[IncludedPapersHistoryRead] = Field(default_factory=list)

    # document_service stamps Book.created_at with datetime.now() — local, not
    # UTC. ``deleted_at`` / ``voided_at`` on this model ARE naive UTC and are
    # deliberately absent here so they get tagged UTC.
    LOCAL_WALLCLOCK_FIELDS: ClassVar[frozenset[str]] = frozenset({"created_at"})

    def _selected_version(self) -> BookVersionRead | None:
        if self.selected_version_id is not None:
            return next(
                (version for version in self.versions if version.id == self.selected_version_id),
                None,
            )
        return self.versions[-1] if self.versions else None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def current_template_id(self) -> str | None:
        """Selected revision's template_id — current unless an older revision was requested."""
        selected = self._selected_version()
        return selected.template_id if selected is not None else None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def service_id(self) -> str:
        """Which service produced the selected visible revision."""
        selected = self._selected_version()
        if selected is None and self.edit_session is not None:
            draft_service = word_draft_service(
                self.category_id, self.ref_number, self.classification_code
            )
            if draft_service is not None:
                return draft_service
        return resolve_service(
            self.subject,
            selected.template_id if selected is not None else None,
            versioned=selected is not None,
        )

    # Outbound notifications sent for this book (WhatsApp + SMS, auto-send + resends).
    sms: list[NotifyMessageRead] = Field(default_factory=list)
    # Set only when the row matched via FTS body search (not on ilike-only hits).
    search_snippet: str | None = None
    # Ledger desk list rows only (inbox scopes): active recipients the caller
    # may see (same rule as GET /books/{id}/recipients) and whose signature the
    # paper carries (the signer once signed, else the doc's named manager).
    recipients: list[BookRecipientRead] | None = None
    signer_name: str | None = None
    signer_name_ar: str | None = None


class BookListResponse(BaseModel):
    items: list[BookRead]
    total: int
    limit: int
    offset: int


class ServiceFacetRead(BaseModel):
    """One Records-rail entry: a service id, its record count, and how those
    records split across approval states (drives the rail's mini-dots)."""

    id: str
    count: int
    states: dict[str, int]


class BookFacetsResponse(BaseModel):
    """Rail + status-spine numbers over every non-deleted book (no paging).

    `services` omits services with no records and is ordered by TEMPLATE_FILES
    with "other" last. `total`/`states` are the office-wide "All" figures.
    """

    total: int
    states: dict[str, int]
    services: list[ServiceFacetRead]


class ApproverOptionRead(BaseModel):
    """Minimal user info for the submit-for-approval approver picker."""

    id: int
    name: str
    name_ar: str | None = None
    # True for the admin-set default manager — the picker preselects them.
    is_default: bool = False


# ---------------------------------------------------------------------------
# Approvals log (#31) — GET /books/approval-log?scope=sent|received
# ---------------------------------------------------------------------------


class ApprovalLogItem(ORMBase):
    """One flattened approvals-log row (either scope) — the selected visible
    revision, never a future document paired with an old grant.

    Inherits ORMBase so every timestamp serializes with an offset (the
    test_schema_utc_serialization guard). The service tags each stamp with its
    real zone before construction; aware values pass through untouched.
    """

    book_id: int
    ref_number: str
    subject: str | None = None
    category_name_ar: str | None = None
    category_name_en: str | None = None
    # Book.approval_state: none | pending | awaiting_scan | approved | rejected | returned
    status: str
    # The selected revision's OWN stored status column — independent of a
    # pending reviewer step's "pending" override on `status` above. A late
    # advisory review (reviewer step still pending after the signer already
    # decided) is the one case these two differ: `status` stays "pending"
    # (the review is still actionable) while `record_status` carries the
    # real approved/returned/rejected outcome so the UI can label it.
    record_status: str | None = None
    # Null when historical metadata is unavailable for a restricted revision.
    priority: str | None = "Normal"
    submitted_by_user_id: int | None = None
    submitted_by_name: str | None = None
    submitted_by_name_ar: str | None = None
    doc_manager_user_id: int | None = None
    doc_manager_name: str | None = None
    doc_manager_name_ar: str | None = None
    # The assigned signer's display name (never a doc manager/scan filer by default).
    approver_name: str | None = None
    approver_name_ar: str | None = None
    reviewer_names: list[str] = Field(default_factory=list)
    reviewer_names_ar: list[str | None] = Field(default_factory=list)
    # The selected revision's real submission instant, or null — never record
    # creation time.
    submitted_at: datetime | None = None
    # When the final verdict landed (None while still in flight).
    decided_at: datetime | None = None
    verdict: Literal["approved", "rejected", "returned"] | None = None
    # Selected revision's generated document — thumbnail source; None for
    # drafts and v3-imported records.
    document_id: int | None = None
    # The selected/displayed revision.
    version_id: int | None = None
    version_no: int | None = None
    # The revision the caller's assignment/grant actually belongs to — may
    # differ from version_no for a restricted historical row.
    assignment_version_no: int | None = None
    assigned_signer_user_id: int | None = None
    access_scope: Literal["full", "assigned_revision"] = "full"


class ApprovalLogResponse(BaseModel):
    """Paged approvals log — mirrors the BookListResponse envelope shape."""

    items: list[ApprovalLogItem]
    total: int
    limit: int
    offset: int


class ApprovalSummaryBucket(BaseModel):
    count: int
    oldest: ApprovalLogItem | None = None


class ApprovalSummaryResponse(BaseModel):
    """Counts + oldest row driving the generic Approvals landing rule and Home
    summaries — the caller's full authorized set, not one page."""

    can_view_sent: bool
    available_received_kinds: list[Literal["approver", "reviewer"]] = Field(default_factory=list)
    signature: ApprovalSummaryBucket
    review: ApprovalSummaryBucket
    sent: ApprovalSummaryBucket
    returned_count: int
    actionable_count: int


class ApprovalLogNeighborsResponse(BaseModel):
    position: int | None = None
    total: int
    previous: ApprovalLogItem | None = None
    next: ApprovalLogItem | None = None
