"""Shared clocks: naive-UTC timestamps and the organisation's calendar date.

Stored timestamps are naive UTC (the v3 data convention). The organisation's
"today" is the UAE calendar date; it is a separate contract and is never
derived from the naive-UTC timestamp.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

ORGANIZATION_TIMEZONE = ZoneInfo("Asia/Dubai")


def utcnow() -> datetime:
    """Naive UTC timestamp — matches the rest of the v3 data (no tz info)."""
    return datetime.now(UTC).replace(tzinfo=None)


def organization_today() -> date:
    """The organisation's (UAE) calendar date, not the UTC date."""
    return datetime.now(ORGANIZATION_TIMEZONE).date()
