"""Shared plate-string parsing, mirroring the frontend's `parsePlate`.

One typed/OCR'd/imported plate string → the two API fields. Accepts `58216`,
`14 \\ 58216`, `14/58216`, and `14-58216`, in either Arabic or Latin digits.
Returns ``None`` when the input is not a recognizable plate (junk stays
manual/reviewable rather than being coerced), never invents/pads digits from
another vehicle.
"""

from __future__ import annotations

import re

from app.core.extraction.vehicle_licence import normalize_arabic_digits

_PLATE_RE = re.compile(r"^(?:(\d{1,3})\s*[\\/-]\s*)?(\d{1,6})$")


def parse_plate(raw: str) -> tuple[str | None, str] | None:
    """Split ``raw`` into ``(plate_code, plate_number)``, or ``None`` if unparseable."""
    normalized = re.sub(r"\s+", " ", normalize_arabic_digits(raw)).strip()
    match = _PLATE_RE.match(normalized)
    if not match:
        return None
    return match.group(1), match.group(2)
