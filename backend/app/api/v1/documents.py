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

import base64
import logging
from datetime import datetime
from typing import Annotated, Any, Literal

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
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_capability
from app.api.errors import AppError, NotFoundError
from app.config import get_settings
from app.db.models import Document, User
from app.db.session import get_db
from app.schemas._base import ORMBase
from app.services import book_service, document_service, perm_service, staging_service
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
    submission_id: str | None = None
    documents: list[JobDocumentItem] | None = None
    error_code: str | None = None
    error_message: str | None = None


class DocumentRead(ORMBase):
    id: int
    # Nullable: admin-category docs (e.g. General Book) have no employee.
    employee_id: str | None = None
    template_id: str
    ref_number: str
    docx_path: str
    pdf_path: str | None = None
    created_at: datetime
    leave_id: int | None = None
    violation_id: int | None = None
    submission_id: str
    role: Literal["primary", "companion"]


# ---------------------------------------------------------------------------
# Background task
# ---------------------------------------------------------------------------


def _run_generation(
    job_id: str,
    request: DocumentGenerateRequest,
    db: Session,
    current_user: User | None = None,
) -> None:
    """Execute the generation pipeline; called by BackgroundTasks."""
    set_running(job_id)
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
            revise_of_book_id=request.revise_of_book_id,
            attachments=request.attachments,
        )
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
            submission_id=result.submission_id,
            documents=registry_docs,
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
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.generate"))],
) -> DocumentGenerateResponse:
    job_id = submit_job()
    # Pass db directly — BackgroundTasks runs in the same thread pool so the
    # session stays alive.  The background task closes it when done.
    # `user` is threaded so the service can stamp the submitter's G-number
    # into the General Book footer (template token: {{ submitter_g }}).
    background_tasks.add_task(_run_generation, job_id, payload, db, user)
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
        job_id=job.job_id,
        status=job.status,
        submission_id=job.submission_id,
        documents=pydantic_docs,
        error_code=job.error_code,
        error_message=job.error_message,
    )


@documents_router.get("/{document_id}", response_model=DocumentRead)
def get_document(
    document_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> DocumentRead:
    row: Document | None = db.get(Document, document_id)

    # Mirror download_document's gate: signed/locked docs require books.view
    # (so signers/viewers can read metadata without documents.generate);
    # unsigned (or missing) docs preserve the documents.generate gate. The
    # cap check runs before the 404 so a denied caller can't probe doc ids.
    locked = (
        book_service.is_document_signed_locked(db, document_id)[0] if row is not None else False
    )
    required_cap = "books.view" if locked else "documents.generate"
    if not perm_service.has_capability(db, user, required_cap):
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

    return DocumentRead.model_validate(row)


@documents_router.get("/{document_id}/download")
def download_document(
    document_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    format: Literal["docx", "pdf"] = Query("pdf"),
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """Stream a generated document (PDF or DOCX).

    ``encoding=base64`` returns the file bytes base64-encoded as ``text/plain``
    — the in-app PDF preview uses this so the response body never carries a
    ``%PDF`` magic-byte stream. Browser PDF handlers and download accelerators
    (notably **Internet Download Manager**, which sniffs the URL+content-type
    and intercepts the request, returning an empty 204 to the JS ``fetch``)
    would otherwise hijack the bytes and the canvas would never render. The
    ledger team uses the same trick — see ``/ledger/.../attachments/by-index``.
    """
    row: Document | None = db.get(Document, document_id)
    if row is None:
        raise NotFoundError(
            "DOCUMENT_NOT_FOUND",
            f"Document {document_id} not found",
            id=document_id,
        )

    settings = get_settings()

    _DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    # Once a version is SIGNED, the editable DOCX is locked: deny it, and serve
    # the signed artifact for any other format. The signed artifact may be a
    # .pdf (normal) or a .docx fallback (when PDF conversion is unavailable), so
    # derive the media type / extension from the artifact's real suffix.
    locked, signed_rel = book_service.is_document_signed_locked(db, document_id)

    # In-handler authorization: signed/locked docs require books.view (so
    # signers/viewers can retrieve the artifact without documents.generate);
    # unsigned docs preserve the existing documents.generate gate.
    required_cap = "books.view" if locked else "documents.generate"
    if not perm_service.has_capability(db, user, required_cap):
        raise AppError(
            "FORBIDDEN",
            "You don't have permission to download this document",
            http_status=status.HTTP_403_FORBIDDEN,
        )

    if locked and signed_rel is not None:
        if format == "docx":
            raise AppError(
                "DOCX_LOCKED_AFTER_SIGNING",
                "This document is signed; the editable DOCX is locked",
                http_status=status.HTTP_403_FORBIDDEN,
            )
        file_path = settings.data_dir / signed_rel
        if signed_rel.lower().endswith(".docx"):
            media_type = _DOCX_MEDIA_TYPE
            ext = ".docx"
        else:
            media_type = "application/pdf"
            ext = ".pdf"
    elif format == "pdf" and row.pdf_path:
        file_path = settings.data_dir / row.pdf_path
        media_type = "application/pdf"
        ext = ".pdf"
    elif format == "pdf":
        # PDF explicitly requested but conversion never produced one (e.g. a
        # DRAFT preview on a host without Word). Return a clean signal instead
        # of silently serving DOCX bytes mislabeled as a PDF — the caller can
        # branch to the "PDF unavailable, download DOCX" state.
        raise NotFoundError(
            "PDF_NOT_AVAILABLE",
            f"No PDF rendition exists for document {document_id}",
            id=document_id,
        )
    else:
        file_path = settings.data_dir / row.docx_path
        media_type = _DOCX_MEDIA_TYPE
        ext = ".docx"

    # B2: containment check — refuse to serve paths that resolve outside data_dir.
    # A corrupt/tampered DB path (e.g. "../../etc/passwd") could otherwise escape.
    _data_dir_resolved = settings.data_dir.resolve()
    try:
        _file_resolved = file_path.resolve()
    except OSError:
        _file_resolved = file_path
    if _data_dir_resolved not in _file_resolved.parents and _file_resolved != _data_dir_resolved:
        raise NotFoundError(
            "FILE_NOT_FOUND",
            f"File not found on disk for document {document_id}",
            id=document_id,
        )

    if not file_path.is_file():
        raise NotFoundError(
            "FILE_NOT_FOUND",
            f"File not found on disk for document {document_id}",
            id=document_id,
        )

    # base64 branch — opaque text/plain body that PDF handlers / download
    # accelerators won't claim. The frontend canvas decodes + renders.
    if encoding == "base64":
        return Response(
            content=base64.b64encode(file_path.read_bytes()),
            media_type="text/plain",
            headers={"X-Content-Type-Options": "nosniff"},
        )

    filename = document_service.download_filename_for(row, ext)
    # PDFs are served inline so the preview iframe can render them; the
    # frontend uses <a download> for explicit downloads which overrides
    # disposition client-side. DOCX always downloads.
    disposition = "inline" if format == "pdf" else "attachment"
    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=filename,
        content_disposition_type=disposition,
    )
