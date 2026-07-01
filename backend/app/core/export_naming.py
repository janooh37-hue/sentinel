"""Export-download filename rules (spec 2026-07-01).

Sick-leave PDFs are named by the employee's G-number ONLY (a management
request); every other document is ``<G-number>_<Arabic form name>``. Documents
with no linked employee (admin-category forms) fall back to
``<ref>_<Arabic form name>``. A blank Arabic name falls back to the English
``template_id``.
"""

from __future__ import annotations

import re

# Path separators / control chars PLUS unicode bidi-control, zero-width and BOM
# codepoints that pass ``isalnum`` but enable filename spoofing. Arabic letters
# are NOT in this class, so they survive. Mirrors leave_service._UNSAFE_CHARS.
_UNSAFE_CHARS = re.compile(
    # NOTE: copy this pattern verbatim from leave_service._UNSAFE_CHARS
    # (backend/app/services/leave_service.py) to stay in sync.
    '[\\/:*?"<>|\x00-\x1f​-‏‪-‮⁦-⁩﻿]'
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
    """Compose the download filename (including ``ext``, e.g. ``".pdf"``)."""
    name = _sanitize(arabic_name) or _sanitize(template_id)
    if is_sick_leave and employee_id:
        stem = _sanitize(employee_id)
    elif employee_id:
        stem = f"{_sanitize(employee_id)}_{name}"
    else:
        stem = f"{_sanitize(ref_number)}_{name}"
    return f"{stem}{ext}"
