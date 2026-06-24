from __future__ import annotations

import re

# UAE IBAN = "AE" + 21 digits = 23 chars. Allow spaces between groups in source.
_IBAN_RE = re.compile(r"AE(?:\s?\d){21}", re.IGNORECASE)


def _normalise(raw: str) -> str:
    return raw.replace(" ", "").upper()


def is_valid_iban(iban: str) -> bool:
    """ISO 13616 mod-97 check. Returns False on any malformed input."""
    s = _normalise(iban)
    if len(s) < 4 or not s[:2].isalpha() or not s[2:].isalnum():
        return False
    rearranged = s[4:] + s[:4]
    digits = "".join(str(int(ch, 36)) if ch.isalpha() else ch for ch in rearranged)
    if not digits.isdigit():
        return False
    return int(digits) % 97 == 1


def find_iban(text: str) -> str | None:
    """First mod-97-valid IBAN in ``text`` (spaces removed), else None."""
    for m in _IBAN_RE.finditer(text):
        candidate = _normalise(m.group())
        if is_valid_iban(candidate):
            return candidate
    return None
