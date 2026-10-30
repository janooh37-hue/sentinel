"""Shared clocks: naive-UTC timestamps for stored rows.

Stored timestamps are naive UTC (the v3 data convention). Calendar dates the
organisation reasons about are a different contract and are not derived from
these timestamps.
"""

from __future__ import annotations

from datetime import UTC, datetime


def utcnow() -> datetime:
    """Naive UTC timestamp — matches the rest of the v3 data (no tz info)."""
    return datetime.now(UTC).replace(tzinfo=None)
