from __future__ import annotations

import logging
import re

from app.core.extraction.dates import parse_mrz_date
from app.core.extraction.types import DocType, ExtractedField, Extraction

log = logging.getLogger(__name__)
_warned_missing_mrz = False

# TD3 = two lines of exactly 44 chars from [A-Z0-9<]. Line 1 starts with P.
_MRZ_CHARS = re.compile(r"^[A-Z0-9<]{30,44}$")


def find_mrz_lines(text: str) -> str | None:
    """Return the 2-line TD3 MRZ block from noisy OCR text, or None."""
    candidates = [
        ln.strip().replace(" ", "")
        for ln in text.upper().splitlines()
        if _MRZ_CHARS.match(ln.strip().replace(" ", "")) and "<" in ln
    ]
    for i in range(len(candidates) - 1):
        if candidates[i].startswith("P"):
            return f"{candidates[i]}\n{candidates[i + 1]}"
    return None


def extract_passport(text: str) -> Extraction | None:
    global _warned_missing_mrz
    lines = find_mrz_lines(text)
    if lines is None:
        return None

    try:
        from mrz.checker.td3 import TD3CodeChecker
    except ImportError:
        if not _warned_missing_mrz:
            log.warning(
                "mrz package not installed — passport MRZ extraction disabled. "
                "Install mrz>=0.6.2 to enable passport number/expiry OCR."
            )
            _warned_missing_mrz = True
        return None

    try:
        checker = TD3CodeChecker(lines)
    except Exception:
        return None
    valid = bool(checker)
    conf = 0.95 if valid else 0.55
    f = checker.fields()

    expiry = parse_mrz_date(f.expiry_date)
    dob = parse_mrz_date(f.birth_date)
    # Partial/garbled MRZ can leave these None — guard before .replace().
    given = (f.name or "").replace("<", " ").strip()
    surname = (f.surname or "").replace("<", " ").strip()
    doc_no = (f.document_number or "").replace("<", "")

    fields = [
        ExtractedField("name_en", f"{given} {surname}".strip(), conf),
        ExtractedField("passport_no", doc_no, conf),
        ExtractedField("nationality", f.nationality or "", conf),
    ]
    if dob:
        fields.append(ExtractedField("dob", dob.isoformat(), conf))
    if expiry:
        fields.append(ExtractedField("expiry", expiry.isoformat(), conf))

    return Extraction(
        doc_type=DocType.PASSPORT,
        doc_type_confidence=conf,
        fields=fields,
        raw_text=text,
        language="en",
    )
