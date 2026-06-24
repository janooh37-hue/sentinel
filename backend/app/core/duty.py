"""Duty-location seed vocabulary.

The 6 seed **units** are offered as suggestions in the roster/transfer UI; they
are *not* a hard enum — ``Employee.duty_unit`` is a free-form string so new units
may appear. Stored as the Arabic string.
"""

from __future__ import annotations

from typing import Final

# Order matters: the rail / dropdown renders them in this sequence.
SEED_UNITS: Final[tuple[str, ...]] = (
    "الدوام الرسمي",
    "السرية الأولى",
    "السرية الثانية",
    "السرية الثالثة",
    "السرية الرابعة",
    "السرية الخامسة",
)


def is_seed_unit(name: str | None) -> bool:
    """True when ``name`` is one of the 6 seed units (exact match)."""
    return name in SEED_UNITS
