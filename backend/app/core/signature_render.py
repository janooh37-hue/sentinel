"""Trim + thicken + solidify + upscale a signature image before it is embedded.

A signature is a raster image; scaling it does not make a hairline stroke
thicker, and a signing pad captures a wide canvas that is mostly blank around
the ink. This module first **trims the blank margins** so the embed width maps
to the signature itself (not the empty canvas — the difference between a
signature that fills a form line and one that prints a few mm wide). It then
GROWS the ink (morphological dilation), kills the faint anti-aliased halo that
washes out under PDF compression, upscales small sources so they stay crisp at
the larger embed size, and preserves the signature's own colour and
transparent background.

Single public function: ``prepare_signature(bytes, *, dilate_radius_px) -> bytes`` (PNG out).
It is defensive by contract — on ANY failure it returns the input bytes
unchanged so document generation is never blocked (mirrors ``core/qr.py``).

The tuning dials and canonical appearance defaults are module constants;
``DEFAULT_SIG_BOLDNESS`` is the dilation radius for the default thickness.
"""

from __future__ import annotations

import io
import logging
from typing import Final

from PIL import Image, ImageFilter, ImageOps, ImageStat
from PIL.Image import Resampling

log = logging.getLogger(__name__)

# Tuning dials -------------------------------------------------------------
_REF_WIDTH_PX: Final[int] = 1000  # upscale a small source's LONGEST side to this
_SOLIDIFY_GAMMA: Final[float] = 0.6  # <1 boosts mid-coverage toward opaque
_INK_FLOOR: Final[int] = 20  # coverage below this (near-white noise) → 0
_DEFAULT_INK: Final[tuple[int, int, int]] = (26, 26, 31)  # #1a1a1f fallback
_TRIM_PAD_FRAC: Final[float] = 0.04  # breathing margin kept around the ink box

# Canonical appearance defaults + ranges (single source of truth; the frontend
# mirrors these). Boldness == dilation radius: 0 None / 1 Light / 2 Medium / 3 Bold.
DEFAULT_SIG_SIZE_MM: Final[int] = 45
DEFAULT_SIG_BOLDNESS: Final[int] = 1
SIG_SIZE_MIN_MM: Final[int] = 18
SIG_SIZE_MAX_MM: Final[int] = 70
SIG_BOLDNESS_MIN: Final[int] = 0
SIG_BOLDNESS_MAX: Final[int] = 3


def clamp_size(mm: int) -> int:
    return max(SIG_SIZE_MIN_MM, min(SIG_SIZE_MAX_MM, int(mm)))


def clamp_boldness(level: int) -> int:
    return max(SIG_BOLDNESS_MIN, min(SIG_BOLDNESS_MAX, int(level)))


def prepare_signature(
    image_bytes: bytes, *, dilate_radius_px: int = DEFAULT_SIG_BOLDNESS
) -> bytes:
    """Return thickened PNG bytes; return *image_bytes* unchanged on failure."""
    try:
        return _process(image_bytes, dilate_radius_px=clamp_boldness(dilate_radius_px))
    except Exception:  # must never block document generation
        log.warning("prepare_signature: returning original bytes", exc_info=True)
        return image_bytes


def _has_alpha(alpha: Image.Image) -> bool:
    """True when the alpha channel actually varies (real transparency)."""
    return alpha.getextrema() != (255, 255)


def _ink_color(rgb: Image.Image, coverage: Image.Image) -> tuple[int, int, int]:
    """Mean RGB over the strongly-inky pixels (weighted by nothing fancy)."""
    strong = coverage.point(lambda v: 255 if v >= 160 else 0).convert("L")
    try:
        stat = ImageStat.Stat(rgb, mask=strong)
        if stat.count[0] > 0:
            r, g, b = (round(c) for c in stat.mean[:3])
            return (r, g, b)
    except (ValueError, ZeroDivisionError):
        pass
    return _DEFAULT_INK


def _pad_bbox(
    bbox: tuple[int, int, int, int], size: tuple[int, int], frac: float
) -> tuple[int, int, int, int]:
    """Grow *bbox* by *frac* of its own width/height on each side, clamped to *size*."""
    left, top, right, bottom = bbox
    width, height = size
    pad_x = round((right - left) * frac)
    pad_y = round((bottom - top) * frac)
    return (
        max(0, left - pad_x),
        max(0, top - pad_y),
        min(width, right + pad_x),
        min(height, bottom + pad_y),
    )


def _process(image_bytes: bytes, *, dilate_radius_px: int) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as opened:
        im = opened.convert("RGBA")

    r, g, b, a = im.split()
    rgb = Image.merge("RGB", (r, g, b))
    coverage = a if _has_alpha(a) else ImageOps.invert(rgb.convert("L"))  # dark pixels = ink

    # Drop near-white noise so an opaque background doesn't read as faint ink.
    coverage = coverage.point(lambda v: v if v >= _INK_FLOOR else 0)

    # Trim the blank canvas margins (a signing pad captures a wide canvas with
    # the ink in the middle) so the embed width maps to the signature itself.
    # ``getbbox`` returns None for an all-empty mask → skip the crop.
    bbox = coverage.getbbox()
    if bbox is not None:
        bbox = _pad_bbox(bbox, coverage.size, _TRIM_PAD_FRAC)
        rgb = rgb.crop(bbox)
        coverage = coverage.crop(bbox)

    # Upscale a small source by its LONGEST side so the result stays crisp at the
    # larger embed. Scaling by the longest side (not width) keeps an extreme
    # aspect ratio — e.g. a near-vertical stroke — from exploding into a huge
    # image after a tight trim.
    long_side = max(rgb.width, rgb.height)
    if 0 < long_side < _REF_WIDTH_PX:
        scale = _REF_WIDTH_PX / long_side
        new_size = (max(1, round(rgb.width * scale)), max(1, round(rgb.height * scale)))
        rgb = rgb.resize(new_size, Resampling.LANCZOS)
        coverage = coverage.resize(new_size, Resampling.LANCZOS)

    # Capture coverage before dilation so _ink_color samples only true ink
    # pixels (not the dilation halo where rgb holds background colour).
    ink_src_coverage = coverage

    # Grow the ink (the "thicken").
    if dilate_radius_px > 0:
        coverage = coverage.filter(ImageFilter.MaxFilter(2 * dilate_radius_px + 1))

    # Solidify: push mid-coverage edge pixels toward fully opaque so the
    # stroke reads as solid ink, not a faint smear, after compression.
    coverage = coverage.point(
        lambda v: round(255 * (v / 255) ** _SOLIDIFY_GAMMA)
    )

    ink = _ink_color(rgb, ink_src_coverage)
    out = Image.new("RGBA", coverage.size, (ink[0], ink[1], ink[2], 0))
    out.putalpha(coverage)

    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()
