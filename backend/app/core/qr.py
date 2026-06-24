"""Ref codes — encode (Aztec, aztec_code_generator) + decode (zxing-cpp).

Pure module: PIL image in, refs out; no FastAPI / SQLAlchemy / fitz. The
upload-bytes orchestration (PDF rasterise vs image load) lives in
``extraction.ocr.qr_refs_from_bytes`` so this module stays dependency-light.

Payload format is ``GSSG:<ref>`` (e.g. ``GSSG:GS-0333``). The ``GSSG:`` prefix
lets the decoder ignore unrelated symbols on a page (an Emirates ID, a vendor
stamp) and key only on ours. Decode is symbology-agnostic — ``read_barcodes``
reads Aztec, QR, PDF417, etc. — so this stays the single matcher regardless of
which 2-D code we stamp.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING, Any

from aztec_code_generator import AztecCode

if TYPE_CHECKING:
    from PIL.Image import Image

# Decoder import is guarded: a host missing the zxing-cpp extension degrades to
# OCR-only (decode_qr_refs returns []), mirroring ocr.tesseract_available().
_zxingcpp: Any = None
_AVAILABLE = False
try:
    import zxingcpp as _zxingcpp  # type: ignore[no-redef]

    _AVAILABLE = True
except Exception:  # pragma: no cover - import-time host guard
    pass

_PREFIX = "GSSG:"


def payload_for(ref: str) -> str:
    """Return the QR payload string for a book ref."""
    return f"{_PREFIX}{ref}"


def make_aztec_png(ref: str, *, module_size: int = 8, border: int = 2) -> bytes:
    """Render a PNG Aztec for ``payload_for(ref)``.

    Aztec carries strong error correction and (unlike QR) needs no wide quiet
    zone, so it stays compact at a small stamp size. ``border`` is the white
    quiet-zone (in modules) baked into the image; ``module_size`` the per-module
    pixel size.
    """
    img = AztecCode(payload_for(ref)).image(module_size=module_size, border=border)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def qr_decode_available() -> bool:
    """True iff the code decoder loaded on this host."""
    return _AVAILABLE


def decode_qr_refs(image: Image) -> list[str]:
    """Bare refs from ``GSSG:``-prefixed code symbols in *image*, stamped order.

    Symbology-agnostic (Aztec / QR / PDF417 …). Returns ``[]`` (never raises)
    when the decoder is unavailable or no GSSG code is present, so callers fall
    back to OCR exactly as today.
    """
    if not _AVAILABLE:
        return []
    try:
        results = _zxingcpp.read_barcodes(image)
    except Exception:
        return []
    refs: list[str] = []
    seen: set[str] = set()
    for r in results:
        text = (getattr(r, "text", "") or "")
        if not text.startswith(_PREFIX):
            continue
        ref = text[len(_PREFIX):].strip().upper()
        if ref and ref not in seen:
            seen.add(ref)
            refs.append(ref)
    return refs


__all__ = ["decode_qr_refs", "make_aztec_png", "payload_for", "qr_decode_available"]
