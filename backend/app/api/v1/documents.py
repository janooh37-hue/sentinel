"""Document generation and job-status endpoints.

Two routers:
  documents_router  →  prefix /documents
  jobs_router       →  prefix /jobs

POST /documents/generate    → enqueue a generation job; returns 202 + job_id.
GET  /jobs/{job_id}         → poll job status / download URLs.
GET  /documents/{id}        → fetch Document metadata row.
GET  /documents/{id}/download?format=pdf|docx → stream the file.

The in-process job pattern uses FastAPI BackgroundTasks.  The TestClient runs
background tasks synchronously after response delivery, so tests can poll
/jobs/{id} immediately after receiving the 202 and find the job already done.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Annotated, Any, Literal
from urllib.parse import quote

import anyio
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api._responses import maybe_base64
from app.api.deps import get_current_user, require_capability
from app.api.errors import AppError, NotFoundError
from app.config import get_settings
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_ALIASES, SERVICE_IDS
from app.core.pdf_merge import merge_pdfs_to_bytes
from app.core.roles import ADMIN_ROLE
from app.db.models import Book, BookVersion, Document, User
from app.db.session import SessionLocal, get_db
from app.schemas._base import ORMBase
from app.schemas.signature_placement import (
    LegacyCandidateRead,
    SignatureEditorRead,
    SignatureHistoryItemRead,
    SignatureHistoryRead,
    SignatureIdentifyRequest,
    SignaturePageRead,
    SignaturePositionRequest,
    SignatureRead,
)
from app.services import (
    approved_import_service,
    book_service,
    document_service,
    notify_dispatch,
    perm_service,
    signature_placement_service,
    staging_service,
)
from app.services.job_registry import (
    JobDocumentItem as RegistryDocItem,
)
from app.services.job_registry import (
    get_job,
    set_done,
    set_failed,
    set_running,
    submit_job,
)

log = logging.getLogger(__name__)


def _effective_document_service(template_id: str) -> str:
    resolved = SERVICE_ALIASES.get(template_id, template_id)
    return resolved if resolved in SERVICE_IDS else OTHER_SERVICE_ID


def _require_document_record_access(
    db: Session,
    user: User,
    row: Document,
    *,
    expected_version_id: int | None = None,
) -> BookVersion | None:
    """Apply the complete read gate for a stored document; return its exact
    owning ``BookVersion`` (``None`` for a standalone/unlinked document).

    Linked documents inherit their book's revision-scoped read policy for the
    EXACT version that owns them, not merely the book in general — a caller
    authorized only for a different revision must not reach these bytes.
    Companion documents inherit the primary document's exact ownership.
    ``expected_version_id``, when given, must match the resolved owning
    version or the document is treated as not found (a stale cached link
    pointing at a superseded revision must not silently serve different
    bytes than the caller expects).
    """
    owning = db.execute(
        select(Book, BookVersion)
        .join(BookVersion, BookVersion.book_id == Book.id)
        .where(BookVersion.document_id == row.id)
    ).first()
    if owning is None and row.role == "companion":
        primary_document_ids = select(Document.id).where(
            Document.submission_id == row.submission_id,
            Document.role == "primary",
        )
        owning = db.execute(
            select(Book, BookVersion)
            .join(BookVersion, BookVersion.book_id == Book.id)
            .where(BookVersion.document_id.in_(primary_document_ids))
        ).first()
    if owning is not None:
        linked_book, owning_version = owning.tuple()
        if expected_version_id is not None and expected_version_id != owning_version.id:
            raise NotFoundError(
                "DOCUMENT_NOT_FOUND",
                f"Document {row.id} not found",
                id=row.id,
            )
        book_service.resolve_book_read_access(
            db,
            user,
            linked_book,
            version_id=owning_version.id,
        )
        return owning_version
    if not perm_service.has_capability(db, user, "documents.generate"):
        raise AppError(
            "FORBIDDEN",
            "You don't have permission to access this document",
            http_status=status.HTTP_403_FORBIDDEN,
        )
    book_service.require_record_type_access(
        db,
        user,
        service_id=_effective_document_service(row.template_id),
    )
    return None


def _should_autosend(
    *,
    commit: bool,
    revise_of_book_id: int | None,
    book_id: int | None,
    notify_employee: bool = True,
) -> bool:
    """Autosend only for a committed, non-revision generation that produced a
    book, and only when the operator left the per-book notify switch on.

    ``notify_employee`` defaults True so existing callers that predate the
    per-book switch keep notifying; the generate route passes the request flag."""
    return bool(commit) and revise_of_book_id is None and book_id is not None and notify_employee


documents_router = APIRouter(prefix="/documents", tags=["documents"])
jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class GenerateAttachmentSpec(BaseModel):
    """One attachment to merge into the generated PDF (spec 2026-06-11 §6).

    ``source`` discriminates which locator fields apply: ``staged`` reads
    ``staged_token`` (from ``POST /documents/attachments/stage``);
    ``record_document`` reads ``book_id`` (that book's current generated PDF);
    ``record_attachment`` reads ``book_id`` + ``attachment_index`` (one of the
    book's film-strip scans). ``slot_key=None`` means a free-form extra.
    """

    slot_key: str | None = None
    source: Literal["staged", "record_document", "record_attachment"]
    staged_token: str | None = None
    original_name: str | None = None
    book_id: int | None = None
    attachment_index: int | None = None


class StagedAttachmentRead(BaseModel):
    """Response of ``POST /documents/attachments/stage``."""

    token: str
    filename: str
    size: int


class DocumentGenerateRequest(BaseModel):
    # Optional: admin-category templates (e.g. General Book) generate unattached
    # to an employee. document_service.generate_document handles employee_id=None.
    employee_id: str | None = None
    template_id: str
    fields: dict[str, Any] = {}
    manager_id: int | None = None
    submitter_id: int | None = None
    # Round 2 — Fix E: clean rename ``hand_sign`` → ``embed_signature`` with
    # inverted semantics. ``embed_signature[entity]=True`` opts INTO embedding
    # the signature image for that entity; default is no embed. ``hand_sign``
    # is still accepted (deprecated) but ignored — callers must migrate.
    embed_signature: dict[str, bool] | None = None
    # DEPRECATED — use embed_signature with inverted semantics. Field kept on
    # the schema so old clients don't 422; the value is no longer read.
    hand_sign: dict[str, bool] | None = None
    # Draft/Save split: when False (preview), no ref is allocated, no Book row is
    # created, the DOCX is rendered un-stamped, and the resulting Document row
    # carries ref_number="DRAFT". When True (Save), the existing full pipeline
    # runs — ref allocated, stamped, Book row inserted, Document row committed.
    commit: bool = False
    # When set, regenerate a new version of this existing book (reuse its ref)
    # instead of allocating a fresh ref + Book row. Requires commit=True.
    revise_of_book_id: int | None = None
    # Attachments validated/persisted/merged into the combined PDF on commit
    # (slots per core.form_policy; see document_service.generate_document).
    attachments: list[GenerateAttachmentSpec] | None = None
    # General Book only: government classification (التبويب) code, e.g. "5/1".
    # Required on commit — every General Book ref is now allocated from the
    # classified register (1/{tab}/GSSG/{serial}); the legacy GS-#### counter
    # is retired for this form.
    classification_code: str | None = None
    # Per-book notify opt-out (2026-07-20). The generation preview shows an
    # On-by-default switch for notifier-backed forms; sending False suppresses
    # the notification for THIS book only. Default True keeps every existing
    # caller's behaviour unchanged. ANDed with the global
    # `sms_autosend_enabled` setting inside notify_dispatch.
    notify_employee: bool = True


class DocumentGenerateResponse(BaseModel):
    job_id: str


class JobDocumentItem(BaseModel):
    """Describes one document (primary or companion) inside a completed job."""

    document_id: int
    template_id: str
    role: Literal["primary", "companion"]
    ref_number: str
    docx_url: str
    pdf_url: str | None = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "done", "failed"]
    book_id: int | None = None
    submission_id: str | None = None
    documents: list[JobDocumentItem] | None = None
    #: Days whose recorded absences the generated leave overwrote. The client
    #: announces the overwrite from these ("absence from X to Y overwritten").
    superseded_absence_dates: list[date] = Field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None


class DocumentRead(ORMBase):
    id: int
    # Nullable: admin-category docs (e.g. General Book) have no employee.
    employee_id: str | None = None
    template_id: str
    ref_number: str
    docx_path: str | None = None
    pdf_path: str | None = None
    created_at: datetime
    leave_id: int | None = None
    violation_id: int | None = None
    submission_id: str
    role: Literal["primary", "companion"]


class MyDocumentActivityRead(BaseModel):
    documents_today: int
    documents_week: int


class ApprovedViolationNameRead(BaseModel):
    name: str
    confidence: float


class ApprovedViolationInspectionRead(BaseModel):
    token: str
    filename: str
    size: int
    expires_at: datetime
    report_date: date | None = None
    inmate_names: list[ApprovedViolationNameRead]
    proposed_subject: str
    warnings: list[str]


ConfirmedInmateName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=256),
]
ConfirmedSubject = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=512),
]


class ApprovedViolationImportRequest(BaseModel):
    token: str = Field(min_length=32, max_length=32, pattern=r"^[0-9a-f]{32}$")
    report_date: date
    inmate_names: list[ConfirmedInmateName] = Field(default_factory=list, max_length=100)
    subject: ConfirmedSubject


class ApprovedViolationImportRead(BaseModel):
    book_id: int
    document_id: int
    ref_number: str
    approval_state: Literal["approved"] = "approved"


# ---------------------------------------------------------------------------
# Background task
# ---------------------------------------------------------------------------


def _run_generation(
    job_id: str,
    request: DocumentGenerateRequest,
    current_user: User | None = None,
) -> None:
    """Execute the generation pipeline; called by BackgroundTasks.

    Opens its own DB session: the request-scoped session from ``get_db`` is
    closed once the HTTP response is sent, so the background task must not reuse
    it.
    """
    set_running(job_id)
    db = SessionLocal()
    try:
        result = document_service.generate_document(
            db,
            employee_id=request.employee_id,
            template_id=request.template_id,
            fields=request.fields,
            manager_id=request.manager_id,
            submitter_id=request.submitter_id,
            embed_signature=request.embed_signature,
            commit=request.commit,
            current_user=current_user,
            record_access_user=current_user,
            revise_of_book_id=request.revise_of_book_id,
            attachments=request.attachments,
            classification_code=request.classification_code,
        )
        # Best-effort automatic employee SMS for generated service forms.
        # Must never break generation — the document is already committed.
        if _should_autosend(
            commit=request.commit,
            revise_of_book_id=request.revise_of_book_id,
            book_id=result.book_id,
            notify_employee=request.notify_employee,
        ):
            try:
                notify_dispatch.auto_send_for_book(db, result.book_id, sent_by=None)  # type: ignore[arg-type]
            except Exception:
                log.exception("auto SMS failed for book %s", result.book_id)
        registry_docs = [
            RegistryDocItem(
                document_id=doc.document_id,
                template_id=doc.template_id,
                role=doc.role,
                ref_number=doc.ref_number,
                docx_url=f"/api/v1/documents/{doc.document_id}/download?format=docx",
                pdf_url=(
                    f"/api/v1/documents/{doc.document_id}/download?format=pdf"
                    if doc.pdf_path is not None
                    else None
                ),
            )
            for doc in result.documents
        ]
        set_done(
            job_id,
            book_id=result.book_id,
            submission_id=result.submission_id,
            documents=registry_docs,
            superseded_absence_dates=result.superseded_absences,
        )
    except AppError as exc:
        set_failed(job_id, error_code=exc.code, error_message=exc.message)
    except Exception as exc:
        log.exception("Unexpected error in generation job %s", job_id)
        set_failed(
            job_id,
            error_code="GENERATION_ERROR",
            error_message=str(exc) or "Unexpected generation error",
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@documents_router.post(
    "/generate",
    response_model=DocumentGenerateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_document(
    payload: DocumentGenerateRequest,
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(require_capability("documents.generate"))],
    db: Annotated[Session, Depends(get_db)],
    _viewer: Annotated[User, Depends(require_capability("books.view"))],
) -> DocumentGenerateResponse:
    effective_service = _effective_document_service(payload.template_id)
    category_id = document_service.record_category_for_template(payload.template_id)
    book_service.require_record_type_access(
        db,
        user,
        category_id=category_id,
        service_id=effective_service,
    )
    if payload.revise_of_book_id is not None:
        if not perm_service.has_capability(db, user, "books.edit"):
            raise AppError(
                "FORBIDDEN",
                "Missing capability: books.edit",
                http_status=status.HTTP_403_FORBIDDEN,
                details={"capability": "books.edit"},
            )
        revise_book = db.get(Book, payload.revise_of_book_id)
        if revise_book is not None and revise_book.deleted_at is None:
            book_service.require_full_book_access(db, user, revise_book)

    for source in payload.attachments or ():
        if source.source == "staged" or source.book_id is None:
            continue
        source_book = db.get(Book, source.book_id)
        if source_book is not None and source_book.deleted_at is None:
            book_service.require_full_book_access(db, user, source_book)
    job_id = submit_job()
    # The task opens its own session (the request session is closed once this
    # response returns). The caller is both the stamping identity and the
    # interactive record-access authorization identity.
    background_tasks.add_task(_run_generation, job_id, payload, user)
    return DocumentGenerateResponse(job_id=job_id)


@documents_router.post("/attachments/stage", response_model=StagedAttachmentRead)
async def stage_attachment(
    upload: Annotated[UploadFile, File(alias="file")],
    _user: Annotated[User, Depends(require_capability("documents.generate"))],
) -> StagedAttachmentRead:
    """Park an attachment upload for a later generate call.

    Returns an opaque token the client echoes back inside
    ``DocumentGenerateRequest.attachments`` (``source="staged"``). Validates
    extension + size; staged files older than 24 h are purged opportunistically
    on each call (see ``services.staging_service``).
    """
    data = await upload.read()
    staged = staging_service.stage(data, upload.filename or "")
    return StagedAttachmentRead(token=staged.token, filename=staged.filename, size=staged.size)


@documents_router.post(
    "/inmate-violations/approved-imports/inspect",
    response_model=ApprovedViolationInspectionRead,
)
async def inspect_approved_violation(
    upload: Annotated[UploadFile, File(alias="file")],
    user: Annotated[User, Depends(require_capability("documents.generate"))],
) -> ApprovedViolationInspectionRead:
    data = await upload.read(book_service.MAX_ATTACHMENT_BYTES + 1)
    inspected = await anyio.to_thread.run_sync(
        lambda: approved_import_service.inspect_upload(
            owner_user_id=user.id,
            filename=upload.filename or "",
            data=data,
        )
    )
    return ApprovedViolationInspectionRead(
        token=inspected.token,
        filename=inspected.filename,
        size=inspected.size,
        expires_at=inspected.expires_at,
        report_date=inspected.report_date,
        inmate_names=[
            ApprovedViolationNameRead(name=item.name, confidence=item.confidence)
            for item in inspected.inmate_names
        ],
        proposed_subject=inspected.proposed_subject,
        warnings=inspected.warnings,
    )


@documents_router.post(
    "/inmate-violations/approved-imports",
    response_model=ApprovedViolationImportRead,
    status_code=status.HTTP_201_CREATED,
)
def commit_approved_violation(
    payload: ApprovedViolationImportRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.generate"))],
    _viewer: Annotated[User, Depends(require_capability("books.view"))],
) -> ApprovedViolationImportRead:
    book_service.require_record_type_access(
        db,
        user,
        category_id="NAT",
        service_id="Inmate Conduct Violations",
    )
    result = approved_import_service.commit_approved_import(
        db,
        owner=user,
        token=payload.token,
        report_date=payload.report_date,
        inmate_names=payload.inmate_names,
        subject=payload.subject,
    )
    return ApprovedViolationImportRead(
        book_id=result.book_id,
        document_id=result.doc_id,
        ref_number=result.ref_number,
    )


@jobs_router.get("/{job_id}", response_model=JobStatusResponse)
def get_job_status(
    job_id: str,
    _user: Annotated[User, Depends(require_capability("documents.generate"))],
) -> JobStatusResponse:
    job = get_job(job_id)
    if job is None:
        raise NotFoundError("JOB_NOT_FOUND", f"Job {job_id!r} not found", job_id=job_id)
    pydantic_docs: list[JobDocumentItem] | None = None
    if job.documents:
        pydantic_docs = [
            JobDocumentItem(
                document_id=d.document_id,
                template_id=d.template_id,
                role=d.role,
                ref_number=d.ref_number,
                docx_url=d.docx_url,
                pdf_url=d.pdf_url,
            )
            for d in job.documents
        ]
    return JobStatusResponse(
        book_id=job.book_id,
        job_id=job.job_id,
        status=job.status,
        submission_id=job.submission_id,
        documents=pydantic_docs,
        superseded_absence_dates=job.superseded_absence_dates,
        error_code=job.error_code,
        error_message=job.error_message,
    )


@documents_router.get("/activity/me", response_model=MyDocumentActivityRead)
def get_my_document_activity(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> MyDocumentActivityRead:
    return MyDocumentActivityRead(**book_service.count_my_generated_documents(db, user_id=user.id))


@documents_router.get("/{document_id}", response_model=DocumentRead)
def get_document(
    document_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    version_id: Annotated[int | None, Query(gt=0)] = None,
) -> DocumentRead:
    row: Document | None = db.get(Document, document_id)

    # Preserve the non-probing behavior for missing ids. Existing linked rows
    # are authorized below by their book instead of a blanket capability.
    if row is None and not perm_service.has_capability(db, user, "documents.generate"):
        raise AppError(
            "FORBIDDEN",
            "You don't have permission to view this document",
            http_status=status.HTTP_403_FORBIDDEN,
        )

    if row is None:
        raise NotFoundError(
            "DOCUMENT_NOT_FOUND",
            f"Document {document_id} not found",
            id=document_id,
        )

    _require_document_record_access(db, user, row, expected_version_id=version_id)
    return DocumentRead.model_validate(row)


def _inline_pdf_response(content: bytes, filename: str) -> Response:
    """Serve PDF bytes inline with an RFC 5987 Content-Disposition.

    A raw ``Response`` header must be latin-1 encodable, so a bilingual filename
    (Arabic employee name) needs an ASCII fallback plus a percent-encoded
    ``filename*`` — the same shape ``FileResponse`` builds for us automatically.
    """
    ascii_name = (
        filename.encode("ascii", "ignore").decode().translate({0x0D: None, 0x0A: None}).strip()
        or "document.pdf"
    )
    disposition = f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": disposition},
    )


@documents_router.get("/{document_id}/download")
def download_document(
    document_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    format: Literal["docx", "pdf"] = Query("pdf"),
    original: Annotated[bool, Query()] = False,
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
    version_id: Annotated[int | None, Query(gt=0)] = None,
) -> Response:
    """Stream a generated document (PDF or DOCX).

    ``encoding=base64`` returns the file bytes base64-encoded as ``text/plain``
    — the in-app PDF preview uses this so the response body never carries a
    ``%PDF`` magic-byte stream. Browser PDF handlers and download accelerators
    (notably **Internet Download Manager**, which sniffs the URL+content-type
    and intercepts the request, returning an empty 204 to the JS ``fetch``)
    would otherwise hijack the bytes and the canvas would never render. The
    ledger team uses the same trick — see ``/ledger/.../attachments/by-index``.

    ``original=true`` returns the pre-signature generated PDF (``pdf_path``) even
    when the version is signed-locked. The default download swaps in the signed
    artifact once a version is signed, which otherwise makes the original form
    unreachable; this lets the UI show the original alongside the signed copy.
    """
    row: Document | None = db.get(Document, document_id)
    if row is None:
        raise NotFoundError(
            "DOCUMENT_NOT_FOUND",
            f"Document {document_id} not found",
            id=document_id,
        )
    version = _require_document_record_access(db, user, row, expected_version_id=version_id)

    artifact = document_service.resolve_document_artifact(
        db, document_id, format=format, original=original, version=version
    )

    if artifact.companion_paths:
        merged = merge_pdfs_to_bytes(artifact.path, list(artifact.companion_paths))
        if (b64 := maybe_base64(merged, encoding)) is not None:
            return b64
        return _inline_pdf_response(
            merged, document_service.download_filename_for(row, ".pdf", db=db, version=version)
        )

    # base64 branch — opaque text/plain body that PDF handlers / download
    # accelerators won't claim. The frontend canvas decodes + renders.
    if (b64 := maybe_base64(artifact.path.read_bytes(), encoding)) is not None:
        return b64

    filename = document_service.download_filename_for(row, artifact.ext, db=db, version=version)
    # PDFs are served inline so the preview iframe can render them; the
    # frontend uses <a download> for explicit downloads which overrides
    # disposition client-side. DOCX always downloads. Based on the artifact
    # actually served (``original=true`` always serves a PDF even if the
    # caller passed ``format=docx``), not the raw query param.
    disposition = "inline" if artifact.ext == ".pdf" else "attachment"
    return FileResponse(
        path=str(artifact.path),
        media_type=artifact.media_type,
        filename=filename,
        content_disposition_type=disposition,
    )


# ---------------------------------------------------------------------------
# Signature placement editor (approval-signature-placement plan §8)
# ---------------------------------------------------------------------------


def _editor_read(description: signature_placement_service.EditorDescription) -> SignatureEditorRead:
    pdf_url = (
        f"/api/v1/documents/{description.document_id}/signature-editor/pdf"
        f"?signature_revision={description.signature_revision}"
        if description.source_sha256 is not None
        else None
    )
    signatures = [
        SignatureRead(
            id=s.id,
            role=s.role,
            page=s.page,
            x=s.x,
            y=s.y,
            width_pt=s.width_pt,
            height_pt=s.height_pt,
            default_page=s.default_page,
            default_x=s.default_x,
            default_y=s.default_y,
            image_url=(
                f"/api/v1/documents/{description.document_id}/signature-editor/images/{s.id}"
                f"?signature_revision={description.signature_revision}"
            ),
        )
        for s in description.signatures
    ]
    candidates = (
        [
            LegacyCandidateRead(
                candidate_id=c.candidate_id,
                width_emu=c.width_emu,
                height_emu=c.height_emu,
                thumbnail_url=(
                    f"/api/v1/documents/{description.document_id}"
                    f"/signature-editor/candidates/{c.candidate_id}/image"
                ),
            )
            for c in description.candidates
        ]
        if description.candidates is not None
        else None
    )
    return SignatureEditorRead(
        document_id=description.document_id,
        version_id=description.version_id,
        signature_revision=description.signature_revision,
        package_revision=description.package_revision,
        source_sha256=description.source_sha256,
        can_adjust=description.can_adjust,
        can_identify=description.can_identify,
        unavailable_code=description.unavailable_code,
        measured=description.measured,
        pdf_url=pdf_url,
        pages=[
            SignaturePageRead(page=p.page, width_pt=p.width_pt, height_pt=p.height_pt)
            for p in description.pages
        ],
        signatures=signatures,
        candidates=candidates,
    )


def _document_or_404(db: Session, document_id: int) -> Document:
    row = db.get(Document, document_id)
    if row is None:
        raise NotFoundError(
            "DOCUMENT_NOT_FOUND", f"Document {document_id} not found", id=document_id
        )
    return row


@documents_router.get("/{document_id}/signature-editor", response_model=SignatureEditorRead)
def get_signature_editor(
    document_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    measure: Annotated[bool, Query()] = False,
) -> SignatureEditorRead:
    row = _document_or_404(db, document_id)
    _require_document_record_access(db, user, row)
    description = signature_placement_service.describe_editor(
        db, document_id, user=user, measure=measure
    )
    return _editor_read(description)


@documents_router.get("/{document_id}/signature-editor/pdf")
def get_signature_editor_pdf(
    document_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    signature_revision: Annotated[int, Query(ge=0)],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """The verified current standalone primary PDF — NOT the combined
    included-papers package. Editor/identification authority required."""
    row = _document_or_404(db, document_id)
    _require_document_record_access(db, user, row)
    description = signature_placement_service.describe_editor(db, document_id, user=user)
    if not (description.can_adjust or description.can_identify):
        raise AppError("FORBIDDEN", "Signature editor access is required", http_status=403)
    _version, active = signature_placement_service.resolve_active_artifact(db, document_id)
    if active.revision != signature_revision:
        raise AppError(
            "SIGNATURE_REVISION_CONFLICT", "The record changed; reload and retry", http_status=409
        )
    settings = get_settings()
    pdf_path = settings.data_dir / active.primary_pdf_path if active.primary_pdf_path else None
    if pdf_path is None or not pdf_path.is_file():
        raise NotFoundError("SIGNATURE_SOURCE_UNAVAILABLE", "No readable primary PDF is retained")
    if (b64 := maybe_base64(pdf_path.read_bytes(), encoding)) is not None:
        return b64
    return FileResponse(
        str(pdf_path), media_type="application/pdf", headers={"Cache-Control": "no-store"}
    )


@documents_router.get("/{document_id}/signature-editor/images/{signature_id}")
def get_signature_editor_image(
    document_id: int,
    signature_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    signature_revision: Annotated[int, Query(ge=0)],
) -> Response:
    row = _document_or_404(db, document_id)
    _require_document_record_access(db, user, row)
    description = signature_placement_service.describe_editor(db, document_id, user=user)
    if not (description.can_adjust or description.can_identify):
        raise AppError("FORBIDDEN", "Signature editor access is required", http_status=403)
    _version, active = signature_placement_service.resolve_active_artifact(db, document_id)
    if active.revision != signature_revision:
        raise AppError(
            "SIGNATURE_REVISION_CONFLICT", "The record changed; reload and retry", http_status=409
        )
    settings = get_settings()
    tracked_docx = settings.data_dir / active.docx_path
    from app.core.signature_layout import extract_signature_image_bytes

    image_bytes = extract_signature_image_bytes(tracked_docx, signature_id)
    return Response(
        content=image_bytes, media_type="image/png", headers={"Cache-Control": "no-store"}
    )


@documents_router.get("/{document_id}/signature-editor/candidates/{candidate_id}/image")
def get_signature_editor_candidate_image(
    document_id: int,
    candidate_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Response:
    row = _document_or_404(db, document_id)
    _require_document_record_access(db, user, row)
    if user.role != ADMIN_ROLE:
        raise AppError("FORBIDDEN", "Legacy identification is administrator-only", http_status=403)
    candidate = signature_placement_service.resolve_legacy_candidate(db, document_id, candidate_id)
    legacy_docx = signature_placement_service.resolve_legacy_docx(db, document_id)
    from app.core.signature_layout import extract_candidate_image_bytes

    image_bytes = extract_candidate_image_bytes(legacy_docx, candidate.docpr_name)
    return Response(
        content=image_bytes, media_type="image/png", headers={"Cache-Control": "no-store"}
    )


@documents_router.get("/{document_id}/signature-editor/background")
def get_signature_editor_background(
    document_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    signature_id: str,
    signature_revision: Annotated[int, Query(ge=0)],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """The standalone primary PDF with ONLY *signature_id* hidden — the drag
    preview's background while the client overlays the extracted original
    image on top."""
    row = _document_or_404(db, document_id)
    _require_document_record_access(db, user, row)
    description = signature_placement_service.describe_editor(db, document_id, user=user)
    if not description.can_adjust:
        raise AppError("FORBIDDEN", "Signature editor access is required", http_status=403)
    _version, active = signature_placement_service.resolve_active_artifact(db, document_id)
    if active.revision != signature_revision:
        raise AppError(
            "SIGNATURE_REVISION_CONFLICT", "The record changed; reload and retry", http_status=409
        )
    settings = get_settings()
    tracked_docx = settings.data_dir / active.docx_path
    from app.services import _pdf_executor

    pdf_path = _pdf_executor.render_signature_free_background(
        tracked_docx, signature_id=signature_id
    )
    if (b64 := maybe_base64(pdf_path.read_bytes(), encoding)) is not None:
        return b64
    return FileResponse(
        str(pdf_path), media_type="application/pdf", headers={"Cache-Control": "no-store"}
    )


@documents_router.post(
    "/{document_id}/signature-identifications", response_model=SignatureEditorRead
)
def post_signature_identification(
    document_id: int,
    payload: SignatureIdentifyRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> SignatureEditorRead:
    row = _document_or_404(db, document_id)
    _require_document_record_access(db, user, row)
    description = signature_placement_service.identify_signature(
        db,
        document_id,
        user=user,
        candidate_id=payload.candidate_id,
        signature_revision=payload.signature_revision,
        package_revision=payload.package_revision,
        source_sha256=payload.source_sha256,
    )
    return _editor_read(description)


@documents_router.put(
    "/{document_id}/signatures/{signature_id}/position", response_model=SignatureEditorRead
)
def put_signature_position(
    document_id: int,
    signature_id: str,
    payload: SignaturePositionRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> SignatureEditorRead:
    row = _document_or_404(db, document_id)
    _require_document_record_access(db, user, row)
    description = signature_placement_service.move_signature(
        db,
        document_id,
        user=user,
        signature_id=signature_id,
        signature_revision=payload.signature_revision,
        package_revision=payload.package_revision,
        source_sha256=payload.source_sha256,
        page=payload.page,
        x=payload.x,
        y=payload.y,
    )
    return _editor_read(description)


@documents_router.get("/{document_id}/signature-history", response_model=SignatureHistoryRead)
def get_signature_history(
    document_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> SignatureHistoryRead:
    row = _document_or_404(db, document_id)
    _require_document_record_access(db, user, row)
    rows = signature_placement_service.list_history(db, document_id)
    items = [
        SignatureHistoryItemRead(
            revision=r.revision,
            action=r.action,
            signature_id=r.signature_id,
            before_geometry=r.before_geometry,
            after_geometry=r.after_geometry,
            actor_user_id=r.actor_user_id,
            created_at=r.created_at,
            pdf_download_url=(
                f"/api/v1/documents/{document_id}/signature-history/{r.revision}/download?format=pdf"
                if r.published_pdf_path
                else None
            ),
            docx_download_url=(
                f"/api/v1/documents/{document_id}/signature-history/{r.revision}/download?format=docx"
                if r.docx_path
                else None
            ),
        )
        for r in rows
    ]
    return SignatureHistoryRead(items=items)


@documents_router.get("/{document_id}/signature-history/{revision}/download")
def get_signature_history_download(
    document_id: int,
    revision: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    format: Literal["docx", "pdf"] = Query("pdf"),
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """Serve a retained historical copy. The original signing-path DOCX lock
    still applies here — a DOCX from an ``approval`` source_kind is never
    served to a non-admin, matching the live download endpoint's rule."""
    row = _document_or_404(db, document_id)
    _require_document_record_access(db, user, row)
    history_row = signature_placement_service.resolve_history_revision(db, document_id, revision)
    if (
        format == "docx"
        and history_row.source_kind == signature_placement_service.SOURCE_KIND_APPROVAL
        and user.role != ADMIN_ROLE
    ):
        raise AppError(
            "DOCX_LOCKED_AFTER_SIGNING",
            "This document is signed; the editable DOCX is locked",
            http_status=status.HTTP_403_FORBIDDEN,
        )
    settings = get_settings()
    if format == "pdf":
        rel_path = history_row.published_pdf_path or history_row.primary_pdf_path
        media_type = "application/pdf"
    else:
        rel_path = history_row.docx_path
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if not rel_path:
        raise NotFoundError(
            "FILE_NOT_FOUND", f"No {format} retained for revision {revision}", id=document_id
        )
    file_path = settings.data_dir / rel_path
    if not file_path.is_file():
        raise NotFoundError(
            "FILE_NOT_FOUND", f"No {format} retained for revision {revision}", id=document_id
        )
    if (b64 := maybe_base64(file_path.read_bytes(), encoding)) is not None:
        return b64
    return FileResponse(
        str(file_path),
        media_type=media_type,
        filename=file_path.name,
        headers={"Cache-Control": "no-store"},
    )
