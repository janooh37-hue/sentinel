"""Expiry-date classification shared by Vehicles and the Store."""

from __future__ import annotations

from datetime import date


def expiry_status(expiry: date, *, today: date, notify_days: int) -> str:
    """Classify ``expiry`` as ``"expired"``, ``"due"`` or ``"valid"``.

    Expiring today is ``"due"``, not expired; ``"due"`` covers the inclusive
    ``notify_days`` window.
    """
    days = (expiry - today).days
    if days < 0:
        return "expired"
    if days <= notify_days:
        return "due"
    return "valid"
