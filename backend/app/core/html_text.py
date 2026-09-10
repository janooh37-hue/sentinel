"""Plain-text conversion for editor HTML."""

from __future__ import annotations

import re


def html_to_text(html: str | None) -> str:
    """Flatten editor HTML while preserving paragraph and line boundaries.

    Markup is removed, surrounding whitespace is trimmed, and excessive blank
    runs are collapsed. An open month's statistics projection and its closed
    snapshot must be byte-identical, so this function is the single
    implementation of that conversion.
    """
    if not html or "<" not in html:
        return html or ""
    # Block-closing / break tags → newline before tags are stripped.
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", html)
    text = re.sub(r"(?i)</\s*(p|div|li|tr|h[1-6]|blockquote)\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    # Decode the handful of entities HugeRTE emits.
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    # Collapse the runs of blank lines the block-boundary mapping can create.
    text = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", text)
    return text.strip()
