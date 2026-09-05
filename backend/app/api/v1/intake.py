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
from app.core.extraction.ocr import InvalidImageError
from app.db.models import Employee
from app.db.session import get_db
from app.schemas.intake import ExternalOut, IntakeResponse, ReturnedFormOut
from app.services.scan_triage_service import classify, project_intake
from app.services.vault_service import MAX_UPLOAD_BYTES

router = APIRouter(prefix="/intake", tags=["intake"])


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
    employees = list(db.execute(select(Employee)).scalars())
    try:
        result = classify(raw, db=db, employees=employees)
    except InvalidImageError as exc:
        raise ValidationFailedError("INVALID_IMAGE", str(exc)) from exc
    if result.read.text_source == "unavailable" and not result.read.qr_refs:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, result.read.unavailable_reason)
    return project_intake(result)
