from __future__ import annotations

import re


G_NUMBER_RE = re.compile(r"\bG\d{3,4}\b", re.IGNORECASE)


def detect_g_numbers(text: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(match.group(0).upper() for match in G_NUMBER_RE.finditer(text)))
