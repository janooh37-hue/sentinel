"""Normalize free-text phone numbers (Employee.contact) to E.164 for WhatsApp.

The contact field is operator-entered and inconsistent (``05x``, ``+971…``,
spaces, dashes). WhatsApp requires E.164. We assume a default country code
(UAE ``971``) when none is present. Returns ``None`` when there are no usable
digits or the result is implausibly short, so callers fail loud rather than
sending to a garbage number.
"""

from __future__ import annotations

import re

_MIN_DIGITS = 8  # below this it cannot be a real international number


def normalize_phone(raw: str | None, default_cc: str = "971") -> str | None:
    if not raw:
        return None
    s = re.sub(r"[^\d+]", "", raw)
    if not s:
        return None
    if s.startswith("00"):          # 00971… → +971…
        s = "+" + s[2:]
    if s.startswith("+"):
        digits = s[1:]
        return "+" + digits if digits.isdigit() and len(digits) >= _MIN_DIGITS else None
    # No '+': bare digits. Decide whether the CC is already present.
    if s.startswith(default_cc):
        return "+" + s if len(s) >= _MIN_DIGITS else None
    if s.startswith("0"):           # local with trunk 0 → drop it, prepend CC
        s = s[1:]
    if len(s) < 6:                  # local part too short to be real
        return None
    return "+" + default_cc + s
