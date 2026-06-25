from __future__ import annotations

import io
import math
import os
import shutil
import threading
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

_LANGS = "ara+eng"
_PSM = "--psm 4"  # single column of variable-size blocks — suits ID cards, letters, gov certs
_MIN_WIDTH = 1600  # upscale small scans so Tesseract's layout analysis works on dense bilingual docs
# Decompression-bomb guard: cap decoded pixels (≈178 MP — generous for scans,
# rejects crafted images that would blow up memory). Mirrors PIL's own default.
_MAX_PIXELS = 178_956_970

# Single global cap on concurrent OCR runs — CPU-heavy on the shared single-host
# server. Imported by every OCR path (extractions, intake, scan-inbox drain) so
# they share ONE cap of 2 instead of each holding its own (which oversubscribed).
OCR_GATE = threading.Semaphore(2)


class OcrUnavailableError(RuntimeError):
    """Raised when the Tesseract binary is not installed on the host."""


class InvalidImageError(ValueError):
    """Raised when the uploaded bytes aren't a decodable image (or too large).

    The API layer translates this to a 422 so a malformed upload never
    surfaces as an unhandled 500.
    """


@dataclass(frozen=True)
class OcrResult:
    text: str
    confidence: float
    language: str = _LANGS


# Standard UB-Mannheim install locations, checked when the binary is not on
# PATH. A Windows service can launch with the PATH it inherited *before*
# Tesseract was installed, so relying on PATH alone makes OCR spuriously
# "unavailable" until the next full reboot — falling back to the known install
# dir avoids that.
_WINDOWS_TESSERACT_PATHS = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
)


def _resolve_tesseract_cmd() -> str | None:
    """Locate the tesseract binary: PATH first, then the standard Windows
    install dirs. Returns the command/full path, or ``None`` if not found."""
    found = shutil.which("tesseract")
    if found:
        return found
    for cand in _WINDOWS_TESSERACT_PATHS:
        if os.path.isfile(cand):
            return cand
    return None


def tesseract_available() -> bool:
    return _resolve_tesseract_cmd() is not None


def _prepare(image: Image.Image) -> Image.Image:
    if image.width < _MIN_WIDTH:
        factor = min(3, math.ceil(_MIN_WIDTH / image.width))
        image = image.resize((image.width * factor, image.height * factor))
    return image


def extract_text(image: Image.Image) -> OcrResult:
    cmd = _resolve_tesseract_cmd()
    if cmd is None:
        raise OcrUnavailableError(
            "Tesseract is not installed. See docs/superpowers/ocr-server-setup.md."
        )
    import pytesseract

    # Point pytesseract at the resolved binary — covers the case where it was
    # found in the standard install dir rather than on PATH.
    pytesseract.pytesseract.tesseract_cmd = cmd

    img = _prepare(image)
    try:
        text = pytesseract.image_to_string(img, lang=_LANGS, config=_PSM)
        # mean word confidence from the data frame, normalised 0..1
        data = pytesseract.image_to_data(
            img, lang=_LANGS, config=_PSM, output_type=pytesseract.Output.DICT
        )
    except pytesseract.TesseractError as exc:
        # Binary is present but the run failed — almost always a missing
        # language pack (we request "ara+eng"). Surface it as "unavailable" so
        # the API maps it to a clean 503 instead of an unhandled 500.
        raise OcrUnavailableError(
            f"Tesseract failed to run with languages {_LANGS!r}. The 'ara' and "
            "'eng' language packs must both be installed. "
            "See docs/superpowers/ocr-server-setup.md."
        ) from exc
    confs = [int(c) for c in data.get("conf", []) if str(c).lstrip("-").isdigit() and int(c) >= 0]
    confidence = (sum(confs) / len(confs) / 100.0) if confs else 0.0
    return OcrResult(text=text, confidence=confidence)


def pdf_to_images(pdf_bytes: bytes, *, dpi: int = 200) -> list[Image.Image]:
    """Rasterise each PDF page to a PIL image via PyMuPDF (fitz).

    A corrupt or 0-byte PDF makes ``fitz.open`` raise PyMuPDF's
    ``FileDataError`` / ``EmptyFileError`` — re-raised as
    :class:`InvalidImageError` (mirrors the image path) so the API maps it to a
    clean 422 instead of an unhandled 500.
    """
    import fitz

    images: list[Image.Image] = []
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            for page in doc:
                # alpha=False guarantees a 3-channel (RGB) pixmap so
                # Image.frombytes("RGB", …) below never trips over a 4-byte
                # (RGBA/CMYK) sample buffer. Mirrors vault_service's rasteriser.
                pix = page.get_pixmap(dpi=dpi, alpha=False)
                images.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    except (fitz.FileDataError, fitz.EmptyFileError) as exc:
        raise InvalidImageError("The uploaded PDF is not readable.") from exc
    except RuntimeError as exc:
        # PyMuPDF raises bare RuntimeError for some malformed streams.
        raise InvalidImageError("The uploaded PDF is not readable.") from exc
    return images


# A PDF text layer with at least this many alphanumeric characters is treated as
# authoritative. Born-digital and searchable-scan PDFs carry one, and it is far
# more reliable than rasterise + Tesseract — which mis-reads a stamped
# ``Ref: GS-0333`` as ``65-3`` (G→6, S→5, and the ``0333`` digit run collapses),
# silently breaking ref-matching on the scan-back of any GSSG form.
_TEXT_LAYER_MIN_ALNUM = 16


def pdf_text_layer(pdf_bytes: bytes) -> str:
    """Return the embedded text layer of *pdf_bytes* (``""`` if none/unreadable).

    Unlike :func:`pdf_to_images`, a corrupt PDF yields ``""`` here rather than
    raising — callers fall back to OCR, which surfaces the proper 422.
    """
    import fitz

    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            return "\n".join(page.get_text() for page in doc)
    except (fitz.FileDataError, fitz.EmptyFileError, RuntimeError):
        return ""


def text_from_pdf(pdf_bytes: bytes) -> str:
    """Best available text for a PDF: a substantial embedded text layer when one
    exists, else rasterise every page and OCR it.

    Searchable / born-digital PDFs carry a trustworthy text layer; re-OCRing them
    only injects noise (a stamped ``Ref: GS-0333`` becomes ``65-3``), which breaks
    ref-matching. Image-only scans have no text layer, so OCR is still used and
    the prior behaviour — including the 422 raised on a corrupt PDF — is preserved.
    """
    layer = pdf_text_layer(pdf_bytes)
    if sum(c.isalnum() for c in layer) >= _TEXT_LAYER_MIN_ALNUM:
        return layer
    return "\n".join(extract_text(img).text for img in pdf_to_images(pdf_bytes))


def ocr_bytes_to_text(raw: bytes) -> str:
    """OCR raw upload bytes to text. Sniffs the magic number rather than trusting
    a client content-type: a real PDF starts with ``%PDF`` (prefer its embedded
    text layer over re-OCR); everything else is loaded as an image.
    """
    if raw.startswith(b"%PDF"):
        return text_from_pdf(raw)
    return extract_text(load_image(raw)).text


def qr_refs_from_bytes(raw: bytes) -> list[str]:
    """GSSG refs decoded from QR symbols in an upload (image or PDF).

    Sniffs the magic number (``%PDF`` → rasterise every page; else load as an
    image), then QR-decodes each page. Returns ordered-unique bare refs, or
    ``[]`` on any failure (unreadable upload, decoder unavailable) so callers
    fall straight back to OCR.
    """
    from app.core.qr import decode_qr_refs

    try:
        images = pdf_to_images(raw) if raw.startswith(b"%PDF") else [load_image(raw)]
    except InvalidImageError:
        return []

    refs: list[str] = []
    seen: set[str] = set()
    try:
        for img in images:
            for ref in decode_qr_refs(img):
                if ref not in seen:
                    seen.add(ref)
                    refs.append(ref)
    except Exception:
        return refs
    return refs


def load_image(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        w, h = img.size
        if w * h > _MAX_PIXELS:
            raise InvalidImageError(
                f"Image is too large to process ({w}x{h} pixels)."
            )
        return img.convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImageError("The uploaded file is not a readable image.") from exc
