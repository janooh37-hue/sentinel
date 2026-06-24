from __future__ import annotations

import re

from app.core.extraction.dates import parse_date
from app.core.extraction.types import DocType, ExtractedField, Extraction

_ID_RE = re.compile(r"784-\d{4}-\d{7}-\d")
_NAME_EN_RE = re.compile(r"Name\s*:?\s*([A-Za-z][A-Za-z .'-]+)")
_NAME_AR_RE = re.compile(r"الاسم\s*:?\s*([؀-ۿ][؀-ۿ ]+)")
_NAT_RE = re.compile(r"Nationality\s*:?\s*([A-Za-z ]+)")
_DOB_RE = re.compile(r"(?:Date of Birth|D\.?O\.?B)\s*:?\s*(\d{2}[/-]\d{2}[/-]\d{4})")
_EXP_RE = re.compile(r"Expiry(?:\s*Date)?\s*:?\s*(\d{2}[/-]\d{2}[/-]\d{4})")


def _field(key: str, m: re.Match[str] | None, conf: float) -> ExtractedField | None:
    if not m:
        return None
    return ExtractedField(key, m.group(1).strip(), conf, source_snippet=m.group(0))


def extract_emirates_id(text: str) -> Extraction:
    out: list[ExtractedField] = []

    id_m = _ID_RE.search(text)
    if id_m:
        # structured + checkable format → high confidence
        out.append(ExtractedField("uae_id_no", id_m.group(), 0.97, id_m.group()))

    # names are proper nouns → lower confidence (operator confirms)
    for key, m in (("name_en", _NAME_EN_RE.search(text)),
                   ("name_ar", _NAME_AR_RE.search(text))):
        f = _field(key, m, 0.6)
        if f:
            out.append(f)

    nat = _field("nationality", _NAT_RE.search(text), 0.75)
    if nat:
        out.append(nat)

    for key, m in (("dob", _DOB_RE.search(text)), ("expiry", _EXP_RE.search(text))):
        if m:
            d = parse_date(m.group(1))
            if d:
                out.append(ExtractedField(key, d.isoformat(), 0.9, m.group(0)))

    return Extraction(
        doc_type=DocType.EMIRATES_ID,
        doc_type_confidence=0.9 if id_m else 0.5,
        fields=out,
        raw_text=text,
        language="ar+en",
    )
