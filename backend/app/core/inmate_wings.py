"""Canonical detention wings, in report order."""

from enum import StrEnum


class CanonicalWing(StrEnum):
    W1A = "1A"
    W1B = "1B"
    W2A = "2A"
    W2B = "2B"
    W3A = "3A"
    W3B = "3B"
    W4A = "4A"
    W4B = "4B"
    W5A = "5A"
    W5B = "5B"
    W6A = "6A"
    W6B = "6B"


CANONICAL_WINGS = tuple(CanonicalWing)


def normalize_wing(value: str | None) -> str | None:
    """Permit empty drafts; reject unknown codes without guessing aliases."""
    normalized = (value or "").strip().upper()
    if not normalized:
        return None
    try:
        return CanonicalWing(normalized).value
    except ValueError as exc:
        raise ValueError(
            "Wing must be one of 1A, 1B, 2A, 2B, 3A, 3B, 4A, 4B, 5A, 5B, 6A, 6B"
        ) from exc
