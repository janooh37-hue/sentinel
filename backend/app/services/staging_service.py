"""Staged-attachment store for the generate flow (spec 2026-06-11 §6).

``POST /documents/attachments/stage`` parks an upload under
``data/staged_attachments/{uuid4().hex}{ext}`` and hands the client an opaque
token; ``generate_document`` later resolves tokens back to files and merges
them into the combined PDF. Abandoned uploads need no cron: files older than
:data:`TTL_SECONDS` are purged opportunistically on each :func:`stage` call.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.api.errors import ValidationFailedError
from app.config import get_settings
from app.core.constants import ALLOWED_DOC_EXTS
from app.services.book_service import MAX_ATTACHMENT_BYTES

log = logging.getLogger(__name__)

STAGED_DIR_NAME = "staged_attachments"
TTL_SECONDS = 24 * 3600
_TOKEN_RE = re.compile(r"^[0-9a-f]{32}\.(pdf|png|jpg|jpeg)$")


@dataclass(frozen=True)
class StagedFile:
    """What the staging endpoint returns: ``{token, filename, size}``."""

    token: str
    filename: str
    size: int


def _staged_dir() -> Path:
    return get_settings().data_dir / STAGED_DIR_NAME


def _purge_stale(staged_dir: Path) -> None:
    """Drop token-shaped files older than the TTL; never touch anything else."""
    cutoff = time.time() - TTL_SECONDS
    for p in staged_dir.iterdir():
        if not p.is_file() or not _TOKEN_RE.fullmatch(p.name):
            continue
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
        except OSError:
            log.warning("could not purge stale staged file %s", p, exc_info=True)


def stage(data: bytes, filename: str) -> StagedFile:
    """Validate + park an upload; the returned token goes into the generate payload."""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise ValidationFailedError(
            "STAGED_BAD_EXTENSION",
            f"File type {ext!r} is not allowed",
            allowed=sorted(ALLOWED_DOC_EXTS),
        )
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ValidationFailedError(
            "STAGED_FILE_TOO_LARGE",
            f"File exceeds {MAX_ATTACHMENT_BYTES} bytes",
            max_bytes=MAX_ATTACHMENT_BYTES,
            size=len(data),
        )

    staged_dir = _staged_dir()
    staged_dir.mkdir(parents=True, exist_ok=True)
    _purge_stale(staged_dir)

    token = uuid.uuid4().hex + ext
    (staged_dir / token).write_bytes(data)
    log.info("staged attachment %s (%d bytes)", token, len(data))
    return StagedFile(token=token, filename=Path(filename).name, size=len(data))


def resolve(token: str) -> Path | None:
    """Token → staged file path; ``None`` when malformed, escaped, or gone.

    The token-shape check plus the containment check make a traversal payload
    (e.g. ``../../etc/passwd``) unresolvable rather than an error.
    """
    if not _TOKEN_RE.fullmatch(token):
        return None
    staged_dir = _staged_dir().resolve()
    candidate = (staged_dir / token).resolve()
    if staged_dir not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate


__all__ = [
    "STAGED_DIR_NAME",
    "TTL_SECONDS",
    "StagedFile",
    "resolve",
    "stage",
]
