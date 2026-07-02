"""Printed-field fallback for passport numbers.

Used when a scan has no clean MRZ. Reads a *labelled* passport number from OCR
text (English or Arabic label). Lower confidence than MRZ — callers must NOT
auto-write these (see passport_ocr_service write policy).
"""

from __future__ import annotations

import re

# Label variants, then optional separator, then the candidate token.
# Token: 6-12 chars of A-Z/0-9 with at least one digit (passport numbers vary
# by country but always contain digits).
_LABELS = r"(?:passport\s*(?:no|number|#)|رقم\s*(?:ال)?جواز(?:\s*السفر)?)"
_PATTERN = re.compile(
    rf"{_LABELS}\s*[:#\-]?\s*([A-Z0-9]{{6,12}})",
    re.IGNORECASE,
)


def extract_printed_passport_no(text: str) -> tuple[str, str] | None:
    """Return (number, source_snippet) for a labelled passport number, or None."""
    for m in _PATTERN.finditer(text):
        token = m.group(1).upper()
        if any(ch.isdigit() for ch in token):
            snippet = text[max(0, m.start() - 10) : m.end() + 10].strip()
            return token, snippet
    return None
