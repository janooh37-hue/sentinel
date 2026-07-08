"""Image-level passport MRZ extraction: rotation brute-force + per-page
checksum scoring.

Classical OCR of a passport fails on three fronts the office actually hits:
non-upright pages, phone-photo/scan quality, and a cover page hiding the real
bio-data page (page 2+ of a PDF/scan). This module rasterises each page,
tries every 90° rotation, runs an MRZ-optimised Tesseract pass, and scores the
result by the TD3 checksum — so the page and orientation that yield a valid MRZ
are selected automatically. Fully offline; no new dependencies.

Injectable seams for tests: ``ocr_mrz_pass``, ``extract_passport``,
``extract_text``, ``_orientations`` are module-level names so tests can
monkeypatch them without a real Tesseract.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from PIL import Image

from app.core.extraction.ocr import (
    OCR_GATE,
    OcrUnavailableError,
    _resolve_tesseract_cmd,
    load_image,
    pdf_to_images,
)

log = logging.getLogger(__name__)

# Cap pages scanned per document so a pathological large PDF can't run away.
MAX_PAGES = 8
# MRZ reads better at higher DPI than the general 200-DPI rasterise.
PASSPORT_DPI = 300
# The MRZ is OCR-B on [A-Z0-9<]; restricting the charset (and dropping Arabic,
# which corrupts the Latin MRZ font) is the single biggest accuracy lever.
_MRZ_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
_MRZ_CONFIG = f"--psm 6 -c tessedit_char_whitelist={_MRZ_WHITELIST}"


@dataclass(frozen=True)
class MrzCandidate:
    number: str
    confidence: float
    valid: bool
    page_index: int
    rotation: int


def pages_from_bytes(raw: bytes) -> list[Image.Image]:
    """Rasterise a passport upload to a capped list of page images.

    A ``%PDF`` upload is rasterised at :data:`PASSPORT_DPI`; anything else is
    loaded as a single image. Capped to :data:`MAX_PAGES`. Corrupt input raises
    :class:`InvalidImageError` (the caller degrades to a review result).
    """
    images = pdf_to_images(raw, dpi=PASSPORT_DPI) if raw.startswith(b"%PDF") else [load_image(raw)]
    return images[:MAX_PAGES]


def ocr_mrz_pass(image: Image.Image) -> str:
    """MRZ-optimised Tesseract pass (English only, --psm 6, whitelist charset).

    Acquires the shared OCR gate for the single call so a multi-page brute
    force can't starve a concurrent live upload. Raises
    :class:`OcrUnavailableError` when the Tesseract binary is missing.
    """
    cmd = _resolve_tesseract_cmd()
    if cmd is None:
        raise OcrUnavailableError("Tesseract is not installed.")
    import pytesseract

    pytesseract.pytesseract.tesseract_cmd = cmd
    with OCR_GATE:
        return pytesseract.image_to_string(image, lang="eng", config=_MRZ_CONFIG)  # type: ignore[no-any-return]
