"""Export-download filename rules (spec 2026-07-01).

Sick-leave PDFs are named by the employee's G-number ONLY (a management
request); every other document is `<G-number>_<Arabic form name>`. Documents
with no linked employee (admin-category forms) fall back to
`<ref>_<Arabic form name>`. A blank Arabic name falls back to the English
`template_id`.
"""

from __future__ import annotations

import re
from datetime import datetime

# Path separators / control chars PLUS unicode bidi-control, zero-width and BOM
# codepoints that pass `isalnum` but enable filename spoofing. Arabic letters
# are NOT in this class, so they survive.
_UNSAFE_CHARS = re.compile(
    # Extends leave_service._UNSAFE_CHARS with the path separators \\ and / .
    '[\\\\/:*?"<>|\x00-\x1f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]'
)


def _sanitize(part: str) -> str:
    return _UNSAFE_CHARS.sub("_", part).strip().strip(".")


def export_filename(
    *,
    employee_id: str | None,
    ref_number: str,
    template_id: str,
    arabic_name: str,
    is_sick_leave: bool,
    ext: str,
) -> str:
    """Compose the download filename (including `ext`, e.g. `".pdf"`)."""
    name = _sanitize(arabic_name) or _sanitize(template_id)
    if is_sick_leave and employee_id:
        stem = _sanitize(employee_id)
    elif employee_id:
        stem = f"{_sanitize(employee_id)}_{name}"
    else:
        stem = f"{_sanitize(ref_number)}_{name}"
    return f"{stem}{ext}"


def book_download_filename(*, ref: str, subject: str, when: datetime, ext: str) -> str:
    """User-facing download name for a General Book (serve layer only).

    Format: ``{ref-dashes} — {subject_slug} — {YYYY-MM-DD}{ext}``. ``_sanitize``
    is the sole sanitizer (strips quotes/CRLF/bidi marks, keeps Arabic). Stem
    capped at 80 chars. On-disk/WebDAV names are untouched — this is serve-only.
    """
    ref_slug = ref.replace("/", "-")
    subject_slug = _sanitize(subject)
    date_part = f" — {when:%Y-%m-%d}"
    prefix = f"{ref_slug} — "
    max_subject = max(0, 80 - len(prefix) - len(date_part))
    stem = f"{prefix}{subject_slug[:max_subject]}{date_part}"
    return f"{stem}{ext}"
