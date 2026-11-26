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

import datetime as dt
from datetime import date, datetime
from typing import Any, Final

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
    Time,
    UniqueConstraint,
    false,
    func,
    text,
)
from sqlalchemy.orm import Mapped, foreign, mapped_column, query_expression, relationship

from app.core.clock import utcnow
from app.db.base import Base

# Single-row sequence is keyed by this constant so callers don't sprinkle
# magic ``1`` literals through the codebase.
REF_SEQUENCE_ID: Final[int] = 1


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
    # Scheduled departure — the status this employee flips to on `end_date`,
    # while `status` stays 'Active' through the notice period. NULL means no
    # pending departure. Only ever 'Resigned' or 'Terminated': written by the
    # Resignation Letter and by update_employee, cleared on flip or cancel.
    pending_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Destination site while Transferred, or while a transfer is pending
    # (`pending_status == 'Transferred'`). Cleared on leaving Transferred.
    transfer_site: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Expected return of a temporary transfer: the daily job reactivates the
    # employee on this date. NULL = open-ended transfer.
    transfer_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    position: Mapped[str | None] = mapped_column(String(128), nullable=True)
    position_ar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Deliberately not a ForeignKey: adding the constraint would force a full
    # employees-table rewrite in SQLite.
    supervisor_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Unknown for historical records; an FK would force a SQLite table rewrite.
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Bulk imports and scripted batches are not employee-added activity.
    imported: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

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

    __table_args__ = (
        Index("ix_employees_status", "status"),
        Index("ix_employees_supervisor_id", "supervisor_id"),
    )


class EmployeeFormerId(Base):
    """Append-only number corrections; ownership follows the employee's live ID."""

    __tablename__ = "employee_former_ids"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(
        String(16), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    former_id: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    new_id: Mapped[str] = mapped_column(String(16), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    changed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)


class EmployeeStatusEvent(Base):
    """Append-only history of an employee's status (migration 0094).

    One row per real change from any writer — the status dialog / form, the
    Resignation Letter, the daily scheduler — plus one ``imported`` row per
    employee who was already non-Active when history began. Surfaced as the
    ``status`` kind in the employee Activity tab.

    ``kind``: changed | scheduled | scheduled_cancelled | applied | imported.
    ``source``: manual | resignation_letter | scheduler | backfill.
    ``effective_date`` is the business date (departure / return); ``created_at``
    is when it was saved.
    """

    __tablename__ = "employee_status_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(
        String(16), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[str] = mapped_column(String(32), nullable=False)
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    site: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Expected return date of a temporary transfer, as known when recorded.
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    __table_args__ = (
        Index("ix_employee_status_events_employee_created", "employee_id", "created_at"),
    )


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


class ClassifiedRefSequence(Base):
    """Single-row counter for classified refs (1/{tab}/GSSG/{serial}); id always 1."""

    __tablename__ = "classified_ref_sequence"

    id: Mapped[int] = mapped_column(primary_key=True)
    next_value: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    __table_args__ = (CheckConstraint("next_value >= 1", name="ck_classified_ref_min"),)


class BookEditSession(Base):
    """Word-editing session over a working docx (WebDAV target).

    For a book, template_name is the library template the draft started from
    (NULL for none or reopen). With book_id NULL, it is the library name the
    template session will be saved as.
    """

    __tablename__ = "book_edit_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    book_id: Mapped[int | None] = mapped_column(
        ForeignKey("books.id", ondelete="CASCADE"), nullable=True
    )
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    working_path: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="active")  # active|finished|discarded
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_put_at: Mapped[datetime | None] = mapped_column(nullable=True)
    template_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Report-only: the picked signer employee + whether to embed their signature
    # at Finish. Set by create_report_word_book; read by finish_word_session.
    signer_employee_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sign_on_finish: Mapped[bool | None] = mapped_column(nullable=True)

    __table_args__ = (
        Index(
            "uq_book_edit_sessions_active",
            "book_id",
            unique=True,
            sqlite_where=text("state = 'active'"),
        ),
    )


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    priority: Mapped[str] = mapped_column(
        String(16), nullable=False, default="Normal", server_default="Normal"
    )
    # none | pending | approved | rejected | returned
    approval_state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )
    # unsent | sent | confirmed — parallel to approval_state; neither gates the other.
    send_state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unsent", server_default="unsent"
    )
    # Government classification (التبويب) code, e.g. "5/1"; NULL = plain book.
    classification_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Discarded draft: the reserved ref stays in the register, struck through.
    voided_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # FK to users.id omitted — SQLite batch ALTER cannot add a named FK constraint
    # to an existing table; referential integrity is enforced at the app layer.
    submitted_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Original creator (users.id): immutable; set once at creation. No FK, same
    # SQLite batch-ALTER reason as submitted_by_user_id.
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Record level (migration 0102): general | personal | secret | directed.
    # Gates who can open the record; see book_service.user_visibility_clause.
    confidentiality: Mapped[str] = mapped_column(
        String(16), nullable=False, default="general", server_default="general"
    )
    # The Manager directory row actually printed on the doc (reviewer/manager-
    # routed approvals, 2026-06-23). Submit-for-approval follows its `user_id`
    # link to auto-route. FK omitted (SQLite batch ALTER) — integrity app-side.
    doc_manager_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attachment_paths: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    # Ordered sources merged into the official PDF package. Legacy entries are
    # ``{path, slot_key}``; package-managed entries add stable metadata.
    # Distinct from attachment_paths (the film-strip scan papers).
    merged_attachment_paths: Mapped[list[dict[str, object]]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    included_papers_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # Normalised search corpus (migration 0057) — populated by Task 15.
    # FTS5 external-content table books_fts indexes this column.
    search_text: Mapped[str | None] = mapped_column(Text, nullable=True)

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
        Index("ix_books_created_by_user_id", "created_by_user_id"),
        CheckConstraint(
            "confidentiality IN ('general', 'personal', 'secret', 'directed')",
            name="ck_books_confidentiality",
        ),
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
    # First time the submitter opened this signing-manager outcome.
    outcome_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

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
    approval_context: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    # initial | revision
    trigger: Mapped[str] = mapped_column(
        String(16), nullable=False, default="initial", server_default="initial"
    )
    # none | pending | approved | rejected | returned
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none", server_default="none"
    )
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Signing (approval == signing). Populated by book_service.sign_book.
    signed_pdf_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Private immutable signed form used to rebuild the downloadable package.
    # Never served directly.
    signed_base_pdf_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Stable included-paper IDs already flattened into a physical signed scan.
    signed_embedded_paper_ids: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    # Whether the manager signature was baked into the form at generation time
    # (then it can't be submitted for approval — nothing left to sign).
    manager_sig_embedded: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    signed_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Active tracked signature-placement artifact revision (0 = none tracked
    # yet — an older row, or a version that never got a manager/approver
    # drawing marked). Only actual manager/approver drawings activate this;
    # see SignatureArtifactRevision. Bumped by signature_placement_service on
    # correction; unfile/physical-copy replacement resets it to 0 without
    # deleting prior SignatureArtifactRevision history rows.
    signature_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    book: Mapped[Book] = relationship(back_populates="versions")
    approval_steps: Mapped[list[BookApprovalStep]] = relationship(
        back_populates="version",
        foreign_keys="BookApprovalStep.version_id",
        order_by="BookApprovalStep.step_order",
        cascade="all, delete-orphan",
    )
    revision_access: Mapped[list[BookRevisionAccess]] = relationship(
        back_populates="version",
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


class BookRevisionAccess(Base):
    """Durable revision-scoped access earned by completing an assigned step."""

    __tablename__ = "book_revision_access"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("book_versions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decided_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revocation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    version: Mapped[BookVersion] = relationship(back_populates="revision_access")

    __table_args__ = (
        UniqueConstraint(
            "version_id",
            "user_id",
            "kind",
            name="uq_book_revision_access_version_user_kind",
        ),
        Index(
            "ix_book_revision_access_user_revoked_version",
            "user_id",
            "revoked_at",
            "version_id",
        ),
        CheckConstraint(
            "kind IN ('approver', 'reviewer')",
            name="ck_book_revision_access_kind",
        ),
        CheckConstraint(
            "state IN ('approved', 'rejected', 'returned', 'reviewed', 'changes_requested')",
            name="ck_book_revision_access_state",
        ),
    )


class BookRecipient(Base):
    """A direct send of a record to one user (migration 0102).

    An active row (``revoked_at IS NULL``) lets the recipient open the record
    whatever its level or record type. A recall sets ``revoked_at``; the row
    stays as history. At most one active row per (book, user).
    """

    __tablename__ = "book_recipients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    sent_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # info | action | reply | circulate (للاطلاع / للتنفيذ / للإفادة / للتعميم)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        Index("ix_book_recipients_user_revoked", "user_id", "revoked_at"),
        Index("ix_book_recipients_book", "book_id"),
        Index(
            "uq_book_recipients_active",
            "book_id",
            "user_id",
            unique=True,
            sqlite_where=text("revoked_at IS NULL"),
        ),
        CheckConstraint(
            "purpose IN ('info', 'action', 'reply', 'circulate')",
            name="ck_book_recipients_purpose",
        ),
    )


class BookLink(Base):
    """An outgoing reply, derivation or live reference to another record."""

    __tablename__ = "book_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    target_book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    attached: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (
        CheckConstraint("kind IN ('reply', 'based_on', 'reference')", name="ck_book_links_kind"),
        UniqueConstraint("book_id", "target_book_id", name="uq_book_links_pair"),
        Index("ix_book_links_target", "target_book_id"),
    )


class BookFolder(Base):
    """A personal or team filing folder; a null owner denotes a team folder."""

    __tablename__ = "book_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, server_default=func.current_timestamp()
    )

    __table_args__ = (Index("ix_book_folders_owner_user_id", "owner_user_id"),)


class BookFolderShare(Base):
    """A selected user or department allowed to see a restricted team folder."""

    __tablename__ = "book_folder_shares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    folder_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("book_folders.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, server_default=func.current_timestamp()
    )

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NOT NULL AND department IS NULL) OR "
            "(user_id IS NULL AND department IS NOT NULL)",
            name="ck_book_folder_shares_target",
        ),
        UniqueConstraint("folder_id", "user_id", name="uq_book_folder_shares_user"),
        UniqueConstraint("folder_id", "department", name="uq_book_folder_shares_department"),
    )


class BookFolderItem(Base):
    """Folder membership independent of a book's workflow state."""

    __tablename__ = "book_folder_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    folder_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("book_folders.id", ondelete="CASCADE"), nullable=False
    )
    book_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    added_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, server_default=func.current_timestamp()
    )

    __table_args__ = (
        UniqueConstraint("folder_id", "book_id", name="uq_book_folder_items_folder_book"),
        Index("ix_book_folder_items_book_id", "book_id"),
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    version: Mapped[BookVersion] = relationship(back_populates="annotations")

    __table_args__ = (Index("ix_book_annotations_version", "version_id"),)


class SignatureArtifactRevision(Base):
    """Append-only history of a BookVersion's retained signed DOCX/PDF pair
    and every placement correction applied to it (approval-signature-
    placement plan §5).

    Revisions never overwrite: ``initial`` captures the first successful
    approval signing or manager-embedded generation that actually contains a
    manager/approver drawing; ``identify`` and ``move`` append a row per
    administrator legacy-image confirmation / per position change. The
    current active revision is ``BookVersion.signature_revision`` (0 = none
    tracked). A later signing cycle after unfile/replace starts its own
    fresh history rather than reusing a revision number.
    """

    __tablename__ = "signature_artifact_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("book_versions.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    # auto_manager | approval — which pipeline produced this artifact.
    source_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    # Original recorded signing account — never inferred from the document
    # creator or current manager-user mapping. NULL for an automatically
    # embedded manager signature with no recorded signer (admin-only to
    # correct; see signature_placement_service authorization).
    signer_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Immutable retained artifact paths (relative to data_dir). PDF is only
    # ever null for an existing generation-time DOCX-only fallback.
    docx_path: Mapped[str] = mapped_column(Text, nullable=False)
    primary_pdf_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_pdf_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Exact full published copy immediately before THIS row's correction,
    # including its then-current included papers. NULL on the initial row.
    previous_published_pdf_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    docx_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # [{signature_id, role, image_sha256, width_emu, height_emu, page, x, y,
    #   default_page, default_x, default_y}, ...] — populated once measured.
    manifest: Mapped[list[dict[str, object]]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    # initial | identify | move | reassign
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    signature_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    before_geometry: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    after_geometry: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    version: Mapped[BookVersion] = relationship()

    __table_args__ = (
        UniqueConstraint(
            "version_id", "revision", name="uq_signature_artifact_revisions_version_revision"
        ),
        Index("ix_signature_artifact_revisions_version", "version_id"),
    )


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    employee: Mapped[Employee] = relationship(back_populates="violations")
    documents: Mapped[list[Document]] = relationship(back_populates="violation")

    __table_args__ = (Index("ix_violations_employee_date", "employee_id", "date"),)


class VehicleSite(Base):
    __tablename__ = "vehicle_sites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name_ar: Mapped[str] = mapped_column(String(128), nullable=False)
    name_en: Mapped[str] = mapped_column(String(128), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    vehicles: Mapped[list[Vehicle]] = relationship(back_populates="site")


class VehiclePhotoAsset(Base):
    """Independent immutable main-photo content shared by fleet vehicles."""

    __tablename__ = "vehicle_photo_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label_ar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    label_en: Mapped[str | None] = mapped_column(String(128), nullable=True)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    original_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    thumbnail_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    preview_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    legacy_file_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    canonical_asset_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (
        UniqueConstraint("content_hash", name="uq_vehicle_photo_assets_content_hash"),
        UniqueConstraint("legacy_file_id", name="uq_vehicle_photo_assets_legacy_file_id"),
    )


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plate_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    plate_number: Mapped[str] = mapped_column(String(16), nullable=False)
    traffic_code: Mapped[str] = mapped_column(String(16), nullable=False)
    type_ar: Mapped[str] = mapped_column(String(128), nullable=False)
    type_en: Mapped[str] = mapped_column(String(128), nullable=False)
    class_ar: Mapped[str] = mapped_column(String(64), nullable=False)
    class_en: Mapped[str] = mapped_column(String(64), nullable=False)
    vin: Mapped[str | None] = mapped_column(String(32), nullable=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("vehicle_sites.id"), nullable=False)
    contract_note_ar: Mapped[str | None] = mapped_column(Text, nullable=True)
    contract_note_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    license_start: Mapped[date] = mapped_column(Date, nullable=False)
    license_expiry: Mapped[date] = mapped_column(Date, nullable=False)
    # File and photo-asset foreign keys are enforced by the vehicle service to
    # avoid circular table dependencies and SQLite batch-ALTER constraints.
    photo_asset_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    license_file_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    make: Mapped[str | None] = mapped_column(String(128), nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    model_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    colour: Mapped[str | None] = mapped_column(String(64), nullable=True)
    insurance_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    inmate_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    passenger_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    accessories_ar: Mapped[str | None] = mapped_column(Text, nullable=True)
    accessories_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes_ar: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    insurance_reminder_sent_for: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_reminder_sent_for: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    _list_fines_count: Mapped[int | None] = query_expression()
    _list_fines_amount_fils: Mapped[int | None] = query_expression()
    _list_black_points: Mapped[int | None] = query_expression()

    site: Mapped[VehicleSite] = relationship(back_populates="vehicles")
    photo_asset: Mapped[VehiclePhotoAsset | None] = relationship(
        primaryjoin=lambda: foreign(Vehicle.photo_asset_id) == VehiclePhotoAsset.id,
        viewonly=True,
    )
    files: Mapped[list[VehicleFile]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )
    renewals: Mapped[list[VehicleLicenseRenewal]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )
    fines: Mapped[list[VehicleFine]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )
    accidents: Mapped[list[VehicleAccident]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )
    maintenance: Mapped[list[VehicleMaintenance]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )
    maintenance_requests: Mapped[list[VehicleMaintenanceRequest]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )
    odometer_readings: Mapped[list[VehicleOdometerReading]] = relationship(
        back_populates="vehicle", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("uq_vehicles_plate", "plate_code", "plate_number", unique=True),
        Index(
            "uq_vehicles_plate_without_code",
            "plate_number",
            unique=True,
            sqlite_where=text("plate_code IS NULL"),
        ),
        Index("ix_vehicles_site", "site_id"),
        Index("ix_vehicles_photo_asset", "photo_asset_id"),
        Index("ix_vehicles_plate_number", "plate_number"),
    )


class VehicleFile(Base):
    __tablename__ = "vehicle_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    label_ar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    label_en: Mapped[str | None] = mapped_column(String(128), nullable=True)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str] = mapped_column(String(64), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    # Certificate-only metadata (migration 0090). Every other kind leaves these
    # NULL/false; the certificate service path is the only writer.
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_reminder_sent_for: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_historical: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Points from a superseded certificate to the row that replaced it. No SQL
    # foreign key: same-vehicle/certificate ownership is enforced in the
    # service layer, mirroring `Vehicle.photo_asset_id`/`license_file_id`.
    superseded_by_file_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    vehicle: Mapped[Vehicle] = relationship(back_populates="files")

    __table_args__ = (Index("ix_vehicle_files_vehicle", "vehicle_id"),)


class VehicleLicenseRenewal(Base):
    __tablename__ = "vehicle_license_renewals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False
    )
    start: Mapped[date] = mapped_column(Date, nullable=False)
    expiry: Mapped[date] = mapped_column(Date, nullable=False)
    renewed_on: Mapped[date] = mapped_column(Date, nullable=False)
    cost: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scan_file_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    vehicle: Mapped[Vehicle] = relationship(back_populates="renewals")

    __table_args__ = (Index("ix_vehicle_license_renewals_vehicle", "vehicle_id"),)


class VehicleFine(Base):
    __tablename__ = "vehicle_fines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False
    )
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    time: Mapped[str | None] = mapped_column(String(8), nullable=True)
    amount_fils: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_after_discount_fils: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_points: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    source: Mapped[str] = mapped_column(
        String(8), nullable=False, default="manual", server_default="manual"
    )
    evg_ticket_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    fine_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payment_status: Mapped[str] = mapped_column(
        String(8), nullable=False, default="unpaid", server_default="unpaid"
    )
    receipt_file_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    vehicle: Mapped[Vehicle] = relationship(back_populates="fines")
    employee: Mapped[Employee | None] = relationship()

    __table_args__ = (
        Index("uq_vehicle_fines_evg_ticket", "evg_ticket_no", unique=True),
        Index("ix_vehicle_fines_vehicle_date", "vehicle_id", "date"),
    )


class VehicleAccident(Base):
    __tablename__ = "vehicle_accidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False
    )
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    # A report is written in the operator's language; the Arabic halves are
    # what the official letter prints, asked for when the letter is issued.
    location_ar: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_ar: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    police_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Kept for reports filed before migration 0120; insurance covers the
    # damage and the technician estimates it, so nothing writes it any more.
    damage_cost: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Optional insurance claim, recorded at filing or later.
    claim_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claim_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    insurer: Mapped[str | None] = mapped_column(String(128), nullable=True)
    repair_garage: Mapped[str | None] = mapped_column(String(128), nullable=True)
    cost_payer: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(
        String(8), nullable=False, default="open", server_default="open"
    )
    photo_file_ids: Mapped[list[int]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    letter_book_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    vehicle: Mapped[Vehicle] = relationship(back_populates="accidents")
    employee: Mapped[Employee | None] = relationship()

    __table_args__ = (
        Index("ix_vehicle_accidents_vehicle", "vehicle_id"),
        CheckConstraint(
            "claim_status IS NULL OR claim_status IN "
            "('not_submitted', 'submitted', 'under_repair', 'settled')",
            name="ck_vehicle_accidents_claim_status",
        ),
        CheckConstraint(
            "cost_payer IS NULL OR cost_payer IN ('insurer', 'company', 'driver')",
            name="ck_vehicle_accidents_cost_payer",
        ),
    )


class VehicleMaintenance(Base):
    __tablename__ = "vehicle_maintenance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    odometer_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    vendor_ar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    vendor_en: Mapped[str | None] = mapped_column(String(128), nullable=True)
    next_due: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    receipt_file_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reminder_sent_for: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    vehicle: Mapped[Vehicle] = relationship(back_populates="maintenance")

    __table_args__ = (Index("ix_vehicle_maintenance_vehicle", "vehicle_id"),)


class VehicleMaintenanceRequest(Base):
    __tablename__ = "vehicle_maintenance_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False
    )
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    odometer_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Cross-workflow links are service-owned, like VehicleAccident.letter_book_id.
    book_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(
        String(8), nullable=False, default="open", server_default="open"
    )
    maintenance_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    vehicle: Mapped[Vehicle] = relationship(back_populates="maintenance_requests")

    __table_args__ = (
        CheckConstraint(
            "type IN ('service', 'repair', 'tires', 'other')",
            name="ck_vehicle_maintenance_requests_type",
        ),
        CheckConstraint(
            "status IN ('open', 'done')", name="ck_vehicle_maintenance_requests_status"
        ),
        Index("ix_vehicle_maintenance_requests_vehicle_status", "vehicle_id", "status"),
    )


class VehicleOdometerReading(Base):
    __tablename__ = "vehicle_odometer_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False
    )
    month: Mapped[str] = mapped_column(String(7), nullable=False)
    opening_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    closing_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    vehicle: Mapped[Vehicle] = relationship(back_populates="odometer_readings")

    __table_args__ = (
        CheckConstraint(
            "closing_km IS NULL OR closing_km >= 0",
            name="ck_vehicle_odometer_closing_nonnegative",
        ),
        CheckConstraint(
            "opening_km IS NULL OR opening_km >= 0",
            name="ck_vehicle_odometer_opening_nonnegative",
        ),
        CheckConstraint(
            "opening_km IS NOT NULL OR closing_km IS NOT NULL",
            name="ck_vehicle_odometer_has_reading",
        ),
        UniqueConstraint("vehicle_id", "month", name="uq_vehicle_odometer_month"),
    )


class Permit(Base):
    """A security-zone entry permit — greenfield feature (2026-07).

    Authorizes a company's personnel to enter the green and/or red security
    zone for a defined window. Unrelated to the ``permissions``/RBAC tables
    (those are app-access capabilities); this tracks *physical* access permits.

    The lifecycle status stored here is only ``active`` / ``revoked``. Whether
    a permit is *expired* is derived from ``end_date`` vs. today at read time
    (no nightly job needed), so the register never shows a stale "active" row
    for a permit whose end date has passed.
    """

    __tablename__ = "permits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Human-readable reference, stamped after insert as ``PMT-0001``.
    permit_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    company: Mapped[str] = mapped_column(String(255))
    # One or more of 'green' | 'red' | 'work_residence' — validated in the
    # Pydantic schema. Stored as a JSON array (SQLite TEXT).
    zones: Mapped[list[str]] = mapped_column(JSON, default=list)
    access_areas: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    start_date: Mapped[date] = mapped_column(Date)
    validity_value: Mapped[int] = mapped_column(Integer)
    validity_unit: Mapped[str] = mapped_column(String(8))
    end_date: Mapped[date] = mapped_column(Date)
    # 'active' | 'revoked'. Expiry is derived from end_date, never stored.
    status: Mapped[str] = mapped_column(String(16), default="active")
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Scan of the issued paper permit (relative to the data dir). Optional.
    document_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    book_id: Mapped[int | None] = mapped_column(Integer)
    manager_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    people: Mapped[list[PermitPerson]] = relationship(
        back_populates="permit",
        cascade="all, delete-orphan",
        order_by="PermitPerson.id",
    )
    vehicles: Mapped[list[PermitVehicle]] = relationship(
        back_populates="permit",
        cascade="all, delete-orphan",
        order_by="PermitVehicle.id",
    )
    visits: Mapped[list[PermitVisit]] = relationship(
        back_populates="permit",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            "validity_unit IN ('day', 'week', 'month', 'year')",
            name="ck_permits_validity_unit",
        ),
        Index("ix_permits_status_end", "status", "end_date"),
        Index("ix_permits_company", "company"),
        Index(
            "ux_permits_permit_no",
            "permit_no",
            unique=True,
            sqlite_where=text("permit_no IS NOT NULL AND deleted_at IS NULL"),
        ),
    )


class PermitPerson(Base):
    """One person authorized on a permit — an external contractor, not a staff
    member, so identity is free-text (name + optional UAE ID / nationality /
    trade). Soft-removed via ``removed_at`` so amendment history is preserved
    and the live head-count only counts rows where ``removed_at IS NULL``.
    """

    __tablename__ = "permit_people"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    permit_id: Mapped[int] = mapped_column(ForeignKey("permits.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    uae_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    nationality: Mapped[str | None] = mapped_column(String(64), nullable=True)
    role: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Scan of the person's UAE ID card (relative to the data dir). Optional.
    id_doc_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    permit: Mapped[Permit] = relationship(back_populates="people")

    __table_args__ = (Index("ix_permit_people_permit", "permit_id"),)


class PermitVehicle(Base):
    """A vehicle authorized on a permit — plate + optional make/model/driver,
    with an optional scan of the vehicle licence (mulkiya). Soft-removed via
    ``removed_at`` like people, so the live vehicle count and amendment history
    stay correct.
    """

    __tablename__ = "permit_vehicles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    permit_id: Mapped[int] = mapped_column(ForeignKey("permits.id", ondelete="CASCADE"))
    # Optional so a vehicle can be added from its licence scan (OCR fills it).
    plate_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    plate_emirate: Mapped[str | None] = mapped_column(String(32), nullable=True)
    make_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    driver_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Scan of the vehicle licence / mulkiya (relative to the data dir). Optional.
    license_doc_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    colour: Mapped[str | None] = mapped_column(String(32))
    vehicle_type: Mapped[str | None] = mapped_column(String(64))
    plate_category: Mapped[str | None] = mapped_column(String(32))
    traffic_no: Mapped[str | None] = mapped_column(String(32))
    reg_expiry: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    permit: Mapped[Permit] = relationship(back_populates="vehicles")

    __table_args__ = (Index("ix_permit_vehicles_permit", "permit_id"),)


class PermitVisit(Base):
    """A single gate crossing under a permit — the forward hook for a future
    gate / UAE-ID scanner integration. No manual-entry UI ships in v1; rows are
    written by the ``POST /permits/{id}/visits`` endpoint so a gate system can
    drop straight in later without a schema change.
    """

    __tablename__ = "permit_visits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    permit_id: Mapped[int] = mapped_column(ForeignKey("permits.id", ondelete="CASCADE"))
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("permit_people.id", ondelete="SET NULL"), nullable=True
    )
    # 'in' | 'out'
    direction: Mapped[str] = mapped_column(String(4), default="in")
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    uae_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    gate: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 'manual' | 'gate' — how the visit reached us.
    source: Mapped[str] = mapped_column(String(16), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    permit: Mapped[Permit] = relationship(back_populates="visits")

    __table_args__ = (Index("ix_permit_visits_permit_occurred", "permit_id", "occurred_at"),)


class ItemPermit(Base):
    """An item-entry permit (إدخال مواد) — a 1/5 letter authorizing materials
    into a facility zone, naming the employee who brings them. Shares the
    Security Permit paper and book approval chain; no validity window.
    """

    __tablename__ = "item_permits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(String(16), ForeignKey("employees.id"))
    recipient: Mapped[str] = mapped_column(String(255))
    # ordered, distinct subset of 'red' | 'green' | 'work_residence' (min 1)
    zones: Mapped[list[str]] = mapped_column(JSON)
    site: Mapped[str] = mapped_column(String(255))
    # list of {"name": str, "quantity": int}
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    manager_id: Mapped[int | None] = mapped_column(Integer)
    book_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    employee: Mapped[Employee] = relationship()

    __table_args__ = (Index("ix_item_permits_employee", "employee_id"),)


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Full rendered SMS text (added 0047). Nullable: historical rows predate it.
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Gateway delivery outcome (added 0049). NULL until first polled.
    # Recipient state: Delivered | Failed | Pending | Processed | Sent.
    # Distinct from ``status`` (send-time accept/fail) — see the delivery poller.
    delivery_state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    delivery_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (Index("ix_sms_messages_event", "event_type", "event_ref"),)


class OutboundMessage(Base):
    """One row per outbound notification attempt across all channels.

    Unifies the retired sms_messages / whatsapp_messages logs. ``channel`` is the
    channel actually used; NULL when the attempt failed before routing (no phone).
    ``status`` is queued|sent|failed|skipped; ``skipped`` (with ``skip_reason``
    default_off|user_off) logs an automatic send suppressed by the event default
    or the operator's switch, and is terminal like ``sent``. ``delivery_state`` is
    the channel's own delivery outcome (WhatsApp: sent|delivered|read|failed; SMS:
    Pending|Delivered|Failed). ``fell_back``/``fallback_reason`` record a WhatsApp→SMS
    downgrade.
    ``attempts``/``next_retry_at`` drive the bounded WhatsApp retry queue.
    """

    __tablename__ = "outbound_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(String(16), ForeignKey("employees.id"))
    event_type: Mapped[str] = mapped_column(String(32))
    event_ref: Mapped[str] = mapped_column(String(64))
    language: Mapped[str] = mapped_column(String(2))
    phone: Mapped[str] = mapped_column(String(32))
    channel: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    delivery_state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    delivery_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fell_back: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    fallback_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    provider_msg_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    skip_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sent_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (
        Index("ix_outbound_messages_event", "event_type", "event_ref"),
        Index("ix_outbound_messages_retry", "status", "next_retry_at"),
    )


class DutySupervisor(Base):
    """Maps a (free-text) duty_unit to a recipient designation (duty_post).

    Supervisors are resolved at send time from these designations, never
    pinned to a specific person — moving staff around the roster never breaks
    routing. A unit may have several rows (several recipient designations).
    """

    __tablename__ = "duty_supervisors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    duty_unit: Mapped[str] = mapped_column(String(128))
    recipient_duty_post: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (
        Index("ux_duty_supervisors_unit_post", "duty_unit", "recipient_duty_post", unique=True),
    )


class GroupAnnouncement(Base):
    """One compose action: a message (± attachment) posted to N WhatsApp groups."""

    __tablename__ = "group_announcements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_kind: Mapped[str] = mapped_column(String(16), default="none", server_default="none")
    attachment_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    book_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sent_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class GroupAnnouncementSend(Base):
    """One row per target group for a GroupAnnouncement (WhatsApp only)."""

    __tablename__ = "group_announcement_sends"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    announcement_id: Mapped[int] = mapped_column(Integer)  # FK omitted (app-side integrity)
    group_id: Mapped[str] = mapped_column(String(64))
    group_name: Mapped[str] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(16))  # 'sent' | 'failed'
    provider_msg_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (Index("ix_group_announcement_sends_ann", "announcement_id"),)


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("name", name="uq_general_book_recipients_name"),)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)  # JSON-encoded payload


class UserDashboardLayout(Base):
    """A user's private dashboard widget and quick-action arrangement."""

    __tablename__ = "user_dashboard_layouts"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    layout: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.current_timestamp(),
        nullable=False,
    )


class VaultFile(Base):
    __tablename__ = "vault_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"))
    kind: Mapped[str] = mapped_column(String(32))
    filename: Mapped[str] = mapped_column(String(256))
    path: Mapped[str] = mapped_column(Text)  # relative to vault root
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

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
    docx_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    pdf_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Private immutable generated form used to rebuild Included papers packages.
    # The normal ``pdf_path`` remains the published combined output.
    base_pdf_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
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
    drafts_folder: Mapped[str] = mapped_column(
        String(64), nullable=False, default="Drafts", server_default="Drafts"
    )
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

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
    # Request-scoped capability memo, deliberately not mapped or persisted.
    # The attribute is populated lazily by perm_service.effective_caps.
    __allow_unmapped__ = True
    _effective_caps_cache: frozenset[str] | None

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(256), nullable=False)  # stored lowercased
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    # True until the account owner replaces an admin-issued temporary
    # password (migration 0093). Blocks session creation and DAV access.
    password_change_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
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
    # The approving account an administrator assigns to a fleet reporter
    # (migration 0120); not the org-tree supervisor. Their papers route here.
    line_manager_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Lock-screen idle timeout; one of 30/60/120/300/900/1800 (enforced at the API edge).
    idle_lock_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1800, server_default="1800"
    )
    # Lock-screen layout choice; one of band/stack/console (enforced at the API edge).
    lock_layout: Mapped[str] = mapped_column(
        String(16), nullable=False, default="band", server_default="band"
    )
    # operator | manager | admin | inmate_reporter | fleet_reporter — stored
    # (admin-assigned), authoritative for auth. inmate_reporter and
    # fleet_reporter are scoped roles with a fixed capability ceiling (see
    # core.scoped_roles) bound to one admin-linked G number; employee identity
    # links are assigned only by administrators.
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
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
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

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
        DateTime, default=utcnow, server_default=func.current_timestamp()
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
        DateTime, default=utcnow, server_default=func.current_timestamp()
    )
    source: Mapped[str] = mapped_column(
        String(32)
    )  # email_attachment | upload | scan_back | batch | email_reply_match
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
    candidates: Mapped[list[object] | None] = mapped_column(JSON, default=list)
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
        DateTime, default=utcnow, server_default=func.current_timestamp()
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
        DateTime, default=utcnow, server_default=func.current_timestamp()
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
        DateTime, default=utcnow, server_default=func.current_timestamp()
    )
    decided_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_permission_requests_user_id", "user_id"),
        Index("ix_permission_requests_status", "status"),
    )


class LedgerFlag(Base):
    """Per-user follow-up flag on a ledger entry (migration 0054).

    Flags are PER-USER (one row per ``(user_id, entry_id)``) so each person
    flags independently in the private inbox — not a column on
    ``LedgerEntry`` (which would be shared). ``followup_due`` is the optional
    follow-up date; ``flagged_at`` is when the flag was (re)set. Upserted by
    ``ledger_service.set_flag``; deleted by ``clear_flag``.
    """

    __tablename__ = "ledger_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    entry_id: Mapped[int] = mapped_column(
        ForeignKey("ledger_entries.id", ondelete="CASCADE"), nullable=False
    )
    flagged_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    followup_due: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, server_default=func.current_timestamp()
    )

    __table_args__ = (
        UniqueConstraint("user_id", "entry_id", name="uq_ledger_flags_user_entry"),
        Index("ix_ledger_flags_user_id", "user_id"),
        Index("ix_ledger_flags_entry_id", "entry_id"),
    )


class SmartFolder(Base):
    """A per-user saved subject filter for the Ledger (migration 0055).

    A smart folder is NOT a container — it has no membership. Selecting it
    filters the ledger list by ``LOWER(subject) LIKE '%'||rule_value||'%'``.
    ``rule_value`` is the normalised subject (see ``core.subject``);
    ``rule_kind`` is ``'subject'`` in v1. Per-user (``owner_user_id``) so each
    person curates their own folders in the private inbox. Soft-deleted via
    ``deleted_at``.
    """

    __tablename__ = "smart_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name_en: Mapped[str] = mapped_column(String(128), nullable=False)
    name_ar: Mapped[str] = mapped_column(String(128), nullable=False)
    rule_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    rule_value: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, server_default=func.current_timestamp()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (Index("ix_smart_folders_owner_user_id", "owner_user_id"),)


class SmartFolderDismissal(Base):
    """A per-user dismissal of a smart-folder suggestion (migration 0055).

    Records that ``owner_user_id`` dismissed the cluster keyed by
    ``cluster_key`` (a normalised subject) so the suggestion engine never
    re-offers it to that user. Per-user so one person's dismissal doesn't hide a
    suggestion from another.
    """

    __tablename__ = "smart_folder_dismissals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    cluster_key: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, server_default=func.current_timestamp()
    )

    __table_args__ = (
        UniqueConstraint(
            "owner_user_id", "cluster_key", name="uq_smart_folder_dismissals_owner_cluster"
        ),
        Index("ix_smart_folder_dismissals_owner_user_id", "owner_user_id"),
    )


class TimesheetDesignation(Base):
    """One printable designation for the monthly time sheet (migration 0070).

    The catalog carries both languages because the two deliverables differ only
    in this column: the HR attendance sheet prints ``name_en``, the client
    statistics prints ``name_ar``. ``rank_order`` is the client-visible sort —
    they asked for the roster grouped by rank — and ``sheet`` routes drivers to
    their own workbook, which is how the site has always reported them.
    """

    __tablename__ = "timesheet_designations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name_en: Mapped[str] = mapped_column(String(128), nullable=False)
    name_ar: Mapped[str] = mapped_column(String(128), nullable=False)
    system_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rank_order: Mapped[int] = mapped_column(Integer, nullable=False)
    sheet: Mapped[str] = mapped_column(String(16), default="main", server_default="main")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("1"))

    __table_args__ = (
        UniqueConstraint("name_en", name="uq_timesheet_designations_name_en"),
        UniqueConstraint("rank_order", name="uq_timesheet_designations_rank"),
        Index("ux_timesheet_designations_system_key", "system_key", unique=True),
        CheckConstraint("sheet IN ('main', 'drivers')", name="ck_timesheet_desig_sheet"),
    )


class TimesheetRosterAssignment(Base):
    """An employee's effective-dated time-sheet designation (migration 0077)."""

    __tablename__ = "timesheet_roster_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    designation_id: Mapped[int | None] = mapped_column(
        ForeignKey("timesheet_designations.id"), nullable=True
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, server_default=func.current_timestamp()
    )
    assigned_by: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "employee_id", "effective_from", name="uq_timesheet_roster_assignment_effective"
        ),
        Index("ix_timesheet_roster_assignment_effective", "effective_from"),
    )


class Absence(Base):
    """One day an employee was absent without leave (migration 0070).

    Absence is the only time-sheet code with no other source in this database,
    so it is recorded here as fact rather than as a sheet-local scribble: it
    belongs on the employee's record. One row per day, because that is how it is
    marked and un-marked in the grid. A leave covering the same day supersedes
    the absence and the row is removed — the employee produced a certificate.
    """

    __tablename__ = "absences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, server_default=func.current_timestamp()
    )

    __table_args__ = (
        UniqueConstraint("employee_id", "date", name="uq_absences_employee_date"),
        Index("ix_absences_date", "date"),
    )


class EmployeeStatementPrint(Base):
    """One issued employee-file statement print (migration 0115).

    ``serial`` is a running number per employee shared by Activity and
    Attendance prints; the printed reference is ``<employee id>/1/12/<serial>``.
    ``options`` is the setup as printed, serialized JSON.
    """

    __tablename__ = "employee_statement_prints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(
        String(16), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    serial: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    from_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    to_date: Mapped[date] = mapped_column(Date, nullable=False)
    language: Mapped[str] = mapped_column(String(2), nullable=False)
    options: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    printed_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    printed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (
        UniqueConstraint("employee_id", "serial", name="uq_employee_statement_prints_serial"),
        Index("ix_employee_statement_prints_employee_id", "employee_id"),
    )


class TimesheetPeriod(Base):
    """One time-sheet month (migration 0070).

    ``post_count`` is the contracted number of manned posts and drives the
    statistics split; it is per-month because contract amendments move it.
    ``closed_at`` is set by the first download: the sheet goes to HQ HR and to
    the client, so a later re-download must reproduce it rather than silently
    absorb a leave recorded afterwards.
    """

    __tablename__ = "timesheet_periods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    post_count: Mapped[int] = mapped_column(Integer, default=249, server_default="249")
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reopened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reopened_by: Mapped[int | None] = mapped_column(Integer, nullable=True)

    snapshot_rows: Mapped[list[TimesheetSnapshotRow]] = relationship(
        back_populates="period", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("year", "month", name="uq_timesheet_periods_year_month"),
        CheckConstraint("month BETWEEN 1 AND 12", name="ck_timesheet_periods_month"),
        CheckConstraint("post_count >= 0", name="ck_timesheet_periods_post_count"),
    )


class TimesheetOverride(Base):
    """A manually forced cell in an open time-sheet month (migration 0070).

    The escape hatch for the days the records get wrong — a leave whose end date
    slipped, a reserve-duty stint nobody filed a form for. Absence is NOT stored
    here; it gets a real :class:`Absence` row.
    """

    __tablename__ = "timesheet_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    day: Mapped[int] = mapped_column(Integer, nullable=False)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(4), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, server_default=func.current_timestamp()
    )

    __table_args__ = (
        UniqueConstraint("year", "month", "day", "employee_id", name="uq_timesheet_overrides_cell"),
        CheckConstraint("month BETWEEN 1 AND 12", name="ck_timesheet_overrides_month"),
        CheckConstraint("day BETWEEN 1 AND 31", name="ck_timesheet_overrides_day"),
    )


class TimesheetSnapshotRow(Base):
    """One frozen printed row of a closed time-sheet month (migration 0070).

    Names, nationality and both designations are resolved at close and stored,
    so renaming a designation or correcting a spelling next year cannot alter a
    sheet the client already holds. ``employee_id`` is deliberately not a
    foreign key: the snapshot must outlive the employee record.
    """

    __tablename__ = "timesheet_snapshot_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    period_id: Mapped[int] = mapped_column(
        ForeignKey("timesheet_periods.id", ondelete="CASCADE"), nullable=False
    )
    employee_id: Mapped[str] = mapped_column(String(16), nullable=False)
    row_no: Mapped[int] = mapped_column(Integer, nullable=False)
    name_en: Mapped[str] = mapped_column(String(256), nullable=False)
    nationality_en: Mapped[str | None] = mapped_column(String(64), nullable=True)
    designation_en: Mapped[str | None] = mapped_column(String(128), nullable=True)
    designation_ar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    rank_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sheet: Mapped[str] = mapped_column(String(16), default="main", server_default="main")
    codes: Mapped[list[str | None]] = mapped_column(JSON, nullable=False)
    stat_codes: Mapped[list[str | None]] = mapped_column(JSON, nullable=False)
    stat_block: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    period: Mapped[TimesheetPeriod] = relationship(back_populates="snapshot_rows")

    __table_args__ = (
        UniqueConstraint("period_id", "employee_id", "sheet", name="uq_timesheet_snapshot_row"),
        Index("ix_timesheet_snapshot_period_sheet", "period_id", "sheet"),
    )


class TimesheetStatFiller(Base):
    """The code block 2 shows for one employee in one month (migration 0075).

    Block 2 is the surplus headcount above the contracted post count. Those rows
    are not billed as manned posts, so the client statistics sheet prints the
    code the operator assigned instead of ``P``. The assignment is per employee
    per month and carries forward: a month with no row inherits the most recent
    earlier one, so the operator sets the shape once rather than every month.
    """

    __tablename__ = "timesheet_stat_fillers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(4), nullable=False)

    __table_args__ = (
        UniqueConstraint("year", "month", "employee_id", name="uq_timesheet_stat_filler"),
        CheckConstraint("month BETWEEN 1 AND 12", name="ck_timesheet_stat_filler_month"),
    )


class TimesheetStartAck(Base):
    """An operator acknowledgement of a mid-month joiner's start (migration 0076).

    The days before a date of joining are ``NG`` and stay derived; this row only
    records that the flag was seen and accepted. It is deliberately not an
    override — a wrong date of joining is fixed on the employee record — and
    deliberately unconnected to :class:`TimesheetPeriod`, because the
    acknowledgement is still allowed once the month is closed. That is why the
    flag is recomputed from this table rather than frozen into the snapshot.
    ``employee_id`` carries no foreign key, like :class:`TimesheetSnapshotRow`:
    what the operator accepted must outlive the employee record.
    """

    __tablename__ = "timesheet_start_acks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    employee_id: Mapped[str] = mapped_column(String(16), nullable=False)
    acked_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    acked_by: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint("year", "month", "employee_id", name="uq_timesheet_start_ack"),
        CheckConstraint("month BETWEEN 1 AND 12", name="ck_timesheet_start_ack_month"),
    )


class InmateViolationPeriod(Base):
    """One closed inmate-conduct register month (migration 0085).

    A row exists only after the month is closed. The close freezes the register
    rows and workbook path so later record corrections cannot silently alter
    the copy already filed. ``closed_by`` and reopen audit fields deliberately
    carry no foreign keys, mirroring :class:`TimesheetPeriod`.
    """

    __tablename__ = "inmate_violation_periods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reopened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reopened_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Read-only history: a month forced closed before the approval workflow.
    force_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    export_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rows: Mapped[list[InmateViolationStatRow]] = relationship(
        back_populates="period", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("year", "month", name="uq_inmate_violation_periods_month"),
        CheckConstraint("month BETWEEN 1 AND 12", name="ck_inmate_violation_periods_month"),
        CheckConstraint("year BETWEEN 2000 AND 2100", name="ck_inmate_violation_periods_year"),
    )


class InmateViolationWorkflow(Base):
    """Approval state for one register month (migration 0088).

    ``content_hash`` fingerprints the projection that was prepared, so final
    approval can prove the rows it seals are exactly the reviewed ones without
    storing a second copy of them. ``actors`` holds the accepted
    prepared/reviewed/approved facts as immutable snapshots — an archived
    signature must not follow a later account or employee edit.
    """

    __tablename__ = "inmate_violation_workflows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    state: Mapped[str] = mapped_column(
        String(24), nullable=False, default="draft", server_default="draft"
    )
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Selected at handoff, paired with the employee ID captured then.
    reviewer_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewer_employee_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    manager_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    manager_employee_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    #: ``{stage: {user_id, name_ar, employee_id, acted_at}}`` for the stages
    #: actually performed in the current cycle. Cleared when a cycle restarts.
    actors: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("year", "month", name="uq_inmate_violation_workflows_month"),
        CheckConstraint("month BETWEEN 1 AND 12", name="ck_inmate_violation_workflows_month"),
        CheckConstraint("year BETWEEN 2000 AND 2100", name="ck_inmate_violation_workflows_year"),
        CheckConstraint("version >= 0", name="ck_inmate_violation_workflows_version"),
        CheckConstraint(
            "state IN ('draft','awaiting_review','awaiting_manager','closed')",
            name="ck_inmate_violation_workflows_state",
        ),
        Index("ix_inmate_violation_workflows_reviewer", "reviewer_user_id"),
        Index("ix_inmate_violation_workflows_manager", "manager_user_id"),
    )


class InmateViolationStatRow(Base):
    """One frozen inmate line from a closed conduct register (migration 0085).

    Names, nationality, duty unit, details and reporter are resolved at close
    and stored. Source identifiers deliberately carry no foreign keys: the
    snapshot and its provenance must outlive the Record that produced it.
    """

    __tablename__ = "inmate_violation_stat_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    period_id: Mapped[int] = mapped_column(
        ForeignKey("inmate_violation_periods.id", ondelete="CASCADE"), nullable=False
    )
    row_handle: Mapped[str] = mapped_column(String(64), nullable=False)
    origin: Mapped[str] = mapped_column(String(8), nullable=False)
    row_no: Mapped[int] = mapped_column(Integer, nullable=False)
    population: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    uid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nationality_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nationality_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    violation_date: Mapped[date] = mapped_column(Date, nullable=False)
    duty_unit: Mapped[str | None] = mapped_column(String(120), nullable=True)
    details_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    wing: Mapped[str | None] = mapped_column(String(8), nullable=True)
    holding_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reporter_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    reporter_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    source_book_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_version_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_row_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_ref_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    incomplete_marks: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    manual_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    manual_created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    manual_created_by_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    manual_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    period: Mapped[InmateViolationPeriod] = relationship(back_populates="rows")

    __table_args__ = (
        UniqueConstraint("period_id", "row_handle", name="uq_inmate_violation_stat_rows_handle"),
        CheckConstraint(
            "origin IN ('derived','manual')", name="ck_inmate_violation_stat_rows_origin"
        ),
        CheckConstraint(
            "population IN ('citizens','expats','pending')",
            name="ck_inmate_violation_stat_rows_population",
        ),
        Index("ix_inmate_violation_stat_rows_period_id", "period_id"),
    )


class InmateViolationManualRow(Base):
    """A manually supplied inmate line in an open register month (migration 0085).

    The overlay is keyed directly by year and month rather than a period:
    periods exist only for closed months. Closing copies each manual line into
    the frozen snapshot together with its reason and creator audit fields.
    """

    __tablename__ = "inmate_violation_manual_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    violation_date: Mapped[date] = mapped_column(Date, nullable=False)
    uid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nationality_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    wing: Mapped[str | None] = mapped_column(String(8), nullable=True)
    holding_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reporter_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    details_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, server_default=func.current_timestamp()
    )
    updated_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_inmate_violation_manual_rows_month", "year", "month"),
        CheckConstraint("month BETWEEN 1 AND 12", name="ck_inmate_violation_manual_rows_month"),
    )


class StoreCategory(Base):
    """A Store item category (migration 0111); seeded Pantry and Protective."""

    __tablename__ = "store_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name_en: Mapped[str] = mapped_column(String(128), nullable=False)
    name_ar: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (UniqueConstraint("name_en", name="uq_store_categories_name_en"),)


class StoreItem(Base):
    """One kind of material the Store holds (migration 0111).

    Quantities of the item are integers in base units: loose units when
    ``contains_qty`` is set, otherwise Counting units. Items are archived,
    never deleted, so an Item code is never reused.
    """

    __tablename__ = "store_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False)
    name_en: Mapped[str] = mapped_column(String(255), nullable=False)
    name_ar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("store_categories.id"), nullable=False)
    counting_unit_en: Mapped[str] = mapped_column(String(64), nullable=False)
    counting_unit_ar: Mapped[str] = mapped_column(String(64), nullable=False)
    contains_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    contains_unit_en: Mapped[str | None] = mapped_column(String(64), nullable=True)
    contains_unit_ar: Mapped[str | None] = mapped_column(String(64), nullable=True)
    minimum_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    art_kind: Mapped[str | None] = mapped_column(String(24), nullable=True)
    art_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    brand_label: Mapped[str | None] = mapped_column(String(40), nullable=True)
    generic_label_en: Mapped[str | None] = mapped_column(String(32), nullable=True)
    generic_label_ar: Mapped[str | None] = mapped_column(String(32), nullable=True)
    short_name_en: Mapped[str | None] = mapped_column(String(128), nullable=True)
    short_name_ar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pack_description_en: Mapped[str | None] = mapped_column(String(160), nullable=True)
    pack_description_ar: Mapped[str | None] = mapped_column(String(160), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    category: Mapped[StoreCategory] = relationship()
    batches: Mapped[list[StoreBatch]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("code", name="uq_store_items_code"),
        CheckConstraint(
            "contains_qty IS NULL OR contains_qty >= 2", name="ck_store_items_contains_qty"
        ),
        CheckConstraint(
            "(contains_qty IS NULL AND contains_unit_en IS NULL AND contains_unit_ar IS NULL)"
            " OR (contains_qty IS NOT NULL AND contains_unit_en IS NOT NULL"
            " AND contains_unit_ar IS NOT NULL)",
            name="ck_store_items_contains_together",
        ),
        CheckConstraint(
            "minimum_level IS NULL OR minimum_level >= 0", name="ck_store_items_minimum_level"
        ),
        Index("ix_store_items_category", "category_id"),
    )


class StoreBatch(Base):
    """All of one Store item sharing one expiry date (migration 0111).

    A null ``expiry_date`` is the item's single undated Batch. A month-only
    expiry is stored as that month's last day with ``expiry_month_only``.
    """

    __tablename__ = "store_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(
        ForeignKey("store_items.id", ondelete="CASCADE"), nullable=False
    )
    expiry_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    expiry_month_only: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    item: Mapped[StoreItem] = relationship(back_populates="batches")

    __table_args__ = (
        Index(
            "uq_store_batches_item_expiry",
            "item_id",
            "expiry_date",
            unique=True,
            sqlite_where=text("expiry_date IS NOT NULL"),
        ),
        Index(
            "uq_store_batches_item_undated",
            "item_id",
            unique=True,
            sqlite_where=text("expiry_date IS NULL"),
        ),
    )


class StoreDelivery(Base):
    """One Monthly delivery from HQ (migration 0111), optionally with its note file."""

    __tablename__ = "store_deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    received_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    note_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    note_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note_file_media_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    note_file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    lines: Mapped[list[StoreDeliveryLine]] = relationship(
        back_populates="delivery", cascade="all, delete-orphan", order_by="StoreDeliveryLine.id"
    )

    __table_args__ = (Index("ix_store_deliveries_received_on", "received_on"),)


class StoreDeliveryLine(Base):
    __tablename__ = "store_delivery_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    delivery_id: Mapped[int] = mapped_column(
        ForeignKey("store_deliveries.id", ondelete="CASCADE"), nullable=False
    )
    batch_id: Mapped[int] = mapped_column(ForeignKey("store_batches.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    carton_contains_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    noted_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    difference_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)

    delivery: Mapped[StoreDelivery] = relationship(back_populates="lines")
    batch: Mapped[StoreBatch] = relationship()

    __table_args__ = (
        UniqueConstraint("delivery_id", "batch_id", name="uq_store_delivery_lines_batch"),
        CheckConstraint("quantity >= 0", name="ck_store_delivery_lines_quantity"),
        CheckConstraint(
            "carton_contains_qty IS NULL OR carton_contains_qty >= 1",
            name="ck_store_delivery_lines_carton_contains",
        ),
        CheckConstraint(
            "noted_quantity IS NULL OR noted_quantity >= 0",
            name="ck_store_delivery_lines_noted_quantity",
        ),
        Index("ix_store_delivery_lines_batch", "batch_id"),
    )


class StoreCount(Base):
    """One monthly Stock count (migration 0111); at most one per calendar month."""

    __tablename__ = "store_counts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    month: Mapped[str] = mapped_column(String(7), nullable=False)
    counted_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    lines: Mapped[list[StoreCountLine]] = relationship(
        back_populates="count", cascade="all, delete-orphan", order_by="StoreCountLine.id"
    )

    __table_args__ = (
        UniqueConstraint("month", name="uq_store_counts_month"),
        Index("ix_store_counts_counted_on", "counted_on"),
    )


class StoreCountLine(Base):
    __tablename__ = "store_count_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    count_id: Mapped[int] = mapped_column(
        ForeignKey("store_counts.id", ondelete="CASCADE"), nullable=False
    )
    batch_id: Mapped[int] = mapped_column(ForeignKey("store_batches.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    count: Mapped[StoreCount] = relationship(back_populates="lines")
    batch: Mapped[StoreBatch] = relationship()

    __table_args__ = (
        UniqueConstraint("count_id", "batch_id", name="uq_store_count_lines_batch"),
        CheckConstraint("quantity >= 0", name="ck_store_count_lines_quantity"),
        Index("ix_store_count_lines_batch", "batch_id"),
    )


class StoreDisposal(Base):
    """Stock removed from a Batch because it expired or was damaged (migration 0111)."""

    __tablename__ = "store_disposals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("store_batches.id"), nullable=False)
    disposed_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(8), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    batch: Mapped[StoreBatch] = relationship()

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_store_disposals_quantity"),
        CheckConstraint("reason IN ('expired', 'damaged')", name="ck_store_disposals_reason"),
        Index("ix_store_disposals_batch", "batch_id"),
        Index("ix_store_disposals_disposed_on", "disposed_on"),
    )


class StoreHandover(Base):
    """Stock handed to a named person, resolved into FEFO Batch lines."""

    __tablename__ = "store_handovers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    handed_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    taken_by: Mapped[str] = mapped_column(String(128), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    lines: Mapped[list[StoreHandoverLine]] = relationship(
        back_populates="handover", cascade="all, delete-orphan", order_by="StoreHandoverLine.id"
    )

    __table_args__ = (Index("ix_store_handovers_handed_on", "handed_on"),)


class StoreHandoverLine(Base):
    __tablename__ = "store_handover_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    handover_id: Mapped[int] = mapped_column(
        ForeignKey("store_handovers.id", ondelete="CASCADE"), nullable=False
    )
    batch_id: Mapped[int] = mapped_column(ForeignKey("store_batches.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    handover: Mapped[StoreHandover] = relationship(back_populates="lines")
    batch: Mapped[StoreBatch] = relationship()

    __table_args__ = (
        UniqueConstraint("handover_id", "batch_id", name="uq_store_handover_lines_batch"),
        CheckConstraint("quantity > 0", name="ck_store_handover_lines_quantity"),
        Index("ix_store_handover_lines_batch", "batch_id"),
    )


class StoreItemAlias(Base):
    __tablename__ = "store_item_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False)
    alias_norm: Mapped[str] = mapped_column(String, nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (UniqueConstraint("alias_norm", name="uq_store_item_aliases_alias_norm"),)


# --- Uniform (migration 0115) ----------------------------------------------

UNIFORM_VOID_CHECK: Final = (
    "(voided_at IS NULL AND void_reason IS NULL)"
    " OR (voided_at IS NOT NULL AND void_reason IS NOT NULL"
    " AND length(trim(void_reason)) > 0)"
)


class _UniformVoidable:
    """Void columns shared by every Uniform posting header."""

    voided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    voided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    void_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)


class _UniformStamped:
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.current_timestamp(),
    )


# Public Uniform identities must not be reused after deletion: drafts, void
# confirmations and audit records outlive rows. Posting-line IDs stay internal.
class UniformItem(_UniformStamped, Base):
    """A catalogue garment. ``tracking`` is ``shelf`` (sized stock) or ``holder``."""

    __tablename__ = "uniform_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_ar: Mapped[str] = mapped_column(String(120), nullable=False)
    description_en: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description_ar: Mapped[str | None] = mapped_column(String(500), nullable=True)
    group_key: Mapped[str] = mapped_column(String(16), nullable=False)
    drawing: Mapped[str] = mapped_column(String(16), nullable=False)
    tracking: Mapped[str] = mapped_column(String(8), nullable=False)
    default_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    sizes: Mapped[list[UniformSize]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="UniformSize.sort_order",
    )

    __table_args__ = (
        CheckConstraint(
            "group_key IN ('formal', 'guard', 'winter')", name="ck_uniform_items_group"
        ),
        CheckConstraint(
            "drawing IN ('suit', 'boots', 'polo', 'cargo', 'belt', 'cap', 'socks', 'jacket',"
            " 'vest', 'parka', 'dressshirt', 'longsleeve')",
            name="ck_uniform_items_drawing",
        ),
        CheckConstraint("tracking IN ('shelf', 'holder')", name="ck_uniform_items_tracking"),
        CheckConstraint("default_qty >= 1", name="ck_uniform_items_default_qty"),
        Index(
            "uq_uniform_items_name_active",
            func.lower(text("name_en")),
            unique=True,
            sqlite_where=text("archived_at IS NULL"),
        ),
        Index(
            "uq_uniform_items_drawing_active",
            "drawing",
            unique=True,
            sqlite_where=text("archived_at IS NULL"),
        ),
        {"sqlite_autoincrement": True},
    )


class UniformSize(_UniformStamped, Base):
    """One size of a shelf item; ``on_hand`` is the cached shelf balance."""

    __tablename__ = "uniform_sizes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(
        ForeignKey("uniform_items.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(16), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    on_hand: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    min_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    item: Mapped[UniformItem] = relationship(back_populates="sizes")

    __table_args__ = (
        CheckConstraint("on_hand >= 0", name="ck_uniform_sizes_on_hand"),
        CheckConstraint("min_qty IS NULL OR min_qty >= 0", name="ck_uniform_sizes_min_qty"),
        Index(
            "uq_uniform_sizes_item_label_active",
            "item_id",
            func.lower(text("label")),
            unique=True,
            sqlite_where=text("archived_at IS NULL"),
        ),
        {"sqlite_autoincrement": True},
    )


class UniformReceipt(_UniformVoidable, _UniformStamped, Base):
    """Dated stock receipt from HQ."""

    __tablename__ = "uniform_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    received_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    lines: Mapped[list[UniformReceiptLine]] = relationship(
        back_populates="receipt", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(UNIFORM_VOID_CHECK, name="ck_uniform_receipts_void"),
        {"sqlite_autoincrement": True},
    )


class UniformReceiptLine(_UniformStamped, Base):
    __tablename__ = "uniform_receipt_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_id: Mapped[int] = mapped_column(
        ForeignKey("uniform_receipts.id", ondelete="CASCADE"), nullable=False
    )
    size_id: Mapped[int] = mapped_column(ForeignKey("uniform_sizes.id"), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)

    receipt: Mapped[UniformReceipt] = relationship(back_populates="lines")

    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_uniform_receipt_lines_qty"),
        UniqueConstraint("receipt_id", "size_id", name="uq_uniform_receipt_lines_size"),
    )


class UniformIssue(_UniformVoidable, _UniformStamped, Base):
    """Hand-out of uniform to one employee."""

    __tablename__ = "uniform_issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    issued_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    lines: Mapped[list[UniformIssueLine]] = relationship(
        back_populates="issue", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(UNIFORM_VOID_CHECK, name="ck_uniform_issues_void"),
        Index("ix_uniform_issues_employee", "employee_id"),
        {"sqlite_autoincrement": True},
    )


class UniformIssueLine(_UniformStamped, Base):
    """``size_id`` is NULL exactly for holder-tracked items (service-enforced)."""

    __tablename__ = "uniform_issue_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    issue_id: Mapped[int] = mapped_column(
        ForeignKey("uniform_issues.id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(ForeignKey("uniform_items.id"), nullable=False)
    size_id: Mapped[int | None] = mapped_column(ForeignKey("uniform_sizes.id"), nullable=True)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)

    issue: Mapped[UniformIssue] = relationship(back_populates="lines")

    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_uniform_issue_lines_qty"),
        UniqueConstraint("issue_id", "item_id", "size_id", name="uq_uniform_issue_lines_line"),
        Index(
            "uq_uniform_issue_lines_holder",
            "issue_id",
            "item_id",
            unique=True,
            sqlite_where=text("size_id IS NULL"),
        ),
    )


class UniformReturn(_UniformVoidable, _UniformStamped, Base):
    __tablename__ = "uniform_returns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    returned_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    lines: Mapped[list[UniformReturnLine]] = relationship(
        back_populates="return_", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(UNIFORM_VOID_CHECK, name="ck_uniform_returns_void"),
        Index("ix_uniform_returns_employee", "employee_id"),
        {"sqlite_autoincrement": True},
    )


class UniformReturnLine(_UniformStamped, Base):
    """Only ``reusable`` lines restock the shelf; both reduce holdings."""

    __tablename__ = "uniform_return_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(
        ForeignKey("uniform_returns.id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(ForeignKey("uniform_items.id"), nullable=False)
    size_id: Mapped[int | None] = mapped_column(ForeignKey("uniform_sizes.id"), nullable=True)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    condition: Mapped[str] = mapped_column(String(8), nullable=False)

    return_: Mapped[UniformReturn] = relationship(back_populates="lines")

    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_uniform_return_lines_qty"),
        CheckConstraint(
            "condition IN ('reusable', 'damaged')", name="ck_uniform_return_lines_condition"
        ),
    )


class UniformAdjustment(_UniformVoidable, _UniformStamped, Base):
    """Reasoned shelf count correction for one size."""

    __tablename__ = "uniform_adjustments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    size_id: Mapped[int] = mapped_column(ForeignKey("uniform_sizes.id"), nullable=False)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    adjusted_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        CheckConstraint(UNIFORM_VOID_CHECK, name="ck_uniform_adjustments_void"),
        CheckConstraint("delta <> 0", name="ck_uniform_adjustments_delta"),
        CheckConstraint("length(trim(reason)) > 0", name="ck_uniform_adjustments_reason"),
        Index("ix_uniform_adjustments_size", "size_id"),
        {"sqlite_autoincrement": True},
    )


# --- Armory (migration 0126) -----------------------------------------------
#
# A ledger of externally authorized activity for controlled equipment. Postings
# are immutable evidence; ``armory_stock.on_hand``, serial state and assignment
# ``remaining_qty`` are projections changed only inside the posting/void write
# transaction. Nothing cascades on delete: evidence is never erased.

ARMORY_MAX_QTY: Final = 2_147_483_647
ARMORY_KINDS: Final = ("firearm", "ammunition", "serial", "quantity", "expiry")
ARMORY_CATEGORIES: Final = (
    "firearms",
    "ammo",
    "accessories",
    "nonlethal",
    "restraints",
    "riot",
    "comms",
)
ARMORY_DRAWINGS: Final = (
    "rifle",
    "pistol",
    "magazine",
    "rounds",
    "sling",
    "holster",
    "tool",
    "rod",
    "scabbard",
    "grip",
    "adapter",
    "case",
    "taser",
    "spray",
    "cartridge",
    "cuffs",
    "leg-irons",
    "plastic",
    "key",
    "baton",
    "helmet",
    "shield",
    "riot-suit",
    "radio",
    "bodycam",
    "wand",
)
ARMORY_SERIAL_STATES: Final = (
    "in_safe",
    "signed_out",
    "in_custody",
    "in_repair",
    "missing",
    "lost",
    "written_off",
)
ARMORY_SERIAL_ACTIONS: Final = (
    "send_repair",
    "return_repair",
    "mark_lost",
    "write_off",
    "transfer",
)
ARMORY_POSTING_KINDS: Final = (
    "opening",
    "receipt",
    "serial_registration",
    "shift_issue",
    "custody",
    "return",
    "shift_check",
    "monthly_count",
    "serial_state",
    "decision",
)
ARMORY_INTAKE_SOURCES: Final = ("supplier", "head_office", "other")
ARMORY_KIT_CODES: Final = ("rifle", "pistol", "equipment")
ARMORY_KIT_ROLES: Final = ("default", "alternative", "optional")
ARMORY_LICENCE_STATUSES: Final = ("missing", "expired", "expiring", "valid")
ARMORY_OFF_DUTY_REASONS: Final = ("cover", "escort", "training", "other")
ARMORY_SHORTFALL_REASONS: Final = ("training", "incident", "lost", "other")
ARMORY_DISCREPANCY_KINDS: Final = (
    "rounds_shortfall",
    "missing_serial",
    "unexpected_serial",
    "monthly_quantity",
)
ARMORY_DECISION_OUTCOMES: Final = ("found", "used_in_training", "lost", "recording_error")


def _armory_in(column: str, values: tuple[str, ...], *, nullable: bool = False) -> str:
    listed = ", ".join(f"'{value}'" for value in values)
    check = f"{column} IN ({listed})"
    return f"{column} IS NULL OR {check}" if nullable else check


def _armory_qty(column: str, *, nullable: bool = False, positive: bool = False) -> str:
    low = ">= 1" if positive else ">= 0"
    check = f"{column} {low} AND {column} <= {ARMORY_MAX_QTY}"
    return f"{column} IS NULL OR ({check})" if nullable else check


def _armory_text(column: str) -> str:
    return f"length(trim({column})) > 0"


class ArmorySafe(Base):
    """A logical ledger location. Optional Fleet site and exact Workforce duty path."""

    __tablename__ = "armory_safes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_ar: Mapped[str] = mapped_column(String(120), nullable=False)
    vehicle_site_id: Mapped[int | None] = mapped_column(
        ForeignKey("vehicle_sites.id"), nullable=True
    )
    duty_unit: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duty_post: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    stock_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    __table_args__ = (
        CheckConstraint(_armory_text("name_en"), name="ck_armory_safes_name_en"),
        CheckConstraint(_armory_text("name_ar"), name="ck_armory_safes_name_ar"),
        CheckConstraint(
            "(duty_unit IS NULL) = (duty_post IS NULL)", name="ck_armory_safes_duty_pair"
        ),
        CheckConstraint("stock_revision >= 0", name="ck_armory_safes_stock_revision"),
        Index("uq_armory_safes_name_en", func.lower(text("name_en")), unique=True),
        Index("uq_armory_safes_name_ar", "name_ar", unique=True),
        Index(
            "uq_armory_safes_vehicle_site",
            "vehicle_site_id",
            unique=True,
            sqlite_where=text("vehicle_site_id IS NOT NULL"),
        ),
        Index(
            "uq_armory_safes_duty_path",
            "duty_unit",
            "duty_post",
            unique=True,
            sqlite_where=text("duty_unit IS NOT NULL"),
        ),
        {"sqlite_autoincrement": True},
    )


class ArmoryShiftPolicy(Base):
    """Append-only shift settings; a row applies from ``effective_on`` (latest id wins)."""

    __tablename__ = "armory_shift_policies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    effective_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    day_start: Mapped[dt.time] = mapped_column(Time, nullable=False)
    night_start: Mapped[dt.time] = mapped_column(Time, nullable=False)
    grace_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    __table_args__ = (
        CheckConstraint("day_start < night_start", name="ck_armory_shift_policies_order"),
        CheckConstraint(
            "grace_minutes >= 0 AND grace_minutes <= 1440", name="ck_armory_shift_policies_grace"
        ),
        Index("ix_armory_shift_policies_effective", "effective_on", "id"),
        {"sqlite_autoincrement": True},
    )


class ArmoryItem(Base):
    """Catalogue definition. ``kind`` is immutable once created."""

    __tablename__ = "armory_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    preset_key: Mapped[str | None] = mapped_column(String(40), nullable=True, unique=True)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_ar: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    drawing: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, server_default=func.current_timestamp()
    )
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        CheckConstraint(_armory_text("name_en"), name="ck_armory_items_name_en"),
        CheckConstraint(_armory_text("name_ar"), name="ck_armory_items_name_ar"),
        CheckConstraint(_armory_in("kind", ARMORY_KINDS), name="ck_armory_items_kind"),
        CheckConstraint(_armory_in("category", ARMORY_CATEGORIES), name="ck_armory_items_category"),
        CheckConstraint(_armory_in("drawing", ARMORY_DRAWINGS), name="ck_armory_items_drawing"),
        CheckConstraint(
            "(kind = 'firearm') = (category = 'firearms')", name="ck_armory_items_firearms"
        ),
        CheckConstraint("(kind = 'ammunition') = (category = 'ammo')", name="ck_armory_items_ammo"),
        Index("uq_armory_items_name_en", func.lower(text("name_en")), unique=True),
        Index("uq_armory_items_name_ar", "name_ar", unique=True),
        {"sqlite_autoincrement": True},
    )


class ArmoryKit(Base):
    """Posting template. ``equipment`` is the only kit without a firearm model."""

    __tablename__ = "armory_kits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_ar: Mapped[str] = mapped_column(String(120), nullable=False)
    firearm_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("armory_items.id"), nullable=True
    )

    lines: Mapped[list[ArmoryKitItem]] = relationship(
        foreign_keys="ArmoryKitItem.kit_id", order_by="ArmoryKitItem.item_id"
    )

    __table_args__ = (
        CheckConstraint(_armory_in("code", ARMORY_KIT_CODES), name="ck_armory_kits_code"),
        CheckConstraint(
            "(code = 'equipment') = (firearm_item_id IS NULL)", name="ck_armory_kits_firearm"
        ),
        Index(
            "uq_armory_kits_firearm",
            "firearm_item_id",
            unique=True,
            sqlite_where=text("firearm_item_id IS NOT NULL"),
        ),
        {"sqlite_autoincrement": True},
    )


class ArmoryKitItem(Base):
    """Kit membership. Defaults carry a quantity; alternatives substitute a default."""

    __tablename__ = "armory_kit_items"

    kit_id: Mapped[int] = mapped_column(ForeignKey("armory_kits.id"), primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("armory_items.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    default_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    substitutes_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("armory_items.id"), nullable=True
    )

    __table_args__ = (
        CheckConstraint(_armory_in("role", ARMORY_KIT_ROLES), name="ck_armory_kit_items_role"),
        CheckConstraint(
            "(role = 'default' AND default_qty > 0) OR (role <> 'default' AND default_qty = 0)",
            name="ck_armory_kit_items_default_qty",
        ),
        CheckConstraint(
            "(role = 'alternative') = (substitutes_item_id IS NOT NULL)",
            name="ck_armory_kit_items_substitute",
        ),
    )


class ArmoryBatch(Base):
    """Expiry lot of one item, shared across safes. Expiry is immutable."""

    __tablename__ = "armory_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("armory_items.id"), nullable=False)
    batch_ref: Mapped[str] = mapped_column(String(80), nullable=False)
    expires_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (
        CheckConstraint(_armory_text("batch_ref"), name="ck_armory_batches_ref"),
        UniqueConstraint("item_id", "batch_ref", name="uq_armory_batches_item_ref"),
        {"sqlite_autoincrement": True},
    )


class ArmoryStock(Base):
    """Quantity bucket per safe/item (and batch). ``opening_qty`` NULL = never attested."""

    __tablename__ = "armory_stock"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    safe_id: Mapped[int] = mapped_column(ForeignKey("armory_safes.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("armory_items.id"), nullable=False)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("armory_batches.id"), nullable=True)
    on_hand: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    opening_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        CheckConstraint(_armory_qty("on_hand"), name="ck_armory_stock_on_hand"),
        CheckConstraint(_armory_qty("opening_qty", nullable=True), name="ck_armory_stock_opening"),
        CheckConstraint(
            "batch_id IS NULL OR opening_qty IS NULL", name="ck_armory_stock_opening_unbatched"
        ),
        Index(
            "uq_armory_stock_unbatched",
            "safe_id",
            "item_id",
            unique=True,
            sqlite_where=text("batch_id IS NULL"),
        ),
        Index(
            "uq_armory_stock_batch",
            "safe_id",
            "item_id",
            "batch_id",
            unique=True,
            sqlite_where=text("batch_id IS NOT NULL"),
        ),
        {"sqlite_autoincrement": True},
    )


class ArmoryGuardQualification(Base):
    """Recorded passed course and licence evidence; not an authorization."""

    __tablename__ = "armory_guard_qualifications"

    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), primary_key=True)
    course_round: Mapped[int | None] = mapped_column(Integer, nullable=True)
    licence_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    licence_expires_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "course_round IS NULL OR course_round > 0", name="ck_armory_guard_quals_course"
        ),
        CheckConstraint(
            "(licence_number IS NULL) = (licence_expires_on IS NULL)",
            name="ck_armory_guard_quals_licence_pair",
        ),
        CheckConstraint(
            "licence_number IS NULL OR length(trim(licence_number)) > 0",
            name="ck_armory_guard_quals_licence_number",
        ),
        CheckConstraint("version > 0", name="ck_armory_guard_quals_version"),
    )


class ArmoryPosting(Base):
    """Immutable ledger header. Voids set the triple once and post inverse effects."""

    __tablename__ = "armory_postings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    safe_id: Mapped[int] = mapped_column(ForeignKey("armory_safes.id"), nullable=False)
    related_posting_id: Mapped[int | None] = mapped_column(
        ForeignKey("armory_postings.id"), nullable=True
    )
    occurred_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    actor_employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    witness_employee_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True
    )
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    serial_action: Mapped[str | None] = mapped_column(String(16), nullable=True)
    period_key: Mapped[str | None] = mapped_column(String(16), nullable=True)
    count_context: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(none_as_null=True), nullable=True
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    voided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    void_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    void_witness_employee_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True
    )

    lines: Mapped[list[ArmoryPostingLine]] = relationship(
        foreign_keys="ArmoryPostingLine.posting_id", order_by="ArmoryPostingLine.position"
    )

    __table_args__ = (
        CheckConstraint(_armory_in("kind", ARMORY_POSTING_KINDS), name="ck_armory_postings_kind"),
        CheckConstraint(
            _armory_in("source", ARMORY_INTAKE_SOURCES, nullable=True),
            name="ck_armory_postings_source",
        ),
        CheckConstraint(
            _armory_in("serial_action", ARMORY_SERIAL_ACTIONS, nullable=True),
            name="ck_armory_postings_serial_action",
        ),
        CheckConstraint(
            "(voided_at IS NULL AND voided_by_id IS NULL AND void_reason IS NULL)"
            " OR (voided_at IS NOT NULL AND voided_by_id IS NOT NULL"
            " AND void_reason IS NOT NULL AND length(trim(void_reason)) > 0)",
            name="ck_armory_postings_void",
        ),
        CheckConstraint(
            "void_witness_employee_id IS NULL OR voided_at IS NOT NULL",
            name="ck_armory_postings_void_witness",
        ),
        CheckConstraint(
            "(period_key IS NULL) = (kind NOT IN ('shift_check', 'monthly_count'))",
            name="ck_armory_postings_period",
        ),
        Index(
            "uq_armory_postings_live_period",
            "safe_id",
            "kind",
            "period_key",
            unique=True,
            sqlite_where=text("period_key IS NOT NULL AND voided_at IS NULL"),
        ),
        Index("ix_armory_postings_safe_date", "safe_id", "occurred_on", "id"),
        Index("ix_armory_postings_related", "related_posting_id", "kind"),
        {"sqlite_autoincrement": True},
    )


class ArmorySerial(Base):
    """Registered unit. ``safe_id`` is its home safe in every live state.

    A NULL state marks a history-only row left by voiding the intake that
    created it; a corrected intake creates a fresh row.
    """

    __tablename__ = "armory_serials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("armory_items.id"), nullable=False)
    serial_code: Mapped[str] = mapped_column(String(80), nullable=False)
    safe_id: Mapped[int | None] = mapped_column(ForeignKey("armory_safes.id"), nullable=True)
    state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    state_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_posting_id: Mapped[int] = mapped_column(ForeignKey("armory_postings.id"), nullable=False)

    __table_args__ = (
        CheckConstraint(
            _armory_in("state", ARMORY_SERIAL_STATES, nullable=True),
            name="ck_armory_serials_state",
        ),
        CheckConstraint(
            "(state IS NULL) = (safe_id IS NULL) AND (state IS NULL) = (state_at IS NULL)",
            name="ck_armory_serials_live",
        ),
        CheckConstraint(_armory_text("serial_code"), name="ck_armory_serials_code"),
        Index(
            "uq_armory_serials_live_code",
            "serial_code",
            unique=True,
            sqlite_where=text("state IS NOT NULL"),
        ),
        Index("ix_armory_serials_safe_item_state", "safe_id", "item_id", "state"),
        {"sqlite_autoincrement": True},
    )


class ArmoryAssignment(Base):
    """Shift issue or custody record; its posting's ``kind`` says which."""

    __tablename__ = "armory_assignments"

    posting_id: Mapped[int] = mapped_column(ForeignKey("armory_postings.id"), primary_key=True)
    holder_kind: Mapped[str] = mapped_column(String(8), nullable=False)
    holder_employee_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True
    )
    holder_safe_id: Mapped[int | None] = mapped_column(ForeignKey("armory_safes.id"), nullable=True)
    supervisor_employee_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True
    )
    kit_id: Mapped[int] = mapped_column(ForeignKey("armory_kits.id"), nullable=False)
    firearm_open: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    course_round_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    licence_status_at_issue: Mapped[str | None] = mapped_column(String(8), nullable=True)
    licence_warning_acknowledged: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    off_duty_reason: Mapped[str | None] = mapped_column(String(8), nullable=True)
    off_duty_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    excess_rounds_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    grace_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shift_window: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(none_as_null=True), nullable=True
    )
    receipt_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(none_as_null=True), nullable=True
    )

    lines: Mapped[list[ArmoryAssignmentLine]] = relationship(
        foreign_keys="ArmoryAssignmentLine.assignment_id",
        order_by="ArmoryAssignmentLine.position",
    )

    __table_args__ = (
        CheckConstraint(
            "(holder_kind = 'person' AND holder_employee_id IS NOT NULL"
            " AND holder_safe_id IS NULL AND supervisor_employee_id IS NULL)"
            " OR (holder_kind = 'site' AND holder_employee_id IS NULL"
            " AND holder_safe_id IS NOT NULL)",
            name="ck_armory_assignments_holder",
        ),
        CheckConstraint(
            _armory_in("licence_status_at_issue", ARMORY_LICENCE_STATUSES, nullable=True),
            name="ck_armory_assignments_licence_status",
        ),
        CheckConstraint(
            _armory_in("off_duty_reason", ARMORY_OFF_DUTY_REASONS, nullable=True),
            name="ck_armory_assignments_off_duty",
        ),
        CheckConstraint(
            "firearm_open IN (0, 1) AND licence_warning_acknowledged IN (0, 1)",
            name="ck_armory_assignments_booleans",
        ),
        CheckConstraint(
            "(due_at IS NULL) = (grace_minutes IS NULL)"
            " AND (due_at IS NULL) = (shift_window IS NULL)"
            " AND (due_at IS NULL OR receipt_snapshot IS NULL)",
            name="ck_armory_assignments_shift_fields",
        ),
        CheckConstraint(
            "grace_minutes IS NULL OR (grace_minutes >= 0 AND grace_minutes <= 1440)",
            name="ck_armory_assignments_grace",
        ),
        CheckConstraint(
            "course_round_snapshot IS NULL OR course_round_snapshot > 0",
            name="ck_armory_assignments_course",
        ),
        Index(
            "uq_armory_assignments_open_firearm",
            func.coalesce(text("holder_employee_id"), text("supervisor_employee_id")),
            unique=True,
            sqlite_where=text("firearm_open = 1"),
        ),
        Index("ix_armory_assignments_holder", "holder_employee_id"),
        Index("ix_armory_assignments_supervisor", "supervisor_employee_id"),
    )


class ArmoryAssignmentLine(Base):
    """Issued line; ``remaining_qty`` is the live outstanding projection."""

    __tablename__ = "armory_assignment_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("armory_assignments.posting_id"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("armory_items.id"), nullable=False)
    serial_id: Mapped[int | None] = mapped_column(ForeignKey("armory_serials.id"), nullable=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("armory_batches.id"), nullable=True)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    remaining_qty: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint(_armory_qty("qty", positive=True), name="ck_armory_assignment_lines_qty"),
        CheckConstraint(
            "remaining_qty >= 0 AND remaining_qty <= qty",
            name="ck_armory_assignment_lines_remaining",
        ),
        CheckConstraint(
            "serial_id IS NULL OR (qty = 1 AND batch_id IS NULL)",
            name="ck_armory_assignment_lines_serial",
        ),
        UniqueConstraint("assignment_id", "position", name="uq_armory_assignment_lines_position"),
        Index(
            "uq_armory_assignment_lines_open_serial",
            "serial_id",
            unique=True,
            sqlite_where=text("serial_id IS NOT NULL AND remaining_qty > 0"),
        ),
        {"sqlite_autoincrement": True},
    )


class ArmoryPostingLine(Base):
    """Immutable effect/evidence of one posting line.

    ``stock_delta`` applies to the posting's safe bucket; serialized movements
    record before/after state and safe instead of a quantity delta.
    """

    __tablename__ = "armory_posting_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    posting_id: Mapped[int] = mapped_column(ForeignKey("armory_postings.id"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("armory_items.id"), nullable=False)
    serial_id: Mapped[int | None] = mapped_column(ForeignKey("armory_serials.id"), nullable=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("armory_batches.id"), nullable=True)
    assignment_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("armory_assignment_lines.id"), nullable=True
    )
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    stock_delta: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    before_on_hand: Mapped[int | None] = mapped_column(Integer, nullable=True)
    after_on_hand: Mapped[int | None] = mapped_column(Integer, nullable=True)
    before_state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    after_state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    before_safe_id: Mapped[int | None] = mapped_column(ForeignKey("armory_safes.id"), nullable=True)
    after_safe_id: Mapped[int | None] = mapped_column(ForeignKey("armory_safes.id"), nullable=True)
    remaining_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    remaining_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    condition: Mapped[str | None] = mapped_column(String(8), nullable=True)
    fault_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    __table_args__ = (
        CheckConstraint(_armory_qty("qty"), name="ck_armory_posting_lines_qty"),
        CheckConstraint(
            f"stock_delta >= -{ARMORY_MAX_QTY} AND stock_delta <= {ARMORY_MAX_QTY}",
            name="ck_armory_posting_lines_delta",
        ),
        CheckConstraint(
            _armory_in("before_state", ARMORY_SERIAL_STATES, nullable=True),
            name="ck_armory_posting_lines_before_state",
        ),
        CheckConstraint(
            _armory_in("after_state", ARMORY_SERIAL_STATES, nullable=True),
            name="ck_armory_posting_lines_after_state",
        ),
        CheckConstraint(
            _armory_in("condition", ("ok", "repair"), nullable=True),
            name="ck_armory_posting_lines_condition",
        ),
        UniqueConstraint("posting_id", "position", name="uq_armory_posting_lines_position"),
        Index("ix_armory_posting_lines_serial", "serial_id"),
        Index("ix_armory_posting_lines_item", "item_id"),
        Index("ix_armory_posting_lines_assignment_line", "assignment_line_id"),
        {"sqlite_autoincrement": True},
    )


class ArmoryCountLine(Base):
    """Per-item check/count evidence: what was expected and what was observed."""

    __tablename__ = "armory_count_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    posting_id: Mapped[int] = mapped_column(ForeignKey("armory_postings.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("armory_items.id"), nullable=False)
    expected_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    observed_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_serial_ids: Mapped[list[int]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    observed_serial_codes: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    expected_unrecorded_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    observed_unrecorded_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        CheckConstraint(_armory_qty("observed_qty"), name="ck_armory_count_lines_observed"),
        CheckConstraint(
            _armory_qty("expected_qty", nullable=True), name="ck_armory_count_lines_expected"
        ),
        CheckConstraint(
            _armory_qty("expected_unrecorded_qty", nullable=True),
            name="ck_armory_count_lines_expected_unrecorded",
        ),
        CheckConstraint(
            _armory_qty("observed_unrecorded_qty", nullable=True),
            name="ck_armory_count_lines_observed_unrecorded",
        ),
        UniqueConstraint("posting_id", "item_id", name="uq_armory_count_lines_item"),
        {"sqlite_autoincrement": True},
    )


class ArmoryDiscrepancy(Base):
    """One finding. Open = live source and no active decision."""

    __tablename__ = "armory_discrepancies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_posting_id: Mapped[int] = mapped_column(ForeignKey("armory_postings.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("armory_items.id"), nullable=False)
    assignment_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("armory_assignment_lines.id"), nullable=True
    )
    serial_id: Mapped[int | None] = mapped_column(ForeignKey("armory_serials.id"), nullable=True)
    unexpected_serial_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    expected_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    observed_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    involved_employee_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.id"), nullable=True
    )
    shortfall_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(80), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active_decision_posting_id: Mapped[int | None] = mapped_column(
        ForeignKey("armory_postings.id"), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            _armory_in("kind", ARMORY_DISCREPANCY_KINDS), name="ck_armory_discrepancies_kind"
        ),
        CheckConstraint(
            _armory_in("shortfall_reason", ARMORY_SHORTFALL_REASONS, nullable=True),
            name="ck_armory_discrepancies_reason",
        ),
        CheckConstraint(
            _armory_qty("expected_qty") + " AND " + _armory_qty("observed_qty"),
            name="ck_armory_discrepancies_qty",
        ),
        Index("ix_armory_discrepancies_source", "source_posting_id"),
        Index("ix_armory_discrepancies_decision", "active_decision_posting_id"),
        Index("ix_armory_discrepancies_serial", "serial_id"),
        {"sqlite_autoincrement": True},
    )


class ArmoryDecision(Base):
    """Outcome chosen for one discrepancy; evidence and effects live on the posting."""

    __tablename__ = "armory_decisions"

    posting_id: Mapped[int] = mapped_column(ForeignKey("armory_postings.id"), primary_key=True)
    discrepancy_id: Mapped[int] = mapped_column(
        ForeignKey("armory_discrepancies.id"), nullable=False
    )
    outcome: Mapped[str] = mapped_column(String(24), nullable=False)

    __table_args__ = (
        CheckConstraint(
            _armory_in("outcome", ARMORY_DECISION_OUTCOMES), name="ck_armory_decisions_outcome"
        ),
        Index("ix_armory_decisions_discrepancy", "discrepancy_id", "posting_id"),
    )


# Imported last on purpose: workforce models reference tables defined above, so
# a top-of-module import would close a circular import at class-definition time.
from app.db.workforce_models import (  # noqa: E402
    AttendanceAdjustment,
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationLeaveSource,
    AttendanceEvaluationPunchSource,
    AttendanceEvaluationQueue,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendancePunchAssignment,
    AttendanceSyncState,
    DutyAssignmentEvent,
    UserWorkforceScope,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkRotationStep,
    WorkShiftDefinition,
    WorkShiftOccurrence,
    WorkShiftOverride,
    WorkStaffingRequirement,
)

__all__ = [
    "REF_SEQUENCE_ID",
    "Absence",
    "AppSetting",
    "AttendanceAdjustment",
    "AttendanceCase",
    "AttendanceEvaluation",
    "AttendanceEvaluationLeaveSource",
    "AttendanceEvaluationPunchSource",
    "AttendanceEvaluationQueue",
    "AttendanceProviderPerson",
    "AttendancePunch",
    "AttendancePunchAssignment",
    "AttendanceSyncState",
    "AuditLog",
    "AuthSession",
    "Book",
    "BookApprovalStep",
    "BookCategory",
    "BookRefSequence",
    "BookVersion",
    "Document",
    "DocumentExtraction",
    "DutyAssignmentEvent",
    "EditorTemplate",
    "EmailAccount",
    "Employee",
    "EmployeeFormerId",
    "GeneralBookRecipient",
    "InmateViolationManualRow",
    "InmateViolationPeriod",
    "InmateViolationStatRow",
    "Leave",
    "LedgerEntry",
    "LedgerFlag",
    "Manager",
    "PermissionRequest",
    "PushSubscription",
    "RolePermission",
    "ScanInbox",
    "SmartFolder",
    "SmartFolderDismissal",
    "Submitter",
    "TimesheetDesignation",
    "TimesheetOverride",
    "TimesheetPeriod",
    "TimesheetRosterAssignment",
    "TimesheetSnapshotRow",
    "TimesheetStartAck",
    "TimesheetStatFiller",
    "User",
    "UserPermission",
    "UserWorkforceScope",
    "VaultFile",
    "VehiclePhotoAsset",
    "Violation",
    "WorkAttendancePolicy",
    "WorkCrew",
    "WorkCrewMembership",
    "WorkCrewSchedule",
    "WorkRotationPattern",
    "WorkRotationStep",
    "WorkShiftDefinition",
    "WorkShiftOccurrence",
    "WorkShiftOverride",
    "WorkStaffingRequirement",
]
