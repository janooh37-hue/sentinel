"""Validated, deterministic image variants for reusable vehicle photos."""

from __future__ import annotations

import hashlib
import io
import warnings
from contextlib import ExitStack
from dataclasses import dataclass
from typing import Final

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError
from PIL.Image import Resampling

from app.api.errors import ValidationFailedError

MAX_UPLOAD_BYTES: Final[int] = 20 * 1024 * 1024
MAX_DIMENSION: Final[int] = 12_000
MAX_PIXELS: Final[int] = 40_000_000
THUMBNAIL_LONGEST_EDGE: Final[int] = 160
PREVIEW_LONGEST_EDGE: Final[int] = 640

_ALLOWED_FORMATS: Final[frozenset[str]] = frozenset({"PNG", "JPEG", "WEBP"})
_HASH_DOMAIN: Final[bytes] = b"gssg-vehicle-photo-pixels-v1\0"
_HASH_BAND_ROWS: Final[int] = 64
_WEBP_IMAGE_CHUNKS: Final[frozenset[bytes]] = frozenset({b"VP8 ", b"VP8L", b"VP8X", b"ALPH"})
_WEBP_EXTENDED_DISALLOWED_FLAGS: Final[int] = 0xEF  # metadata, animation, and reserved bits
_SRGB_PROFILE = ImageCms.createProfile("sRGB")


@dataclass(frozen=True, slots=True)
class ProcessedPhoto:
    """Normalized content identity and encoded WebP display variants."""

    content_hash: str
    width: int
    height: int
    thumbnail: bytes
    preview: bytes
    full: bytes


def _invalid_photo() -> ValidationFailedError:
    return ValidationFailedError(
        "VEHICLE_PHOTO_INVALID",
        "The uploaded file is not a readable image.",
    )


def _validate_dimensions(width: int, height: int) -> None:
    if (
        width < 1
        or height < 1
        or width > MAX_DIMENSION
        or height > MAX_DIMENSION
        or width * height > MAX_PIXELS
    ):
        raise ValidationFailedError(
            "VEHICLE_PHOTO_DIMENSIONS_TOO_LARGE",
            "Photo dimensions exceed the safe processing limit.",
            width=width,
            height=height,
            max_dimension=MAX_DIMENSION,
            max_pixels=MAX_PIXELS,
        )


def _managed(stack: ExitStack, image: Image.Image) -> Image.Image:
    stack.callback(image.close)
    return image


def _has_transparency(image: Image.Image) -> bool:
    return "A" in image.getbands() or image.info.get("transparency") is not None


def _normalize_pixels(
    source: Image.Image,
    *,
    orientation: int,
    icc_profile: bytes | None,
    stack: ExitStack,
) -> Image.Image:
    base = source
    if orientation in {2, 3, 4, 5, 6, 7, 8}:
        ImageOps.exif_transpose(source, in_place=True)

    target_mode = "RGBA" if _has_transparency(base) else "RGB"
    if not icc_profile:
        if base.mode == target_mode:
            return base
        return _managed(stack, base.convert(target_mode))

    source_profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_profile))
    if target_mode == "RGBA":
        rgba = base if base.mode == "RGBA" else _managed(stack, base.convert("RGBA"))
        alpha = _managed(stack, rgba.getchannel("A"))
        rgb = _managed(stack, rgba.convert("RGB"))
        normalized = ImageCms.profileToProfile(
            rgb,
            source_profile,
            _SRGB_PROFILE,
            outputMode="RGB",
            renderingIntent=ImageCms.Intent.PERCEPTUAL,
        )
        if normalized is None:
            raise ValueError("ICC conversion did not produce an image")
        normalized = _managed(stack, normalized)
        normalized.putalpha(alpha)
        return normalized

    cms_source = base
    if base.mode not in {"CMYK", "L", "LAB", "RGB"}:
        cms_source = _managed(stack, base.convert("RGB"))
    normalized = ImageCms.profileToProfile(
        cms_source,
        source_profile,
        _SRGB_PROFILE,
        outputMode="RGB",
        renderingIntent=ImageCms.Intent.PERCEPTUAL,
    )
    if normalized is None:
        raise ValueError("ICC conversion did not produce an image")
    return _managed(stack, normalized)


def _pixel_hash(image: Image.Image) -> str:
    digest = hashlib.sha256()
    digest.update(_HASH_DOMAIN)
    digest.update(image.mode.encode("ascii"))
    digest.update(b"\0")
    digest.update(image.width.to_bytes(4, "big"))
    digest.update(image.height.to_bytes(4, "big"))

    for top in range(0, image.height, _HASH_BAND_ROWS):
        bottom = min(top + _HASH_BAND_ROWS, image.height)
        with image.crop((0, top, image.width, bottom)) as band:
            digest.update(band.tobytes())
    return digest.hexdigest()


def _bounded_size(width: int, height: int, longest_edge: int) -> tuple[int, int]:
    if max(width, height) <= longest_edge:
        return width, height
    if width >= height:
        return longest_edge, max(1, (height * longest_edge + width // 2) // width)
    return max(1, (width * longest_edge + height // 2) // height), longest_edge


def _encode_webp(image: Image.Image, *, lossless: bool) -> bytes:
    output = io.BytesIO()
    options: dict[str, object] = {
        "method": 6,
        "icc_profile": b"",
        "exif": b"",
        "xmp": b"",
    }
    if lossless:
        options.update(lossless=True, exact=True)
    else:
        options.update(lossless=False, quality=92)
    image.save(output, "WEBP", **options)
    return output.getvalue()


def _encode_resized(image: Image.Image, longest_edge: int) -> bytes:
    size = _bounded_size(image.width, image.height, longest_edge)
    if size == image.size:
        return _encode_webp(image, lossless=False)
    resized = image.resize(size, Resampling.LANCZOS, reducing_gap=3.0)
    try:
        return _encode_webp(resized, lossless=False)
    finally:
        resized.close()


def _metadata_free_webp(data: bytes, width: int, height: int) -> bool:
    """Return whether ``data`` is a single-image WebP with no metadata/private chunks."""
    if len(data) < 20 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return False
    if int.from_bytes(data[4:8], "little") + 8 != len(data):
        return False

    offset = 12
    image_chunks = 0
    extended_chunks = 0
    while offset < len(data):
        if offset + 8 > len(data):
            return False
        chunk = data[offset : offset + 4]
        chunk_size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        payload_start = offset + 8
        payload_end = payload_start + chunk_size
        padded_end = payload_end + (chunk_size & 1)
        if padded_end > len(data) or chunk not in _WEBP_IMAGE_CHUNKS:
            return False
        if chunk_size & 1 and data[payload_end:padded_end] != b"\0":
            return False

        if chunk in {b"VP8 ", b"VP8L"}:
            image_chunks += 1
        elif chunk == b"VP8X":
            extended_chunks += 1
            if chunk_size != 10 or data[payload_start] & _WEBP_EXTENDED_DISALLOWED_FLAGS:
                return False
            canvas_width = int.from_bytes(data[payload_start + 4 : payload_start + 7], "little") + 1
            canvas_height = (
                int.from_bytes(data[payload_start + 7 : payload_start + 10], "little") + 1
            )
            if (canvas_width, canvas_height) != (width, height):
                return False
        offset = padded_end

    return offset == len(data) and image_chunks == 1 and extended_chunks <= 1


def process_photo(data: bytes) -> ProcessedPhoto:
    """Decode and validate one upload, then produce normalized WebP variants.

    The content hash covers the normalized mode, dimensions, and every decoded
    pixel. It is an exact identity for deduplication, not a perceptual hash.
    """
    if not data:
        raise ValidationFailedError(
            "VEHICLE_PHOTO_EMPTY",
            "Uploaded photo is empty.",
        )
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValidationFailedError(
            "VEHICLE_PHOTO_TOO_LARGE",
            f"Photo exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MiB upload limit.",
            size=len(data),
            max_bytes=MAX_UPLOAD_BYTES,
        )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            with Image.open(io.BytesIO(data)) as source, ExitStack() as stack:
                image_format = source.format
                if image_format not in _ALLOWED_FORMATS:
                    raise ValidationFailedError(
                        "VEHICLE_PHOTO_UNSUPPORTED_FORMAT",
                        "Upload a PNG, JPEG, or WebP image.",
                        format=image_format or "unknown",
                        allowed=sorted(_ALLOWED_FORMATS),
                    )

                width, height = source.size
                _validate_dimensions(width, height)
                if (
                    bool(getattr(source, "is_animated", False))
                    or int(getattr(source, "n_frames", 1)) != 1
                ):
                    raise ValidationFailedError(
                        "VEHICLE_PHOTO_ANIMATED",
                        "Animated images are not supported.",
                        format=image_format,
                    )

                exif = source.getexif()
                orientation = int(exif.get(274, 1))
                raw_icc_profile = source.info.get("icc_profile")
                if raw_icc_profile is not None and not isinstance(raw_icc_profile, bytes):
                    raise ValueError("Image ICC profile is not binary")
                icc_profile = raw_icc_profile or None

                source.load()
                normalized = _normalize_pixels(
                    source,
                    orientation=orientation,
                    icc_profile=icc_profile,
                    stack=stack,
                )
                normalized_width, normalized_height = normalized.size
                _validate_dimensions(normalized_width, normalized_height)

                content_hash = _pixel_hash(normalized)
                generated_full = _encode_webp(normalized, lossless=True)
                can_keep_source = (
                    image_format == "WEBP"
                    and orientation == 1
                    and icc_profile is None
                    and source.mode == normalized.mode
                    and source.size == normalized.size
                    and _metadata_free_webp(data, normalized_width, normalized_height)
                )
                full = (
                    data if can_keep_source and len(data) < len(generated_full) else generated_full
                )
                preview = _encode_resized(normalized, PREVIEW_LONGEST_EDGE)
                thumbnail = _encode_resized(normalized, THUMBNAIL_LONGEST_EDGE)

                return ProcessedPhoto(
                    content_hash=content_hash,
                    width=normalized_width,
                    height=normalized_height,
                    thumbnail=thumbnail,
                    preview=preview,
                    full=full,
                )
    except ValidationFailedError:
        raise
    except (
        EOFError,
        Image.DecompressionBombError,
        ImageCms.PyCMSError,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
        ValueError,
        Warning,
    ) as exc:
        raise _invalid_photo() from exc


__all__ = [
    "MAX_DIMENSION",
    "MAX_PIXELS",
    "MAX_UPLOAD_BYTES",
    "PREVIEW_LONGEST_EDGE",
    "THUMBNAIL_LONGEST_EDGE",
    "ProcessedPhoto",
    "process_photo",
]
