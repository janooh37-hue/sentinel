"""SQLAlchemy 2.x models for every parity table.

Schema decisions worth flagging (more in plans/02-data-layer.md):

* **Category IDs are strings.** Live v3 data (``books_database.json``)
  contains both the documented numeric categories ``1``..``12`` *and*
  legacy alpha codes (``HR``, ``GS``, ``NAT``, ``SC``). The importer
  needs to round-trip both, so :class:`BookCategory.id` is a ``String``
  PK seeded with the 12 defaults; unknown codes are inserted on demand.

* **Single global ref counter.** v3 uses one monotonic counter shared
  across every category (see :class:`app.core.refs.RefAllocator`).
  Persistence lives in a fixed single-row :class:`BookRefSequence`.

* **``Book.employee_id`` is nullable.** General Books in v3 may omit
  the employee (e.g. ``GS-0022`` has ``employee_g_number=""``).

* **Snapshot fields.** ``Book.employee_name_snapshot`` and similar
  capture the value at write time so historical records still render
  correctly if the source row is later renamed.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Final

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Single-row sequence is keyed by this constant so callers don't sprinkle
# magic ``1`` literals through the codebase.
REF_SEQUENCE_ID: Final[int] = 1


def _utcnow() -> datetime:
    """Naive UTC timestamp — matches the rest of the v3 data (no tz info)."""
    return datetime.now(UTC).replace(tzinfo=None)


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)  # e.g. "G3082"
    name_en: Mapped[str] = mapped_column(String(256))
    name_ar: Mapped[str | None] = mapped_column(String(256), nullable=True)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    doj: Mapped[date | None] = mapped_column(Date, nullable=True)
    doj_company: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="Active", server_default="Active")
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    position: Mapped[str | None] = mapped_column(String(128), nullable=True)
    position_ar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    other: Mapped[str | None] = mapped_column(String(256), nullable=True)
    duty_unit: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duty_post: Mapped[str | None] = mapped_column(String(128), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    passport_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    passport_no_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    uae_id_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    nationality: Mapped[str | None] = mapped_column(String(64), nullable=True)
    uae_id_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    passport_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    iban: Mapped[str | None] = mapped_column(String(34), nullable=True)
    contact: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Preferred WhatsApp-notification language ('ar' | 'en'). Default Arabic;
    # operators flip the few non-Arabic speakers to 'en' in the employee form.
    msg_language: Mapped[str] = mapped_column(String(2), default="ar", server_default="ar")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    leaves: Mapped[list[Leave]] = relationship(
        back_populates="employee", cascade="all, delete-orphan"
    )
    violations: Mapped[list[Violation]] = relationship(
        back_populates="employee", cascade="all, delete-orphan"
    )
    vault_files: Mapped[list[VaultFile]] = relationship(
        back_populates="employee", cascade="all, delete-orphan"
    )
    documents: Mapped[list[Document]] = relationship(
        back_populates="employee", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_employees_status", "status"),)


class BookCategory(Base):
    __tablename__ = "book_categories"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)  # "1".."12" or "HR" etc.
    name_en: Mapped[str | None] = mapped_column(String(128), nullable=True)
    name_ar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Legacy v3 field. The ref allocator (core.refs.RefAllocator) stamps the
    # category *id* into ref_number ("{id}-{n:04d}"), NOT this prefix, so the
    # column is currently dead. Smart-link book refs are matched by id-prefix
    # (see frontend lib/smartLinks.ts), not by prefix. Retained for v3 import
    # round-trip and possible future per-category prefixes — do not drop.
    prefix: Mapped[str] = mapped_column(String(16))
    requires_approval: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    books: Mapped[list[Book]] = relationship(back_populates="category")


class BookRefSequence(Base):
    """Single-row counter. ``id`` is always :data:`REF_SEQUENCE_ID`."""

    __tablename__ = "book_ref_sequence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    next_value: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    __table_args__ = (CheckConstraint("next_value >= 1", name="ck_book_ref_seq_positive"),)


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category_id: Mapped[str] = mapped_column(ForeignKey("book_categories.id"))
    ref_number: Mapped[str] = mapped_column(String(32))
    subject: Mapped[str | None] = mapped_column(String(512), nullable=True)
    direction: Mapped[str | None] = mapped_column(String(16), nullable=True)
    stamp_style: Mapped[str | None] = mapped_column(String(64), nullable=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    employee_name_snapshot: Mapped[str | None] = mapped_column(String(256), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    doc_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    priority: Mapped[str] = mapped_column(
        String(16), nullable=False, default="Normal", server_default="Normal"
    )
    # none | pending | approved | rejected | returned
    approval_state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )
    # FK to users.id omitted — SQLite batch ALTER cannot add a named FK constraint
    # to an existing table; referential integrity is enforced at the app layer.
    submitted_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The Manager directory row actually printed on the doc (reviewer/manager-
    # routed approvals, 2026-06-23). Submit-for-approval follows its `user_id`
    # link to auto-route. FK omitted (SQLite batch ALTER) — integrity app-side.
    doc_manager_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attachment_paths: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    # Attachment sources merged into the combined PDF (migration 0034):
    # [{"path": <rel path>, "slot_key": <form_policy slot key | None>}].
    # Distinct from attachment_paths (the film-strip scan papers).
    merged_attachment_paths: Mapped[list[dict[str, str | None]]] = mapped_column(
        JSON, default=list, server_default="[]"
    )

    category: Mapped[BookCategory] = relationship(back_populates="books")
    approval_steps: Mapped[list[BookApprovalStep]] = relationship(
        back_populates="book",
        order_by="BookApprovalStep.step_order",
        cascade="all, delete-orphan",
    )
    versions: Mapped[list[BookVersion]] = relationship(
        back_populates="book",
        order_by="BookVersion.version_no",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("ref_number", name="uq_books_ref_number"),
        Index("ix_books_employee_id", "employee_id"),
        Index("ix_books_created_at", "created_at"),
    )


class BookApprovalStep(Base):
    """One step in a book's approval chain. The ordered set of steps IS the
    audit trail: who was asked, what they decided, when, and any note."""

    __tablename__ = "book_approval_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[int | None] = mapped_column(
        ForeignKey("book_versions.id", ondelete="CASCADE"), nullable=True
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    stage_label: Mapped[str] = mapped_column(String(64), nullable=False)
    assignee_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    # pending | approved | rejected | returned
    state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    # "approver" = the single signing manager (gates approval_state); "reviewer"
    # = advisory (recorded in the chain, never gates). Migration 0039.
    kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default="approver", server_default="approver"
    )
    # First time this step's assignee opened the record (auto, chain-only).
    seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    book: Mapped[Book] = relationship(back_populates="approval_steps")
    version: Mapped[BookVersion | None] = relationship(back_populates="approval_steps")

    __table_args__ = (Index("ix_book_steps_book_order", "book_id", "step_order"),)


class BookVersion(Base):
    """One committed generation of a Book.

    A version snapshots the submitted form ``fields`` (so a returned/rejected
    book can be re-opened and edited), links to the primary ``Document`` it
    produced (reuses the document download/preview endpoints), and carries its
    own approval ``status``. The book's "current" version is the highest
    ``version_no``.
    """

    __tablename__ = "book_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    template_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fields: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    # initial | revision
    trigger: Mapped[str] = mapped_column(
        String(16), nullable=False, default="initial", server_default="initial"
    )
    # none | pending | approved | rejected | returned
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    # Signing (approval == signing). Populated by book_service.sign_book.
    signed_pdf_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Whether the manager signature was baked into the form at generation time
    # (then it can't be submitted for approval — nothing left to sign).
    manager_sig_embedded: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    signed_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    book: Mapped[Book] = relationship(back_populates="versions")
    approval_steps: Mapped[list[BookApprovalStep]] = relationship(
        back_populates="version",
        foreign_keys="BookApprovalStep.version_id",
        order_by="BookApprovalStep.step_order",
        cascade="all, delete-orphan",
    )
    annotations: Mapped[list[BookAnnotation]] = relationship(
        back_populates="version",
        cascade="all, delete-orphan",
        order_by="BookAnnotation.created_at",
    )

    __table_args__ = (
        UniqueConstraint("book_id", "version_no", name="uq_book_versions_book_version"),
        Index("ix_book_versions_book", "book_id"),
    )


class BookAnnotation(Base):
    """A markup placed on a book version's PDF during review.

    Geometry is normalized to the page (0-1) so marks survive zoom/DPR/reflow:
    pin = ``{"x","y"}``; highlight = ``{"x","y","w","h"}``. A comment-bearing
    annotation on the current version can stand in for a typed return/reject
    reason (see ``book_service.decide_step``). ``kind`` reserves ``"freehand"``
    for a later slice; v1 builds ``pin`` + ``highlight`` only.
    """

    __tablename__ = "book_annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("book_versions.id", ondelete="CASCADE"), nullable=False
    )
    page: Mapped[int] = mapped_column(Integer, nullable=False)
    # pin | highlight  (freehand reserved, not built)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    geometry: Mapped[dict[str, float]] = mapped_column(JSON, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # FK to users.id omitted (SQLite batch ALTER limitation, mirrors Book.submitted_by_user_id).
    author_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    version: Mapped[BookVersion] = relationship(back_populates="annotations")

    __table_args__ = (Index("ix_book_annotations_version", "version_id"),)


class Leave(Base):
    __tablename__ = "leaves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"))
    leave_type: Mapped[str] = mapped_column(String(64))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    days: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="Approved")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    doc_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    certificate_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    return_doc_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    employee: Mapped[Employee] = relationship(back_populates="leaves")
    documents: Mapped[list[Document]] = relationship(back_populates="leave")

    __table_args__ = (
        Index("ix_leaves_employee_start", "employee_id", "start_date"),
        # Backstop for the app-level dedup guard: no two live rows may share the
        # natural key. Partial (deleted_at IS NULL) so a soft-deleted duplicate
        # doesn't block re-creating the leave later. See migration 0045.
        Index(
            "ux_leaves_natural_key",
            "employee_id",
            "leave_type",
            "start_date",
            "end_date",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )


class Violation(Base):
    __tablename__ = "violations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"))
    violation_type: Mapped[str] = mapped_column(String(64))
    date: Mapped[date] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_taken: Mapped[str | None] = mapped_column(Text, nullable=True)
    deduction_days: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="Open")
    doc_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    employee: Mapped[Employee] = relationship(back_populates="violations")
    documents: Mapped[list[Document]] = relationship(back_populates="violation")

    __table_args__ = (Index("ix_violations_employee_date", "employee_id", "date"),)


class WhatsAppMessage(Base):
    """One WhatsApp send attempt (success or failure) for an employee.

    Powers the per-record "Sent ✓ / Failed" badge and is the audit trail.
    ``event_ref`` is a stable per-record key (``"<event_type>:<id>"``) so a
    record's send history is queryable without touching the source row.
    Re-sends are first-class: each attempt is its own row.
    """

    __tablename__ = "whatsapp_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"))
    event_type: Mapped[str] = mapped_column(String(32))
    event_ref: Mapped[str] = mapped_column(String(64))
    language: Mapped[str] = mapped_column(String(2))
    phone: Mapped[str] = mapped_column(String(32))
    template: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))  # 'sent' | 'failed'
    provider_msg_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (Index("ix_whatsapp_messages_event", "event_type", "event_ref"),)


class SmsMessage(Base):
    """One SMS send attempt (success or failure) for an employee.

    Mirrors WhatsAppMessage but for the on-site SIM gateway channel: no
    ``template`` column (SMS sends full text), and ``provider_msg_id`` holds
    the gateway's message id. Re-sends are first-class: each attempt is its
    own row. ``event_ref`` (``"<event_type>:<id>"``) keys a record's history.
    """

    __tablename__ = "sms_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"))
    event_type: Mapped[str] = mapped_column(String(32))
    event_ref: Mapped[str] = mapped_column(String(64))
    language: Mapped[str] = mapped_column(String(2))
    phone: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))  # 'sent' | 'failed'
    provider_msg_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    # Full rendered SMS text (added 0047). Nullable: historical rows predate it.
    body: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_sms_messages_event", "event_type", "event_ref"),)


class Manager(Base):
    __tablename__ = "managers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name_en: Mapped[str | None] = mapped_column(String(256), nullable=True)
    name_ar: Mapped[str | None] = mapped_column(String(256), nullable=True)
    title: Mapped[str | None] = mapped_column(String(256), nullable=True)
    sig_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    # Login account this manager approves with (reviewer/manager-routed
    # approvals, 2026-06-23). NULL = names-only manager. FK omitted (SQLite
    # batch ALTER) — integrity app-side.
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Submitter(Base):
    __tablename__ = "submitters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(256))
    stored_sig_path: Mapped[str | None] = mapped_column(Text, nullable=True)


class GeneralBookRecipient(Base):
    """Reusable "to" person for General Book documents.

    The General Book template has a recipient slot ({{ recipient_name }}) that
    addresses a person/role outside the employee table (e.g. "HR Director").
    Operators manage the list via a small picker; ``recipient_id`` flows from
    the form through ``document_service``, which resolves it to the name string
    written into the DOCX.
    """

    __tablename__ = "general_book_recipients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    name_ar: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (UniqueConstraint("name", name="uq_general_book_recipients_name"),)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)  # JSON-encoded payload
    # Sidecar JSON column for large structured settings (Phase 17 polish).
    # Operator-controlled dashboard widget visibility/ordering lives under the
    # well-known key ``settings.dashboard_layout``; all other settings continue
    # to use ``value``. Stored as a native JSON column so the read path can
    # return a typed dict without a string decode.
    dashboard_layout: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)


class VaultFile(Base):
    __tablename__ = "vault_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"))
    kind: Mapped[str] = mapped_column(String(32))
    filename: Mapped[str] = mapped_column(String(256))
    path: Mapped[str] = mapped_column(Text)  # relative to vault root
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    employee: Mapped[Employee] = relationship(back_populates="vault_files")

    __table_args__ = (Index("ix_vault_files_employee_kind", "employee_id", "kind"),)


class Document(Base):
    """Generated document record — one row per DOCX/PDF generation event.

    When a form generates companion documents (e.g. Resignation Letter +
    Resignation Declaration), both rows share the same ``submission_id`` UUID
    so they can be fetched as a group.  ``role`` distinguishes the primary
    (caller-requested) document from any auto-generated companions.
    """

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Nullable so admin-category forms (e.g. General Book) can generate without
    # being bound to an employee — see Tier 4 in forms-audit/PLAN.html.
    employee_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=True
    )
    template_id: Mapped[str] = mapped_column(String(64))
    ref_number: Mapped[str] = mapped_column(String(32))
    docx_path: Mapped[str] = mapped_column(String(512))
    pdf_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    leave_id: Mapped[int | None] = mapped_column(
        ForeignKey("leaves.id", ondelete="SET NULL"), nullable=True
    )
    violation_id: Mapped[int | None] = mapped_column(
        ForeignKey("violations.id", ondelete="SET NULL"), nullable=True
    )
    # P04-J: companion-doc support
    submission_id: Mapped[str] = mapped_column(String(36), nullable=False)
    role: Mapped[str] = mapped_column(
        String(16), nullable=False, default="primary", server_default="primary"
    )

    employee: Mapped[Employee | None] = relationship(back_populates="documents")
    leave: Mapped[Leave | None] = relationship(back_populates="documents")
    violation: Mapped[Violation | None] = relationship(back_populates="documents")

    __table_args__ = (
        Index("ix_documents_employee_id", "employee_id"),
        Index("ix_documents_created_at", "created_at"),
        Index("ix_documents_submission_id", "submission_id"),
    )


class LedgerEntry(Base):
    """Correspondence log entry — Phase 07 new feature.

    Stores date-ordered records of every external/internal communication:
    emails, phone calls, in-person meetings, faxes, and letters.

    ``attachment_paths`` and ``tags`` are JSON columns (list of strings).
    Normalisation of tags is deferred to Phase 12.
    ``created_by`` is a placeholder for Phase 25 auth — not enforced via FK.
    """

    __tablename__ = "ledger_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    counterparty: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    notes_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_paths: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    inline_images: Mapped[dict[str, str]] = mapped_column(
        JSON, nullable=False, default=dict, server_default="{}"
    )
    draft_meta: Mapped[dict[str, str | list[str] | None] | None] = mapped_column(
        JSON, nullable=True
    )
    related_book_id: Mapped[int | None] = mapped_column(
        ForeignKey("books.id", ondelete="SET NULL"), nullable=True
    )
    related_employee_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # NULL == unread. Set on first open (via POST /entries/{id}/mark-read) or
    # in bulk via POST /mark-all-read. Drives the NavBell badge.
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Phase 1 (Ledger→Outlook): mailbox owner. NULL == org-shared correspondence
    # log (populated in Phase 3); a non-NULL value scopes the email to one user's
    # mailbox. FK to users.id omitted (SQLite batch ALTER can't add a named FK to
    # an existing table; integrity enforced app-side, mirrors Book.submitted_by_user_id).
    owner_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Full recipient lists captured from the IMAP headers. Each item is
    # {"name": str, "address": str}. bcc only populated on mail we send.
    to_recipients: Mapped[list[dict[str, str]]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    cc_recipients: Mapped[list[dict[str, str]]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    bcc_recipients: Mapped[list[dict[str, str]]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    # Threading headers promoted from the ``msgid:`` tag to real columns. The
    # tag is still written for dedup/back-compat (see email_service).
    message_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    in_reply_to: Mapped[str | None] = mapped_column(String(512), nullable=True)
    email_references: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Phase 3 (Correspondence Log): auto-log provenance. ``source_kind`` is e.g.
    # "generated_doc" / "intake_scan"; ``category_id`` files the row under a
    # CorrespondenceCategory. FK omitted on category_id — this is an ALTER on the
    # existing ledger_entries table (SQLite batch-ALTER can't add a named FK),
    # integrity enforced app-side, mirroring owner_user_id above.
    source_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    category_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    related_book: Mapped[Book | None] = relationship("Book", foreign_keys=[related_book_id])
    related_employee: Mapped[Employee | None] = relationship(
        "Employee", foreign_keys=[related_employee_id]
    )

    __table_args__ = (
        Index("ix_ledger_entries_entry_date_desc", "entry_date"),
        Index("ix_ledger_entries_counterparty", "counterparty"),
        Index("ix_ledger_entries_direction_channel", "direction", "channel"),
        Index("ix_ledger_entries_related_employee_id", "related_employee_id"),
        Index("ix_ledger_entries_related_book_id", "related_book_id"),
        Index("ix_ledger_entries_owner_user_id", "owner_user_id"),
        Index("ix_ledger_entries_message_id", "message_id"),
        Index("ix_ledger_entries_source_kind", "source_kind"),
        Index("ix_ledger_entries_category_id", "category_id"),
    )


class EditorTemplate(Base):
    """Reusable HTML snippet for the HugeRTE editor.

    Stored as plain HTML (sanitisation/escaping is the editor's job). The
    unique index on ``name`` is partial (``deleted_at IS NULL``), so a
    soft-deleted name can be re-used by a fresh row.
    """

    __tablename__ = "editor_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    html: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index(
            "ix_editor_templates_name",
            "name",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )


class EmailAccount(Base):
    """IMAP account configuration for ledger auto-import.

    Stores connection details for a signed-in user's mailbox (e.g. IONOS
    ahmed.m@gssg.ae). One row per signed-in user (``owner_user_id``).
    ``password_encrypted`` is a Fernet ciphertext; the key is held outside
    the DB at ``<data_dir>/.email_key`` so backups can't recover credentials
    on their own.
    """

    __tablename__ = "email_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(256), nullable=False)
    imap_host: Mapped[str] = mapped_column(String(256), nullable=False)
    imap_port: Mapped[int] = mapped_column(Integer, nullable=False, default=993)
    use_ssl: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    username: Mapped[str] = mapped_column(String(256), nullable=False)
    password_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    # SMTP — same login as IMAP unless overridden later. IONOS uses
    # smtp.ionos.com:587 with STARTTLS; Gmail/Outlook also use 587.
    smtp_host: Mapped[str] = mapped_column(String(256), nullable=False, default="smtp.ionos.com")
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False, default=587)
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Sent-mail folder for outgoing classification; defaults to "Sent".
    sent_folder: Mapped[str] = mapped_column(String(64), nullable=False, default="Sent")
    inbox_folder: Mapped[str] = mapped_column(String(64), nullable=False, default="INBOX")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # 0 disables the background scheduler; positive int = minutes between runs.
    sync_interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    # Linked Employee for identity-aware defaults (Phase 14). Nullable so
    # the lock screen + email setup still work before linking; once set, the
    # Submitter picker, Ledger created_by, document signer all default to
    # this employee.
    linked_employee_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    # Phase 1: each account belongs to one signed-in user. FK to users.id omitted
    # (SQLite batch ALTER limitation, mirrors LedgerEntry.owner_user_id).
    owner_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_sync_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (Index("ix_email_accounts_owner_user_id", "owner_user_id"),)


class AddressBookContact(Base):
    """Per-user saved email contact — Ledger→Outlook Phase 2.

    Powers compose autocomplete and the Contacts view. Scoped to one
    signed-in user via ``owner_user_id`` (FK to users.id omitted — SQLite
    batch ALTER limitation, app-side integrity, mirrors
    ``LedgerEntry.owner_user_id`` / ``EmailAccount.owner_user_id``). A contact
    is unique per owner+address; saving an existing address updates the
    display name (see ``contacts_service.save_contact``).
    """

    __tablename__ = "address_book_contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    display_name: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    address: Mapped[str] = mapped_column(String(320), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (
        UniqueConstraint("owner_user_id", "address", name="uq_address_book_owner_address"),
        Index("ix_address_book_contacts_owner_user_id", "owner_user_id"),
    )


class RecipientList(Base):
    """Per-user saved recipient (distribution) list — Ledger compose.

    Mirrors ``AddressBookContact`` owner-scoping (``owner_user_id``, no DB-level
    FK; app-side integrity). ``members`` is a JSON array of
    ``{"field": "to"|"cc", "address": str, "display_name": str}``. A list name is
    unique per owner (see ``recipient_lists_service``).
    """

    __tablename__ = "recipient_lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    members: Mapped[list[dict[str, str]]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=True
    )

    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_recipient_lists_owner_name"),
        Index("ix_recipient_lists_owner_user_id", "owner_user_id"),
    )


class CorrespondenceCategory(Base):
    """A sub-item of the shared Correspondence Log — Ledger→Outlook Phase 3.

    Bilingual document-type bucket the auto-log files records under (HR letters,
    Salary/bank, Leaves, Government/NAT, Incoming stamped, + admin-created).
    ``key`` is a stable machine id (rules reference it indirectly via FK); the
    ``system`` flag marks seeded rows an admin may disable but should not delete.
    """

    __tablename__ = "correspondence_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    name_en: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    name_ar: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (UniqueConstraint("key", name="uq_correspondence_categories_key"),)


class CorrespondenceRule(Base):
    """An admin-editable auto-log rule — Ledger→Outlook Phase 3.

    Fires when an event of ``trigger`` matches every filter in ``condition_json``
    (a JSON object like ``{"category": "HR"}`` or ``{"kind": "incoming"}``; an
    empty object matches any event of that trigger). On a match the auto-log
    hook files a shared ledger row under ``category_id``. Seeded with the
    defaults ON; ``email_sent`` ships OFF.
    """

    __tablename__ = "correspondence_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # document_generated | book_signed | intake_classified | email_sent
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    condition_json: Mapped[dict[str, str]] = mapped_column(
        JSON, nullable=False, default=dict, server_default="{}"
    )
    category_id: Mapped[int] = mapped_column(
        ForeignKey("correspondence_categories.id", ondelete="CASCADE"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (Index("ix_correspondence_rules_trigger", "trigger"),)


class User(Base):
    """Multi-user auth account (migration 0017).

    Login identity is the ``email`` connected to an employee's G-number.
    ``password_hash`` is a bcrypt digest; ``role`` and ``status`` are
    admin-managed (the first registered account auto-promotes to ``admin`` and
    fills the ``settings.admin_employee_id`` slot — see ``auth_service``).
    See ``docs/superpowers/plans/2026-05-24-multi-user-login.md``.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(256), nullable=False)  # stored lowercased
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    employee_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Manager's signature image (relative to data_dir). Set via /auth/me/signature.
    # Required to be an approval signer; embedded into the form on approve.
    signature_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Single-holder flag (migration 0034): the manager preselected as assignee
    # when an in_app form is submitted. Swapped via the default-manager endpoint.
    is_default_manager: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # operator | manager | admin — stored (admin-assigned), authoritative for auth.
    role: Mapped[str] = mapped_column(
        String(16), nullable=False, default="operator", server_default="operator"
    )
    # pending | active | locked | disabled
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    failed_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    sessions: Mapped[list[AuthSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    employee: Mapped[Employee | None] = relationship()

    __table_args__ = (UniqueConstraint("email", name="uq_users_email"),)


class AuthSession(Base):
    """Server-side session backing the httpOnly ``gssg_session`` cookie.

    The cookie carries an opaque random token; only its sha256 hash is stored
    here so a DB leak can't be replayed as a live session.
    """

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(256), nullable=True)
    revoked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    user: Mapped[User] = relationship(back_populates="sessions")

    __table_args__ = (
        Index("ix_auth_sessions_token_hash", "token_hash", unique=True),
        Index("ix_auth_sessions_user_id", "user_id"),
    )


class RolePermission(Base):
    """Default capability map per role (migration 0018).

    One row per (role, capability) pair the role grants by default. Seeded from
    ``core.permissions.ROLE_DEFAULTS`` on migration so existing installs keep
    their implied behavior. The admin role still short-circuits to "all" in the
    resolver, so its rows are advisory.
    """

    __tablename__ = "role_permissions"

    role: Mapped[str] = mapped_column(String(16), primary_key=True)
    capability: Mapped[str] = mapped_column(String(64), primary_key=True)


class UserPermission(Base):
    """Per-user capability override layer (migration 0018).

    ``effect`` is ``grant`` (add the capability on top of the role default) or
    ``deny`` (remove it). Resolution: role defaults plus grants minus denies.
    """

    __tablename__ = "user_permissions"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    capability: Mapped[str] = mapped_column(String(64), primary_key=True)
    effect: Mapped[str] = mapped_column(String(8), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (CheckConstraint("effect IN ('grant', 'deny')", name="ck_user_perm_effect"),)


class AuditLog(Base):
    """Phase 02 preview — wired up properly in Phase 23.

    Kept tiny on purpose so the schema baseline doesn't churn when audit
    requirements firm up.
    """

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor: Mapped[str | None] = mapped_column(String(128), nullable=True)
    action: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON-encoded
    ts: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (Index("ix_audit_log_ts", "ts"),)


class DocumentExtraction(Base):
    """One OCR extraction run — audit trail + raw_text seed for future FTS."""

    __tablename__ = "document_extractions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    document_type: Mapped[str] = mapped_column(String(32))
    fields: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(default=0.0)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    employee_id: Mapped[str | None] = mapped_column(
        String(16), ForeignKey("employees.id"), nullable=True
    )
    source_file: Mapped[str | None] = mapped_column(String(512), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, server_default=func.current_timestamp()
    )


class ScanInbox(Base):
    """One inbound document awaiting OCR-triage (the ambient Scan Inbox).

    A row is born ``pending_ocr`` by a trigger (Phase 1: email attachments),
    OCR'd + routed off-thread by the drain job, then either ``auto_filed``
    (reversible attach), ``awaiting_confirmation`` (uncertain — operator taps),
    or ``unrouted`` (unknown — operator routes). Terminal: ``filed``/``dismissed``.
    """

    __tablename__ = "scan_inbox"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, server_default=func.current_timestamp()
    )
    source: Mapped[str] = mapped_column(String(32))  # email_attachment | upload | scan_back | batch
    owner_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ledger_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entries.id", ondelete="SET NULL"), nullable=True
    )
    file_path: Mapped[str] = mapped_column(String(512))  # relative to data_dir
    filename: Mapped[str] = mapped_column(String(512))
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    state: Mapped[str] = mapped_column(
        String(24), default="pending_ocr", server_default="pending_ocr"
    )
    document_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    fields: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(default=0.0)
    qr_refs: Mapped[list[str]] = mapped_column(JSON, default=list)
    proposed_route: Mapped[str | None] = mapped_column(String(24), nullable=True)
    proposed_employee_id: Mapped[str | None] = mapped_column(
        String(16), ForeignKey("employees.id"), nullable=True
    )
    proposed_book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id"), nullable=True)
    proposed_ref: Mapped[str | None] = mapped_column(String(32), nullable=True)
    match_score: Mapped[float | None] = mapped_column(nullable=True)
    confidence_tier: Mapped[str | None] = mapped_column(String(8), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    undo_token: Mapped[str | None] = mapped_column(String(256), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(24), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(String(512), nullable=True)

    __table_args__ = (
        Index("ix_scan_inbox_state", "state"),
        Index("ix_scan_inbox_owner_state", "owner_user_id", "state"),
        Index("ix_scan_inbox_content_hash", "content_hash"),
    )


class PushSubscription(Base):
    """Web Push subscription for a signed-in user (migration 0039).

    One row per (user, browser/device endpoint). The endpoint + p256dh/auth
    keys are the W3C Push API subscription the SW produced; the backend signs
    pushes with VAPID and POSTs to ``endpoint``. Pruned on 410 Gone.
    """

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(128), nullable=False)
    auth: Mapped[str] = mapped_column(String(64), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # UI language at subscribe time ('en' | 'ar' | …) so pushes can be localized
    # per device. NULL → treat as English.
    locale: Mapped[str | None] = mapped_column(String(8), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, server_default=func.current_timestamp()
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "endpoint", name="uq_push_subscriptions_user_endpoint"),
        Index("ix_push_subscriptions_user_id", "user_id"),
    )


class PushSent(Base):
    """Durable per-(user, item) push ledger (migration 0041).

    One row per actionable item we've already pushed a user about, so the
    notifier sends each new item exactly ONCE and survives process restarts —
    the previous in-memory count-digest re-notified every still-open item on
    every boot. ``ref`` is an opaque per-kind item key (e.g. ``"book:42"``).
    """

    __tablename__ = "push_sent"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    ref: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, server_default=func.current_timestamp()
    )

    __table_args__ = (
        UniqueConstraint("user_id", "kind", "ref", name="uq_push_sent_user_kind_ref"),
        Index("ix_push_sent_user_id", "user_id"),
    )


class PermissionRequest(Base):
    """Employee-initiated permission request (migration 0042).

    An employee requests a capability; an admin reviews and grants/denies.
    ``status`` transitions: pending → approved | denied.
    """

    __tablename__ = "permission_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    capability: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    decision: Mapped[str | None] = mapped_column(String(16), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, server_default=func.current_timestamp()
    )
    decided_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_permission_requests_user_id", "user_id"),
        Index("ix_permission_requests_status", "status"),
    )


__all__ = [
    "REF_SEQUENCE_ID",
    "AppSetting",
    "AuditLog",
    "AuthSession",
    "Book",
    "BookApprovalStep",
    "BookCategory",
    "BookRefSequence",
    "BookVersion",
    "Document",
    "DocumentExtraction",
    "EditorTemplate",
    "EmailAccount",
    "Employee",
    "GeneralBookRecipient",
    "Leave",
    "LedgerEntry",
    "Manager",
    "PermissionRequest",
    "PushSubscription",
    "RolePermission",
    "ScanInbox",
    "Submitter",
    "User",
    "UserPermission",
    "VaultFile",
    "Violation",
]
