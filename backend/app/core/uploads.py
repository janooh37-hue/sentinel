"""Upload hygiene shared by the Store, Vehicles and the Vault.

File names, the extension → media-type table, and magic-byte sniffing for
uploads whose policy is "the bytes must really be one of these formats".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.api.errors import ValidationFailedError

# Path separators / control chars PLUS unicode bidi-control, zero-width and
# BOM codepoints that enable display-name spoofing (e.g. U+202E RIGHT-TO-LEFT
# OVERRIDE). Everything else, Arabic included, is kept.
UNSAFE_FILENAME_CHARS = re.compile(
    '[\\\\/:*?"<>|\x00-\x1f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]'
)

MEDIA_TYPES_BY_EXTENSION: dict[str, frozenset[str]] = {
    ".pdf": frozenset({"application/pdf"}),
    ".png": frozenset({"image/png"}),
    ".jpg": frozenset({"image/jpeg", "image/jpg"}),
    ".jpeg": frozenset({"image/jpeg", "image/jpg"}),
    ".webp": frozenset({"image/webp"}),
}

_SIGNATURES: dict[str, bytes] = {
    ".pdf": b"%PDF-",
    ".png": b"\x89PNG\r\n\x1a\n",
    ".jpg": b"\xff\xd8\xff",
    ".jpeg": b"\xff\xd8\xff",
    ".webp": b"RIFF",  # plus "WEBP" at offset 8, checked below
}


def clean_filename(raw: str) -> str:
    """Last path component (``/`` or ``\\``) with unsafe characters replaced by ``_``.

    Not trimmed: callers choose how to strip edges and what an empty result means.
    """
    return UNSAFE_FILENAME_CHARS.sub("_", raw.replace("\\", "/").rsplit("/", 1)[-1])


def safe_filename(raw: str, *, fallback: str) -> str:
    """Clean name trimmed of whitespace then dots; ``fallback`` when nothing is left."""
    return clean_filename(raw).strip().strip(".") or fallback


def normalize_media_type(media_type: str) -> str:
    """``image/PNG; charset=x`` → ``image/png``."""
    return media_type.partition(";")[0].strip().lower()


def has_signature(extension: str, data: bytes) -> bool:
    """Whether ``data`` starts with the magic bytes of ``extension``'s format."""
    signature = _SIGNATURES.get(extension)
    if signature is None or not data.startswith(signature):
        return False
    return extension != ".webp" or data[8:12] == b"WEBP"


@dataclass(frozen=True, slots=True)
class SniffedUploadPolicy:
    """One domain's sniffed-upload rules and error vocabulary.

    Errors are ``{code_prefix}_EMPTY``, ``_TOO_LARGE`` and ``_BAD_FORMAT``;
    ``noun`` is the lower-case thing being uploaded ("receipt").
    """

    code_prefix: str
    noun: str
    extensions: frozenset[str]
    bad_format_message: str
    fallback_name: str
    max_bytes: int


def validate_sniffed_upload(
    policy: SniffedUploadPolicy, *, filename: str, data: bytes, media_type: str
) -> tuple[str, str]:
    """Check size, extension, declared media type and magic bytes.

    Returns ``(safe_name, normalized_media_type)``; raises 422 otherwise.
    """
    if not data:
        raise ValidationFailedError(
            f"{policy.code_prefix}_EMPTY", f"Uploaded {policy.noun} is empty."
        )
    if len(data) > policy.max_bytes:
        raise ValidationFailedError(
            f"{policy.code_prefix}_TOO_LARGE",
            f"{policy.noun.capitalize()} exceeds {policy.max_bytes // (1024 * 1024)} MiB.",
            size=len(data),
        )
    safe_name = safe_filename(filename, fallback=policy.fallback_name)
    extension = Path(safe_name).suffix.lower()
    normalized_media = normalize_media_type(media_type)
    allowed = extension in policy.extensions and has_signature(extension, data)
    if not allowed or normalized_media not in MEDIA_TYPES_BY_EXTENSION[extension]:
        raise ValidationFailedError(
            f"{policy.code_prefix}_BAD_FORMAT",
            policy.bad_format_message,
            extension=extension,
            media_type=media_type,
        )
    return safe_name, normalized_media


def resolve_under(root: Path, relative: str) -> Path | None:
    """``root / relative`` fully resolved (symlinks too), or ``None`` if it escapes ``root``.

    Existence is not checked: cleanup callers tolerate already-missing files.
    """
    base = root.resolve()
    path = (base / relative).resolve()
    return path if path.is_relative_to(base) else None
