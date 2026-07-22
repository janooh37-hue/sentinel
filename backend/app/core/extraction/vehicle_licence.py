"""Best-effort parser for a UAE vehicle licence (mulkiya).

ponytail: label-anchored regex over OCR'd `ara+eng` text — no ML. Real scans
vary by emirate and OCR is noisy, so this is an *assist*: the operator confirms
every field in the form. Upgrade path: OpenCV field-crop + per-field OCR.
"""

from __future__ import annotations

import re

from app.core.extraction.dates import parse_date

# (label variants) : (dict key, post-processor)
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r"(?i)(?:traffic\s+)?plate\s*(?:no\.?|number)\s*[:\-]?\s*([A-Z]{0,3}\s?\d{1,6})"
        ),
        "plate_no",
    ),
    (
        re.compile(
            r"(?i)(?:place\s+of\s+issue|emirate|source)\s*[:\-]?\s*([A-Za-z ]{3,20}?)(?=\n|$)"
        ),
        "plate_emirate",
    ),
    (
        re.compile(r"(?i)(?:plate\s+)?(?:category|class)\s*[:\-]?\s*([A-Za-z ]{3,20})"),
        "plate_category",
    ),
    (re.compile(r"(?i)T\.?C\.?\s*(?:no\.?|number)?\s*[:\-]?\s*(\d{4,10})"), "traffic_no"),
    (re.compile(r"(?i)(?:model|make)\s*[:\-]?\s*([A-Za-z0-9 .\-]{2,40})"), "make_model"),
    (re.compile(r"(?i)type\s*[:\-]?\s*([A-Za-z ]{3,20})"), "vehicle_type"),
    (re.compile(r"(?i)colou?r\s*[:\-]?\s*([A-Za-z ]{3,20})"), "colour"),
    (re.compile(r"(?i)owner\s*[:\-]?\s*([A-Za-z][A-Za-z .'\-]{2,60})"), "owner_name"),
]
_EXPIRY_RE = re.compile(
    r"(?i)(?:reg\.?\s*)?(?:expiry|exp)\s*(?:date)?\s*[:\-]?\s*(\d{2}[/-]\d{2}[/-]\d{4})"
)


def extract_vehicle_licence(text: str) -> dict[str, str]:
    if not text or not text.strip():
        return {}
    out: dict[str, str] = {}
    for rx, key in _PATTERNS:
        m = rx.search(text)
        if m:
            out[key] = m.group(1).strip()
    m = _EXPIRY_RE.search(text)
    if m:
        d = parse_date(m.group(1))
        if d:
            out["reg_expiry"] = d.isoformat()
    return out
