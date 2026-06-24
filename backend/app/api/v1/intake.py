"""POST /api/v1/intake — ref-first document intake.

Classifies a scanned file as either a returned GSSG form (Mode 1, matched by
stamped ref) or an external document (Mode 2, Phase-A pipeline).

This endpoint is READ-ONLY: no DB rows are written.  Attaching the signed copy
to a Book is a separate, explicit call (POST /api/v1/books/{id}/attachments).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.api.errors import ValidationFailedError
from app.core.extraction.ocr import (
    OCR_GATE,
    InvalidImageError,
    OcrUnavailableError,
    extract_text,
    load_image,
    qr_refs_from_bytes,
    text_from_pdf,
)
from app.db.models import Employee
from app.db.session import get_db
from app.schemas.intake import ExternalOut, IntakeResponse, ReturnedFormOut, route_for_doc_type
from app.services.intake_service import run_intake
from app.services.vault_service import MAX_UPLOAD_BYTES

router = APIRouter(prefix="/intake", tags=["intake"])

# Alias to the shared module-level gate so tests can assert `intake._OCR_GATE is ocr.OCR_GATE`
# and so all OCR paths (extractions, intake, scan-inbox) share ONE cap of 2.
_OCR_GATE = OCR_GATE


def _ocr_file(raw: bytes) -> str:
    """OCR *raw* bytes to a text string.  Mirrors ``extractions._ocr_file``.

    Sniffs the magic number rather than trusting the client ``content_type``:
    a real PDF starts with ``%PDF``; everything else is handed to ``load_image``,
    whose ``UnidentifiedImageError`` guard rejects non-images as 422.

    A PDF prefers its embedded text layer over re-OCR (``text_from_pdf``) so a
    born-digital / searchable scan whose stamped ref OCRs badly still matches.
    """
    if raw.startswith(b"%PDF"):
        return text_from_pdf(raw)
    return extract_text(load_image(raw)).text


@router.post("", response_model=IntakeResponse)
def intake_document(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[object, Depends(require_capability("documents.scan"))],
    file: Annotated[UploadFile, File()],
) -> ReturnedFormOut | ExternalOut:
    raw = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValidationFailedError(
            "INTAKE_FILE_TOO_LARGE",
            f"File exceeds {MAX_UPLOAD_BYTES} bytes",
            max_bytes=MAX_UPLOAD_BYTES,
        )
    with _OCR_GATE:
        qr_refs = qr_refs_from_bytes(raw)
        try:
            ocr_text = _ocr_file(raw)
        except OcrUnavailableError as exc:
            # QR decode is independent of OCR — if a QR was found, it can still
            # match a Book; only 503 when there's nothing else to go on.
            if not qr_refs:
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
            ocr_text = ""
        except InvalidImageError as exc:
            raise ValidationFailedError("INVALID_IMAGE", str(exc)) from exc

    employees = list(db.execute(select(Employee)).scalars())
    result = run_intake(
        ocr_text=ocr_text, db=db, employees=employees, qr_refs=qr_refs  # type: ignore[arg-type]
    )

    if result.mode == "returned_form":
        book = result.book
        assert book is not None  # invariant: mode=returned_form always has a book
        # Category name from the relationship (may be None for bare categories).
        category_name: str | None = None
        if book.category is not None:
            category_name = book.category.name_en
        return ReturnedFormOut(
            book_id=book.id,
            ref_number=book.ref_number,
            approval_state=book.approval_state,
            category=category_name,
            subject=book.subject,
            employee_id=book.employee_id,
            employee_name=book.employee_name_snapshot,
        )

    # Mode 2 — external
    pr = result.pipeline
    assert pr is not None  # invariant: mode=external always has a pipeline
    ex = pr.extraction

    matched_emp: Employee | None = next(
        (e for e in employees if e.id == pr.matched_employee_id),
        None,
    )

    route_kind_str, form_slug = route_for_doc_type(ex.doc_type.value)
    # Narrow the route_kind to the Literal type expected by ExternalOut.
    from typing import Literal, cast

    route_kind = cast(
        Literal["employee", "salary_transfer", "leave", "manual"],
        route_kind_str,
    )

    from app.schemas.extraction import ExtractedFieldOut

    return ExternalOut(
        document_type=ex.doc_type.value,
        document_type_confidence=ex.doc_type_confidence,
        alternatives=[a.value for a in ex.alternatives],
        extraction=[
            ExtractedFieldOut(
                key=f.key,
                value=f.value,
                confidence=f.confidence,
                source_snippet=f.source_snippet,
            )
            for f in ex.fields
        ],
        matched_employee_id=pr.matched_employee_id,
        match_score=pr.match_score,
        matched_employee_name_en=matched_emp.name_en if matched_emp else None,
        matched_employee_name_ar=getattr(matched_emp, "name_ar", None) if matched_emp else None,
        route_kind=route_kind,
        route_form_slug=form_slug,
    )
