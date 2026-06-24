from __future__ import annotations

import re

from app.core.extraction.dates import parse_date
from app.core.extraction.types import DocType, ExtractedField, Extraction

# ── v1 fallback patterns (synthetic / DHA format) ─────────────────────────────
_FROM_RE = re.compile(r"From\s*Date\s*:?\s*(\d{2}[/-]\d{2}[/-]\d{4})", re.IGNORECASE)
_TO_RE = re.compile(r"To\s*Date\s*:?\s*(\d{2}[/-]\d{2}[/-]\d{4})", re.IGNORECASE)
_DAYS_RE = re.compile(r"(?:Number of Days|Days)\s*:?\s*(\d{1,3})", re.IGNORECASE)
_CERT_RE = re.compile(r"Certificate\s*No\.?\s*:?\s*([A-Za-z0-9-]+)", re.IGNORECASE)
_CLINIC_RE = re.compile(r"Clinic\s*:?\s*(.+)", re.IGNORECASE)

# ── DOH / Abu Dhabi primary patterns ──────────────────────────────────────────
# "Sick Leave From : 23/10/2025 to 24/10/2025"
_DOH_FROM_RE = re.compile(
    r"Sick\s*Leave\s*From\s*[:=]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})",
    re.IGNORECASE,
)
_DOH_TO_RE = re.compile(
    r"Sick\s*Leave\s*From\s*[:=]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{4}\s+to\s+(\d{1,2}[/-]\d{1,2}[/-]\d{4})",
    re.IGNORECASE,
)
# "Sick Leave Period = 2 Days" (colon or equals)
_DOH_PERIOD_RE = re.compile(
    r"Sick\s*Leave\s*Period\s*[:=]?\s*(\d{1,3})\s*Days?",
    re.IGNORECASE,
)
# "Reference No : RSLC-2025-00084330"
_DOH_REF_RE = re.compile(
    r"Reference\s*No\.?\s*[:=]?\s*([A-Z0-9][A-Z0-9-]+)",
    re.IGNORECASE,
)
# "Facility Name : NMC ROYAL MEDICAL CENTER LTD - BRANCH AL SHAHAMA <Arabic>"
_DOH_FACILITY_RE = re.compile(
    r"Facility\s*Name\s*[:=]?\s*([^\n]+)",
    re.IGNORECASE,
)
# "IDNo: 784000012345678" — no space between ID and No
_DOH_ID_RE = re.compile(r"ID\s*No\.?\s*[:=]?\s*(\d{15})")
# "Patient's Name : AHMED HASSAN AL! ALI <Arabic>"
_DOH_NAME_RE = re.compile(
    r"Patient'?s?\s*Name\s*[:=]?\s*([A-Z][A-Za-z .'!-]{3,})",
    re.IGNORECASE,
)


def _trim_trailing_nonascii(s: str) -> str:
    """Remove trailing non-ASCII characters and punctuation (Arabic garble)."""
    # Strip from the first non-ASCII character run at the end
    cleaned = re.sub(r"[^\x00-\x7F]+.*$", "", s)
    return cleaned.strip(" -,;:")


def _normalise_name(raw: str) -> str:
    """Strip OCR noise from a patient name: stray '!', extra spaces, trailing punct."""
    name = raw.replace("!", "").strip()
    name = re.sub(r"\s{2,}", " ", name)
    name = name.rstrip(" .,;:-")
    return name


def extract_sick_leave(text: str) -> Extraction:
    out: list[ExtractedField] = []

    # ── DOH: date range from single "Sick Leave From … to …" line ─────────────
    m_from = _DOH_FROM_RE.search(text)
    m_to = _DOH_TO_RE.search(text)
    if m_from:
        d = parse_date(m_from.group(1))
        if d:
            out.append(ExtractedField("leave_from", d.isoformat(), 0.9, m_from.group(0)))
    if m_to:
        d = parse_date(m_to.group(1))
        if d:
            out.append(ExtractedField("leave_to", d.isoformat(), 0.9, m_to.group(0)))

    # ── DOH: period ───────────────────────────────────────────────────────────
    m_period = _DOH_PERIOD_RE.search(text)
    if m_period:
        out.append(ExtractedField("leave_days", m_period.group(1), 0.9, m_period.group(0)))

    # ── DOH: reference (maps to certificate_no) ───────────────────────────────
    m_ref = _DOH_REF_RE.search(text)
    if m_ref:
        out.append(ExtractedField("certificate_no", m_ref.group(1), 0.85, m_ref.group(0)))

    # ── DOH: facility (maps to clinic) ────────────────────────────────────────
    m_fac = _DOH_FACILITY_RE.search(text)
    if m_fac:
        facility = _trim_trailing_nonascii(m_fac.group(1))
        if facility:
            out.append(ExtractedField("clinic", facility, 0.7, m_fac.group(0)))

    # ── DOH: patient ID + name for employee matching ──────────────────────────
    m_id = _DOH_ID_RE.search(text)
    if m_id:
        out.append(ExtractedField("uae_id_no", m_id.group(1), 0.8, m_id.group(0)))

    m_name = _DOH_NAME_RE.search(text)
    if m_name:
        name = _normalise_name(m_name.group(1))
        name = _trim_trailing_nonascii(name)
        if name:
            out.append(ExtractedField("name_en", name, 0.8, m_name.group(0)))

    # ── v1 fallbacks: run only for fields not yet populated ────────────────────
    populated = {f.key for f in out}

    if "leave_from" not in populated:
        m = _FROM_RE.search(text)
        if m:
            d = parse_date(m.group(1))
            if d:
                out.append(ExtractedField("leave_from", d.isoformat(), 0.9, m.group(0)))

    if "leave_to" not in populated:
        m = _TO_RE.search(text)
        if m:
            d = parse_date(m.group(1))
            if d:
                out.append(ExtractedField("leave_to", d.isoformat(), 0.9, m.group(0)))

    if "leave_days" not in populated:
        m = _DAYS_RE.search(text)
        if m:
            out.append(ExtractedField("leave_days", m.group(1).strip(), 0.9, m.group(0)))

    if "certificate_no" not in populated:
        m = _CERT_RE.search(text)
        if m:
            out.append(ExtractedField("certificate_no", m.group(1).strip(), 0.85, m.group(0)))

    if "clinic" not in populated:
        m = _CLINIC_RE.search(text)
        if m:
            out.append(ExtractedField("clinic", m.group(1).strip(), 0.7, m.group(0)))

    return Extraction(
        doc_type=DocType.SICK_LEAVE,
        doc_type_confidence=0.85 if out else 0.4,
        fields=out,
        raw_text=text,
        language="en",
    )
