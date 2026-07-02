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

from app.core.extraction.ocr import OcrUnavailableError, ocr_bytes_to_text
from app.core.extraction.passport_mrz import extract_passport
from app.core.extraction.passport_printed import extract_printed_passport_no
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
    """OCR the employee's newest passport scan → result. None if no scan."""
    filename = _newest_passport_scan(g_number)
    if filename is None:
        return None

    path: Path = vault_service.resolve_file(g_number, "passport", filename)
    try:
        text = ocr_bytes_to_text(path.read_bytes())
    except OcrUnavailableError:
        log.warning("passport OCR unavailable for %s", g_number)
        return PassportExtractResult(None, 0.0, "none", None, filename)

    mrz = extract_passport(text)
    if mrz is not None:
        f = mrz.field("passport_no")
        if f and f.value:
            return PassportExtractResult(
                f.value[:64], mrz.doc_type_confidence, "mrz", None, filename
            )

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
