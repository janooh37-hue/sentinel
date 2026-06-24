"""Signature PNG validation + storage (Phase 01 port of `signature_pad.py`).

In v3.5.4 the drawing canvas and PNG export both lived in
`signature_pad.SignaturePadDialog` (Tkinter). In v4 the *drawing* moves to a
React signature pad on the client, and the server only:

  1. validates the bytes are a real PNG of plausible size,
  2. writes them to ``<vault>/<G>/documents/signature.png``.

Public contract (per `plans/01-core-port.md`):

    signature.save(png_bytes, g_number, vault) -> Path
        Validates and writes. Returns the written path.

    signature.validate(png_bytes) -> SignatureMeta
        Validate-only — used by the upload endpoint to surface friendly
        errors before writing.

Validation is intentionally narrow:
  * PNG magic number must match.
  * Pillow must open the image (catches truncated/corrupt files).
  * Dimensions must fall in ``[MIN_DIMS, MAX_DIMS]`` — rejects 1x1 spam
    and 10k+ pixel uploads, both of which v3 never produced.
  * Transparency is reported but not required. Forms render the signature
    inline; a flat-white background looks ugly but isn't a server error.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from PIL import Image, UnidentifiedImageError

from app.core.vault_manager import Vault

log = logging.getLogger(__name__)

# PNG file signature (RFC 2083).
_PNG_MAGIC: Final[bytes] = b"\x89PNG\r\n\x1a\n"

# Bounds. v3's signature pad exports ~1640x800 max; we allow up to a
# generous 4096x4096 to leave headroom for high-DPI canvases without
# accepting outright spam.
MIN_WIDTH: Final[int] = 60
MIN_HEIGHT: Final[int] = 30
MAX_WIDTH: Final[int] = 4096
MAX_HEIGHT: Final[int] = 4096
MAX_BYTES: Final[int] = 5 * 1024 * 1024  # 5 MiB

SIGNATURE_FILENAME: Final[str] = "signature.png"


class SignatureError(ValueError):
    """Raised when the incoming PNG bytes fail validation."""


@dataclass(frozen=True, slots=True)
class SignatureMeta:
    """Information about a validated signature PNG."""

    width: int
    height: int
    mode: str
    has_alpha: bool
    size_bytes: int


def validate(png_bytes: bytes) -> SignatureMeta:
    """Validate PNG bytes. Raises `SignatureError` on any failure."""
    if not png_bytes:
        raise SignatureError("Signature bytes are empty")
    if len(png_bytes) > MAX_BYTES:
        raise SignatureError(
            f"Signature too large: {len(png_bytes)} bytes (max {MAX_BYTES})"
        )
    if not png_bytes.startswith(_PNG_MAGIC):
        raise SignatureError("Not a PNG file (magic byte mismatch)")

    try:
        with Image.open(io.BytesIO(png_bytes)) as img:
            img.verify()  # cheap structural check
    except (UnidentifiedImageError, OSError, ValueError) as e:
        raise SignatureError(f"Corrupt PNG: {e}") from e

    # `verify` invalidates the image for further use — reopen for dims.
    with Image.open(io.BytesIO(png_bytes)) as img:
        width, height = img.size
        mode = img.mode
        has_alpha = "A" in mode or img.info.get("transparency") is not None

    if width < MIN_WIDTH or height < MIN_HEIGHT:
        raise SignatureError(
            f"Signature too small: {width}x{height} "
            f"(min {MIN_WIDTH}x{MIN_HEIGHT})"
        )
    if width > MAX_WIDTH or height > MAX_HEIGHT:
        raise SignatureError(
            f"Signature too large: {width}x{height} "
            f"(max {MAX_WIDTH}x{MAX_HEIGHT})"
        )

    return SignatureMeta(
        width=width,
        height=height,
        mode=mode,
        has_alpha=has_alpha,
        size_bytes=len(png_bytes),
    )


def vault_path(vault: Vault, g_number: str) -> Path:
    """Where a signature would be written for `g_number` — no I/O."""
    return vault.emp_root(g_number) / "documents" / SIGNATURE_FILENAME


def normalize_to_png(data: bytes) -> bytes:
    """Return PNG bytes for a PNG or JPEG upload.

    PNG passes through untouched (zero-copy). JPEG is re-encoded to PNG so the
    vault always stores ``signature.png``. Anything else raises
    :class:`SignatureError` — the caller surfaces it as a 422.
    """
    if data.startswith(_PNG_MAGIC):
        return data
    try:
        with Image.open(io.BytesIO(data)) as probe:
            img_format = probe.format
    except (UnidentifiedImageError, OSError) as e:
        raise SignatureError(f"Not a PNG or JPEG image: {e}") from e
    if img_format != "JPEG":
        raise SignatureError(
            f"Unsupported image format: {img_format or 'unknown'} "
            "(PNG or JPEG required)"
        )
    with Image.open(io.BytesIO(data)) as img:
        buf = io.BytesIO()
        img.convert("RGBA").save(buf, format="PNG")
        return buf.getvalue()


def save(png_bytes: bytes, g_number: str, vault: Vault) -> Path:
    """Validate `png_bytes` and write to the employee's signature path.

    Overwrites any existing ``signature.png`` — v3 behaviour, since a fresh
    signature replaces the old one rather than versioning.
    """
    validate(png_bytes)
    target = vault_path(vault, g_number)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(png_bytes)
    log.info("Wrote signature for %s → %s", g_number, target)
    return target
