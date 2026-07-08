"""Resolve an employee's stored passport scan → passport number.

Reuses the extraction pipeline: OCR the newest passport-kind vault file, try
the checksum-validated MRZ parser first, then a labelled printed-field
fallback. Never writes on its own — `apply_passport_extraction` owns the
write policy (auto-write only validated MRZ into an empty field).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.extraction.ocr import (
    InvalidImageError,
    OcrUnavailableError,
    ocr_bytes_to_text,
)
from app.core.extraction.passport_mrz import extract_passport
from app.core.extraction.passport_printed import extract_printed_passport_no
from app.core.extraction.passport_scan import (
    MrzCandidate,
    best_mrz,
    best_printed_number,
    pages_from_bytes,
)
from app.db.models import Employee
from app.services import vault_service

log = logging.getLogger(__name__)

# Auto-write threshold: the MRZ parser returns 0.95 for a checksum-valid block
# and 0.55 for a structurally-sound but failing one. Only the former auto-writes.
MRZ_AUTOWRITE_CONFIDENCE = 0.9


@dataclass(frozen=True)
class PassportExtractResult:
    number: str | None
    confidence: float
    method: str  # "mrz" | "printed" | "none"
    source_snippet: str | None
    scan_filename: str


def _newest_passport_scan(g_number: str) -> str | None:
    """Filename of the most-recently-modified passport-kind vault file, or None."""
    tree = vault_service.list_tree(g_number)
    entries = tree.folders.get("passport", [])
    if not entries:
        return None
    return max(entries, key=lambda e: e.modified).filename


def extract_passport_for_employee(db: Session, g_number: str) -> PassportExtractResult | None:
    """OCR the employee's newest passport scan → result. None if no scan.

    Escalating: a cheap upright pass first (fast for clean docs); on failure,
    rasterise and brute-force rotations with per-page MRZ checksum scoring; a
    labelled-number printed read is the last, review-only resort.
    """
    filename = _newest_passport_scan(g_number)
    if filename is None:
        return None

    path: Path = vault_service.resolve_file(g_number, "passport", filename)
    raw = path.read_bytes()

    # Step 1 — cheap upright pass. A checksum-valid MRZ here returns immediately.
    try:
        text = ocr_bytes_to_text(raw)
    except OcrUnavailableError:
        log.warning("passport OCR unavailable for %s", g_number)
        return PassportExtractResult(None, 0.0, "none", None, filename)
    except InvalidImageError:
        return PassportExtractResult(None, 0.0, "none", None, filename)

    cheap = extract_passport(text)
    if cheap is not None:
        f = cheap.field("passport_no")
        if f and f.value and cheap.doc_type_confidence >= MRZ_AUTOWRITE_CONFIDENCE:
            return PassportExtractResult(
                f.value[:64], cheap.doc_type_confidence, "mrz", None, filename
            )

    # Step 2 — escalate: rotation brute-force + per-page checksum scoring.
    try:
        pages = pages_from_bytes(raw)
    except InvalidImageError:
        pages = []

    structural: PassportExtractResult | None = None
    if pages:
        try:
            cand: MrzCandidate | None = best_mrz(pages)
        except OcrUnavailableError:
            return PassportExtractResult(None, 0.0, "none", None, filename)
        if cand is not None:
            snippet = f"page {cand.page_index + 1}, rotation {cand.rotation}°"
            result = PassportExtractResult(cand.number, cand.confidence, "mrz", snippet, filename)
            if cand.valid:
                return result
            structural = result

    # Fall back to the cheap pass's structural (checksum-failing) MRZ if escalation
    # produced nothing. Both are review-only (below the auto-write threshold).
    if structural is None and cheap is not None:
        f = cheap.field("passport_no")
        if f and f.value:
            structural = PassportExtractResult(
                f.value[:64], cheap.doc_type_confidence, "mrz", None, filename
            )
    if structural is not None:
        return structural

    # Step 3 — printed fallback: per page when we have rasters, else the cheap
    # concatenated text. Review-only; never auto-written.
    try:
        printed = best_printed_number(pages) if pages else None
    except OcrUnavailableError:
        return PassportExtractResult(None, 0.0, "none", None, filename)
    if printed is None:
        printed = extract_printed_passport_no(text)
    if printed is not None:
        number, snippet = printed
        return PassportExtractResult(number[:64], 0.5, "printed", snippet, filename)

    return PassportExtractResult(None, 0.0, "none", None, filename)


def apply_passport_extraction(
    db: Session,
    employee: Employee,
    result: PassportExtractResult,
    *,
    allow_overwrite: bool = False,
) -> bool:
    """Write only a validated-MRZ number into an empty field. Returns True if written."""
    if result.method != "mrz" or not result.number:
        return False
    if result.confidence < MRZ_AUTOWRITE_CONFIDENCE:
        return False
    if employee.passport_no and not allow_overwrite:
        return False
    employee.passport_no = result.number
    employee.passport_no_source = "mrz"
    db.commit()
    return True
