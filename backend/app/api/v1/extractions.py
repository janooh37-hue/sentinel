from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.api.errors import ValidationFailedError
from app.core.extraction.ocr import InvalidImageError
from app.db.models import DocumentExtraction, Employee
from app.db.session import get_db
from app.schemas.extraction import ExtractedFieldOut, ExtractionResponse
from app.services.document_reader import read_document
from app.services.extraction_service import run_pipeline
from app.services.vault_service import MAX_UPLOAD_BYTES

router = APIRouter(prefix="/extractions", tags=["extractions"])


@router.post("", response_model=ExtractionResponse)
def create_extraction(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[object, Depends(require_capability("documents.scan"))],
    file: Annotated[UploadFile, File()],
) -> ExtractionResponse:
    raw = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValidationFailedError(
            "EXTRACTION_FILE_TOO_LARGE",
            f"File exceeds {MAX_UPLOAD_BYTES} bytes",
            max_bytes=MAX_UPLOAD_BYTES,
        )
    try:
        read = read_document(raw)
    except InvalidImageError as exc:
        raise ValidationFailedError("INVALID_IMAGE", str(exc)) from exc
    if read.text_source == "unavailable":
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, read.unavailable_reason)

    employees = list(db.execute(select(Employee)).scalars())
    result = run_pipeline(ocr_text=read.text, employees=employees)
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

    matched = next((e for e in employees if e.id == result.matched_employee_id), None)

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
