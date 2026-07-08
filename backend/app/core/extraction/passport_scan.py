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
from collections.abc import Iterator
from dataclasses import dataclass

from PIL import Image

from app.core.extraction.ocr import (
    OCR_GATE,
    OcrUnavailableError,
    _resolve_tesseract_cmd,
    extract_text,
    load_image,
    pdf_to_images,
)
from app.core.extraction.passport_mrz import extract_passport
from app.core.extraction.passport_printed import extract_printed_passport_no

log = logging.getLogger(__name__)

# Cap pages scanned per document so a pathological large PDF can't run away.
MAX_PAGES = 8
# MRZ reads better at higher DPI than the general 200-DPI rasterise.
PASSPORT_DPI = 300
# The MRZ is OCR-B on [A-Z0-9<]; restricting the charset (and dropping Arabic,
# which corrupts the Latin MRZ font) is the single biggest accuracy lever.
_MRZ_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
_MRZ_CONFIG = f"--psm 6 -c tessedit_char_whitelist={_MRZ_WHITELIST}"
_ROTATIONS = (0, 90, 180, 270)


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


def _osd_rotation(image: Image.Image) -> int | None:
    """Detected upright rotation (0/90/180/270) via Tesseract OSD, or None.

    OSD needs enough text and can fail on noisy photos — any failure returns
    None so the caller brute-forces all four rotations.
    """
    cmd = _resolve_tesseract_cmd()
    if cmd is None:
        return None
    import pytesseract

    pytesseract.pytesseract.tesseract_cmd = cmd
    try:
        osd = pytesseract.image_to_osd(image, output_type=pytesseract.Output.DICT)
    except Exception:
        return None
    rotation = int(osd.get("rotate", 0)) % 360
    return rotation if rotation in _ROTATIONS else None


def _orientations(image: Image.Image) -> Iterator[tuple[int, Image.Image]]:
    """Yield (degrees, rotated_image) for each 90° rotation.

    OSD's suggestion is tried first to short-circuit sooner; all four are still
    covered because the MRZ checksum is the real arbiter. ``expand=True`` keeps
    the whole page after rotation.
    """
    suggested = _osd_rotation(image)
    order = list(_ROTATIONS)
    if suggested is not None:
        order = [suggested] + [d for d in _ROTATIONS if d != suggested]
    for deg in order:
        yield deg, (image if deg == 0 else image.rotate(-deg, expand=True))


def best_mrz(pages: list[Image.Image]) -> MrzCandidate | None:
    """Best MRZ candidate across pages x rotations, scored by TD3 checksum.

    Short-circuits on the first checksum-valid MRZ (confidence 0.95). Otherwise
    returns the highest-confidence structural candidate (0.55), or None.
    A per-page/rotation Tesseract error is skipped; a missing binary re-raises.
    """
    best: MrzCandidate | None = None
    for idx, page in enumerate(pages):
        for rotation, img in _orientations(page):
            try:
                text = ocr_mrz_pass(img)
            except OcrUnavailableError:
                raise
            except Exception:
                log.debug("mrz pass failed (page=%d rot=%d)", idx, rotation, exc_info=True)
                continue
            extraction = extract_passport(text)
            if extraction is None:
                continue
            field = extraction.field("passport_no")
            if not (field and field.value):
                continue
            cand = MrzCandidate(
                number=field.value[:64],
                confidence=extraction.doc_type_confidence,
                valid=extraction.doc_type_confidence >= 0.9,
                page_index=idx,
                rotation=rotation,
            )
            if cand.valid:
                return cand
            if best is None or cand.confidence > best.confidence:
                best = cand
    return best


def looks_like_mrz(text: str) -> bool:
    """True if any line looks like an MRZ row (several ``<`` fill characters)."""
    for line in text.upper().splitlines():
        stripped = line.strip().replace(" ", "")
        if stripped.count("<") >= 3 and len(stripped) >= 20:
            return True
    return False


def best_printed_number(pages: list[Image.Image]) -> tuple[str, str] | None:
    """Labelled passport number read per page (ara+eng), review-only.

    Runs the label regex on each page independently — never on concatenated
    text — and prefers a page that also contains MRZ-like content (the
    bio-data page), so a reference/partial number on a cover page can't win.
    Falls back to the last matching page otherwise. Returns (number, snippet).
    """
    best: tuple[bool, str, str] | None = None  # (has_mrz_context, number, snippet)
    for page in pages:
        try:
            with OCR_GATE:
                text = extract_text(page).text
        except OcrUnavailableError:
            raise
        except Exception:
            log.debug("printed pass failed", exc_info=True)
            continue
        hit = extract_printed_passport_no(text)
        if hit is None:
            continue
        number, snippet = hit
        has_mrz = looks_like_mrz(text)
        if best is None or (has_mrz and not best[0]) or (not best[0] and not has_mrz):
            best = (has_mrz, number, snippet)
    if best is None:
        return None
    return best[1], best[2]
