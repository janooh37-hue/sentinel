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
    text_from_pdf,
)
from app.db.models import DocumentExtraction, Employee
from app.db.session import get_db
from app.schemas.extraction import ExtractedFieldOut, ExtractionResponse
from app.services.extraction_service import run_pipeline

router = APIRouter(prefix="/extractions", tags=["extractions"])

# Alias to the shared module-level gate so all OCR paths share ONE cap of 2.
_OCR_GATE = OCR_GATE


def _ocr_file(raw: bytes) -> str:
    """OCR *raw* bytes to text. Sniffs the magic number rather than trusting the
    client ``content_type``: a real PDF starts with ``%PDF`` and is handled via
    its embedded text layer first; everything else is loaded as an image.
    """
    if raw.startswith(b"%PDF"):
        # Prefer a born-digital / searchable PDF's embedded text layer over
        # re-OCR (which mangles stamped refs) — see ocr.text_from_pdf.
        return text_from_pdf(raw)
    return extract_text(load_image(raw)).text


@router.post("", response_model=ExtractionResponse)
def create_extraction(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[object, Depends(require_capability("documents.scan"))],
    file: Annotated[UploadFile, File()],
) -> ExtractionResponse:
    raw = file.file.read()
    with _OCR_GATE:
        try:
            text = _ocr_file(raw)
        except OcrUnavailableError as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
        except InvalidImageError as exc:
            raise ValidationFailedError("INVALID_IMAGE", str(exc)) from exc

    employees = list(db.execute(select(Employee)).scalars())
    result = run_pipeline(ocr_text=text, employees=employees)  # type: ignore[arg-type]
    ex = result.extraction

    row = DocumentExtraction(
        document_type=ex.doc_type.value,
        fields={f.key: f.value for f in ex.fields},
        raw_text=ex.raw_text,
        confidence=ex.doc_type_confidence,
        language=ex.language,
        status="needs_review",
        employee_id=result.matched_employee_id,
        source_file=file.filename,
        model_version="tesseract-v1",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    matched = next(
        (e for e in employees if e.id == result.matched_employee_id), None
    )

    return ExtractionResponse(
        id=row.id,
        document_type=ex.doc_type.value,
        document_type_confidence=ex.doc_type_confidence,
        alternatives=[a.value for a in ex.alternatives],
        fields=[
            ExtractedFieldOut(
                key=f.key,
                value=f.value,
                confidence=f.confidence,
                source_snippet=f.source_snippet,
            )
            for f in ex.fields
        ],
        matched_employee_id=result.matched_employee_id,
        match_score=result.match_score,
        matched_employee_name_en=matched.name_en if matched else None,
        matched_employee_name_ar=getattr(matched, "name_ar", None) if matched else None,
    )
