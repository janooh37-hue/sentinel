"""Best-effort parser for a UAE vehicle licence (mulkiya).

ponytail: label-anchored regex over OCR'd `ara+eng` text — no ML. Real scans
vary by emirate and OCR is noisy, so this is an *assist*: the operator confirms
every field in the form. Upgrade path: OpenCV field-crop + per-field OCR.

Two call sites share this module:
- The permit-domain mulkiya scan (`permit_service.scan_vehicle_licence`), which
  only reads the original combined-field dict (`plate_no`, `plate_emirate`,
  `plate_category`, `traffic_no`, `make_model`, `vehicle_type`, `colour`,
  `reg_expiry`, `owner_name`) — untouched by the additions below.
- The vehicle-domain profile scan (`vehicle_profile_scan_service.scan_vehicle_profile`),
  which additionally wants separated `make`/`model`, `model_year`, `vin`,
  `license_start`, and `insurance_expiry` disambiguated from a bare/registration
  expiry — all additive keys, populated only when a labelled match is found.
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
            r"(?i)(?:place\s+of\s+issue|source|\bemirate\b)\s*[:\-]\s*([A-Za-z ]{3,20}?)(?=\n|$)"
        ),
        "plate_emirate",
    ),
    (
        re.compile(r"(?i)(?:plate\s+)?(?:category|class)\s*[:\-]?\s*([A-Za-z ]{3,20})"),
        "plate_category",
    ),
    (re.compile(r"(?i)T\.?C\.?\s*(?:no\.?|number)?\s*[:\-]?\s*(\d{4,10})"), "traffic_no"),
    (re.compile(r"(?i)(?:model|make)\s*[:\-]?\s*([A-Za-z0-9 .\-]{2,40})"), "make_model"),
    (re.compile(r"(?i)\btype\b\s*[:\-]?\s*([A-Za-z ]{3,20})"), "vehicle_type"),
    (re.compile(r"(?i)colou?r\s*[:\-]?\s*([A-Za-z ]{3,20})"), "colour"),
    (re.compile(r"(?i)owner\s*[:\-]?\s*([A-Za-z][A-Za-z .'\-]{2,60})"), "owner_name"),
]
_EXPIRY_RE = re.compile(
    r"(?i)(?:reg\.?\s*)?(?:expiry|exp)\s*(?:date)?\s*[:\-]?\s*(\d{2}[/-]\d{2}[/-]\d{4})"
)

# --- Additive vehicle-profile fields (used only by scan_vehicle_profile) ---
# The fleet's plate scheme is a numeric code + separator + numeric number
# (`14\58216`), distinct from the generic single-value `plate_no` pattern
# above (built for standard letter-category UAE plates like `A 45213`).
_PLATE_CODE_NUMBER_RE = re.compile(
    r"(?i)(?:traffic\s+)?plate\s*(?:no\.?|number)?\s*[:\-]?\s*(\d{1,3})\s*[\\/-]\s*(\d{1,6})"
)
_DATE_GROUP = r"(\d{2}[/-]\d{2}[/-]\d{4})"
_VIN_RE = re.compile(
    r"(?i)(?:vin|chassis\s*(?:no\.?|number)?|رقم\s*الشاصي|رقم\s*الهيكل)\s*[:\-]?\s*"
    r"([A-Z0-9]{5,25})"
)
_MAKE_RE = re.compile(
    r"(?i)\bmake\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 .\-]{1,40})|"
    r"(?:الصنع|الشركة\s*الصانعة)\s*[:\-]?\s*([\u0600-\u06FF][\u0600-\u06FF0-9 .\-]{1,40})"
)
_MODEL_RE = re.compile(
    r"(?i)\bmodel\b(?!\s*year)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9 .\-]{1,40})|"
    r"(?:الموديل|الطراز)(?!\s*السنة)\s*[:\-]?\s*([\u0600-\u06FF][\u0600-\u06FF0-9 .\-]{1,40})"
)
_MODEL_YEAR_RE = re.compile(
    r"(?i)(?:model\s*year|year\s*of\s*manufacture|manufacture\s*year|سنة\s*الصنع)\s*[:\-]?\s*"
    r"(\d{4})"
)
_LICENSE_START_RE = re.compile(
    r"(?i)(?:registration|reg\.?|issue|license\s*start|licence\s*start)\s*date\s*[:\-]?\s*"
    + _DATE_GROUP
    + r"|(?:تاريخ\s*(?:الإصدار|التسجيل))\s*[:\-]?\s*"
    + _DATE_GROUP
)
_INSURANCE_EXPIRY_RE = re.compile(
    r"(?i)insurance\s*(?:expiry|exp\.?|end)\s*(?:date)?\s*[:\-]?\s*"
    + _DATE_GROUP
    + r"|(?:تأمين[^\n]{0,20}?(?:انتهاء|ينتهي)|(?:انتهاء|ينتهي)[^\n]{0,20}?تأمين)\s*[:\-]?\s*"
    + _DATE_GROUP
)
_LICENSE_EXPIRY_RE = re.compile(
    r"(?i)(?:registration|licen[cs]e)\s*(?:expiry|exp\.?)\s*(?:date)?\s*[:\-]?\s*"
    + _DATE_GROUP
    + r"|(?:انتهاء\s*(?:الترخيص|التسجيل))\s*[:\-]?\s*"
    + _DATE_GROUP
)
_TYPE_AR_RE = re.compile(r"(?:نوع\s*المركبة|النوع)\s*[:\-]?\s*([\u0600-\u06FF ]{2,20})")
_CLASS_AR_RE = re.compile(r"(?:فئة\s*المركبة|الفئة)\s*[:\-]?\s*([\u0600-\u06FF ]{2,20})")

_ARABIC_DIGITS = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789",
)


def normalize_arabic_digits(text: str) -> str:
    """Map Arabic-Indic and Extended Arabic-Indic digits to ASCII digits."""
    return text.translate(_ARABIC_DIGITS)


# Canonical Arabic emirate name keyed by its alphabetic OCR aliases (English
# name and the common 3-letter plate abbreviation). The dropdown stores the
# canonical Arabic value and the 1/5 letter renders it directly, so the scan
# must collapse whatever it read onto one of these — else the field is dropped
# and the operator picks. The plate can't tell us the emirate (a number is
# Abu Dhabi or Sharjah, a letter is one of five), so this reads it off the
# licence, not the code.
_EMIRATE_ALIASES: dict[str, str] = {
    "abudhabi": "أبوظبي",
    "dubai": "دبي",
    "dxb": "دبي",
    "sharjah": "الشارقة",
    "shj": "الشارقة",
    "ajman": "عجمان",
    "ajm": "عجمان",
    "ummalquwain": "أم القيوين",
    "uaq": "أم القيوين",
    "rasalkhaimah": "رأس الخيمة",
    "rak": "رأس الخيمة",
    "fujairah": "الفجيرة",
    "fuj": "الفجيرة",
}
_CANON_EMIRATES = frozenset(_EMIRATE_ALIASES.values())


def normalize_emirate(raw: str | None) -> str | None:
    """Map an OCR'd place-of-issue to its canonical Arabic name, or None."""
    if not raw:
        return None
    raw = raw.strip()
    if raw in _CANON_EMIRATES:
        return raw
    return _EMIRATE_ALIASES.get(re.sub(r"[^a-z]", "", raw.lower()))


def _first_group(match: re.Match[str]) -> str:
    return next(group for group in match.groups() if group is not None).strip()


def _date_iso(match: re.Match[str]) -> str | None:
    raw = _first_group(match)
    d = parse_date(raw)
    return d.isoformat() if d else None


def extract_vehicle_licence(text: str) -> dict[str, str]:
    if not text or not text.strip():
        return {}
    text = normalize_arabic_digits(text)
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
    if "plate_emirate" in out:
        canonical = normalize_emirate(out["plate_emirate"])
        if canonical:
            out["plate_emirate"] = canonical
        else:
            del out["plate_emirate"]

    # Additive vehicle-profile fields — never overwrite the permit-compatible
    # keys above; each only sets a new key when it finds a distinct label.
    if m := _PLATE_CODE_NUMBER_RE.search(text):
        out["plate_code"] = m.group(1)
        out["plate_number"] = m.group(2)
    if m := _VIN_RE.search(text):
        out["vin"] = m.group(1).strip().upper()
    if m := _MAKE_RE.search(text):
        out["make"] = _first_group(m)
    if m := _MODEL_RE.search(text):
        out["model"] = _first_group(m)
    if m := _MODEL_YEAR_RE.search(text):
        out["model_year"] = m.group(1)
    if (m := _LICENSE_START_RE.search(text)) and (iso := _date_iso(m)):
        out["license_start"] = iso
    if (m := _INSURANCE_EXPIRY_RE.search(text)) and (iso := _date_iso(m)):
        out["insurance_expiry"] = iso
    if (m := _LICENSE_EXPIRY_RE.search(text)) and (iso := _date_iso(m)):
        out["license_expiry"] = iso
    if m := _TYPE_AR_RE.search(text):
        out["type_ar"] = m.group(1).strip()
    if m := _CLASS_AR_RE.search(text):
        out["class_ar"] = m.group(1).strip()
    return out
