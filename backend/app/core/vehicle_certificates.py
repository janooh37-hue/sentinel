"""Readable-quality compression for vehicle certificate PDFs and images.

Two profiles size the same safety/readability envelope differently:

* ``"current"``  — ordinary uploads, targets roughly A4 at 300 DPI.
* ``"historical"`` — the stronger recompression applied only to a certificate
  that a successful replacement upload supersedes (see the vehicle
  certificates plan, "publish replacements and historical recompression
  atomically"). It is always run on the already-compressed ``"current"``
  output of the predecessor, so it is a second, smaller shrink, not a
  from-scratch pass on the original upload.

Both profiles refuse to touch content they cannot safely verify: encrypted,
digitally signed, or repaired PDFs come back byte-identical. Animated,
corrupt, or unsafely large images are rejected outright rather than silently
degraded. The optimizer only ever returns a *smaller* candidate — when it
cannot safely produce one, it returns the original bytes unchanged.

This module is pure (bytes in, bytes out) so it can be submitted to
``app.services._pdf_executor``'s single-worker process pool: native
PyMuPDF/Pillow work never blocks the event loop or shares a process with
Word COM. Validation failures are raised as plain ``ValueError``s carrying one
of the ``VEHICLE_CERTIFICATE_*`` codes below so they survive pickling across
the Windows process boundary; ``vehicle_service`` translates them back to
``ValidationFailedError``.
"""

from __future__ import annotations

import io
import warnings
from typing import Final, Literal

import fitz
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.vehicle_photos import MAX_DIMENSION, MAX_PIXELS

Profile = Literal["current", "historical"]

_ALLOWED_IMAGE_FORMATS: Final[frozenset[str]] = frozenset({"PNG", "JPEG", "WEBP"})
_MEDIA_TYPE_TO_FORMAT: Final[dict[str, str]] = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/jpg": "JPEG",
    "image/webp": "WEBP",
}

# Longest edge / encoder quality per profile. "current" ~= A4 at 300 DPI.
# "historical" ~= A4 at 250 DPI, not the 200 DPI floor the plan starts from:
# the representative-document quality gate's small-body-text OCR check (8pt
# Arabic/English field lines, matched at the same physical zoom) read cleanly
# at "current" but showed real character-level errors ("Field"→"Pietd",
# "line"→"Ine") at the 200 DPI/quality-82 floor. Escalating to the plan's
# named escape-hatch values restored clean readability while the historical
# output still shrinks the already-compressed "current" bytes further.
_IMAGE_PROFILES: Final[dict[Profile, dict[str, int]]] = {
    "current": {"longest_edge": 3508, "quality": 92},
    "historical": {"longest_edge": 2924, "quality": 88},
}
_PDF_PROFILES: Final[dict[Profile, dict[str, int]]] = {
    "current": {"dpi_threshold": 450, "dpi_target": 300, "quality": 92},
    "historical": {"dpi_threshold": 280, "dpi_target": 250, "quality": 88},
}

# Compression *eligibility* bounds, not upload rejection limits: a PDF outside
# these stays byte-identical rather than being rejected.
_PDF_MAX_PAGES: Final[int] = 100
_PDF_MAX_XREFS: Final[int] = 20_000

__all__ = ["Profile", "optimize_certificate"]


def optimize_certificate(data: bytes, media_type: str, *, profile: Profile = "current") -> bytes:
    """Return a possibly smaller, equally readable encoding of *data*.

    Raises ``ValueError`` with a ``VEHICLE_CERTIFICATE_*`` code for content
    that cannot be safely processed at all (unreadable, animated, or larger
    than the safe-decode bounds). Content that decodes fine but cannot be
    safely or successfully shrunk — protected PDFs, already-efficient files,
    an encoder that fails to beat the original — returns the original bytes.
    """
    normalized = media_type.partition(";")[0].strip().lower()
    if normalized == "application/pdf":
        return _optimize_pdf(data, profile)
    if normalized in _MEDIA_TYPE_TO_FORMAT:
        return _optimize_image(data, normalized, profile)
    raise ValueError("VEHICLE_CERTIFICATE_INVALID")


# ── Images ───────────────────────────────────────────────────────────────


def _validate_image_dimensions(width: int, height: int) -> None:
    if (
        width < 1
        or height < 1
        or width > MAX_DIMENSION
        or height > MAX_DIMENSION
        or width * height > MAX_PIXELS
    ):
        raise ValueError("VEHICLE_CERTIFICATE_DIMENSIONS_TOO_LARGE")


def _has_transparency(image: Image.Image) -> bool:
    return "A" in image.getbands() or image.info.get("transparency") is not None


def _resizable(image: Image.Image) -> Image.Image:
    """A mode LANCZOS can resample reliably, without discarding transparency."""
    if image.mode in {"RGB", "RGBA", "L", "LA"}:
        return image
    return image.convert("RGBA" if _has_transparency(image) else "RGB")


def _resize_to_longest_edge(image: Image.Image, longest_edge: int) -> Image.Image:
    width, height = image.size
    longest = max(width, height)
    if longest <= longest_edge:
        return image
    scale = longest_edge / longest
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS, reducing_gap=3.0)


def _encode_image(
    image: Image.Image,
    fmt: str,
    *,
    longest_edge: int,
    quality: int,
    icc_profile: bytes | None,
) -> bytes:
    resizable = _resizable(image)
    resized = _resize_to_longest_edge(resizable, longest_edge)
    buffer = io.BytesIO()
    save_kwargs: dict[str, object] = {}
    if icc_profile:
        save_kwargs["icc_profile"] = icc_profile
    if fmt == "JPEG":
        flat = resized if resized.mode in {"RGB", "L"} else resized.convert("RGB")
        flat.save(
            buffer, format="JPEG", quality=quality, subsampling=0, optimize=True, **save_kwargs
        )
    elif fmt == "WEBP":
        resized.save(buffer, format="WEBP", quality=quality, method=6, **save_kwargs)
    else:  # PNG stays losslessly encoded at every profile.
        resized.save(buffer, format="PNG", optimize=True, **save_kwargs)
    return buffer.getvalue()


def _optimize_image(data: bytes, media_type: str, profile: Profile) -> bytes:
    declared_format = _MEDIA_TYPE_TO_FORMAT[media_type]
    settings = _IMAGE_PROFILES[profile]
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            with Image.open(io.BytesIO(data)) as source:
                actual_format = source.format
                if actual_format not in _ALLOWED_IMAGE_FORMATS or actual_format != declared_format:
                    raise ValueError("VEHICLE_CERTIFICATE_INVALID")

                width, height = source.size
                _validate_image_dimensions(width, height)
                if (
                    bool(getattr(source, "is_animated", False))
                    or int(getattr(source, "n_frames", 1)) != 1
                ):
                    raise ValueError("VEHICLE_CERTIFICATE_ANIMATED")

                exif = source.getexif()
                orientation = int(exif.get(274, 1))
                raw_icc_profile = source.info.get("icc_profile")
                icc_profile = raw_icc_profile if isinstance(raw_icc_profile, bytes) else None

                source.load()
                oriented: Image.Image = source
                if orientation in {2, 3, 4, 5, 6, 7, 8}:
                    transposed = ImageOps.exif_transpose(source)
                    if transposed is not None:
                        oriented = transposed
                oriented_width, oriented_height = oriented.size
                _validate_image_dimensions(oriented_width, oriented_height)

                candidate = _encode_image(
                    oriented,
                    declared_format,
                    longest_edge=settings["longest_edge"],
                    quality=settings["quality"],
                    icc_profile=icc_profile,
                )
    except ValueError:
        raise
    except (
        EOFError,
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
        Warning,
    ) as exc:
        raise ValueError("VEHICLE_CERTIFICATE_INVALID") from exc

    return candidate if len(candidate) < len(data) else data


# ── PDFs ─────────────────────────────────────────────────────────────────


def _key_present(doc: fitz.Document, xref: int, key: str) -> bool:
    kind, _value = doc.xref_get_key(xref, key)
    return bool(kind != "null")


def _is_signed(doc: fitz.Document) -> bool:
    """True when the PDF carries any signature-related structure.

    This is a preservation signal, not a claim that a signature was
    cryptographically verified: unknown/uninspectable signature state is
    treated as signed so the original bytes are always kept.
    """
    if doc.get_sigflags() > 0:
        return True
    if _key_present(doc, doc.pdf_catalog(), "Perms"):
        return True
    for xref in range(1, doc.xref_length()):
        try:
            keys = doc.xref_get_keys(xref)
        except (RuntimeError, ValueError):
            continue
        if "ByteRange" in keys and _key_present(doc, xref, "ByteRange"):
            return True
        if "FT" in keys and doc.xref_get_key(xref, "FT")[1] in {"/Sig", "Sig"}:
            return True
        if "Type" in keys and doc.xref_get_key(xref, "Type")[1] in {"/Sig", "Sig"}:
            return True
    return False


def _is_encrypted(doc: fitz.Document) -> bool:
    # `needs_pass` alone misses an owner-password PDF PyMuPDF auto-opened
    # with an empty user password: `is_encrypted` and a present trailer
    # `/Encrypt` key both catch that case.
    return bool(doc.needs_pass) or bool(doc.is_encrypted) or _key_present(doc, -1, "Encrypt")


def _has_oversized_image(doc: fitz.Document) -> bool:
    """Cheap header-only scan — never decodes pixel data."""
    for page in doc:
        for image in page.get_images(full=True):
            width, height = image[2], image[3]
            if width > MAX_DIMENSION or height > MAX_DIMENSION or width * height > MAX_PIXELS:
                return True
    return False


def _reopen_matches(original_data: bytes, candidate: bytes) -> bool:
    """Compare against a fresh document opened from the *original* bytes.

    A separate open (rather than reusing the in-memory ``doc`` that
    ``rewrite_images`` already mutated) is the only way to confirm the saved
    candidate still matches what was actually uploaded.
    """
    try:
        with (
            fitz.open(stream=original_data, filetype="pdf") as original,
            fitz.open(stream=candidate, filetype="pdf") as reopened,
        ):
            if reopened.page_count != original.page_count:
                return False
            for index in range(original.page_count):
                before = original[index].rect
                after = reopened[index].rect
                if (
                    abs(before.width - after.width) > 0.5
                    or abs(before.height - after.height) > 0.5
                    or original[index].rotation != reopened[index].rotation
                ):
                    return False
            return True
    except Exception:
        return False


def _optimize_pdf(data: bytes, profile: Profile) -> bytes:
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ValueError("VEHICLE_CERTIFICATE_INVALID") from exc

    try:
        if not doc.is_pdf or doc.page_count < 1:
            raise ValueError("VEHICLE_CERTIFICATE_INVALID")
        if bool(getattr(doc, "is_repaired", False)):
            return data
        if _is_encrypted(doc):
            return data
        if _is_signed(doc):
            return data
        if doc.page_count > _PDF_MAX_PAGES or doc.xref_length() > _PDF_MAX_XREFS:
            return data
        if _has_oversized_image(doc):
            return data

        settings = _PDF_PROFILES[profile]
        try:
            doc.rewrite_images(
                dpi_threshold=settings["dpi_threshold"],
                dpi_target=settings["dpi_target"],
                quality=settings["quality"],
                lossy=True,
                lossless=True,
                bitonal=False,
                color=True,
                gray=True,
                set_to_gray=False,
            )
            candidate = bytes(doc.tobytes(garbage=3, deflate=True, use_objstms=1))
        except Exception:
            return data

        if len(candidate) >= len(data) or not _reopen_matches(data, candidate):
            return data
        return candidate
    finally:
        doc.close()
