"""Effective attendance verdicts shared with the register's rowState in attendanceModel.ts."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

RowState = Literal[
    "verified", "grace", "late", "unpaired", "absent", "leave", "national_service", "pending"
]


@dataclass(frozen=True)
class JudgedRow:
    presence_state: str | None
    punch_count: int
    late_minutes: int | None
    grace_minutes: int | None
    absence_due_at: datetime | None
    judgment_due_at: datetime | None
    on_leave: bool = False
    leave_kind: str | None = None


def _as_utc(value: datetime) -> datetime:
    if value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def parse_instant(value: str | datetime | None) -> datetime | None:
    """Read an ISO instant as aware UTC; missing or invalid text has no boundary."""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    return _as_utc(value)


def _boundary_reached(due_at: datetime | None, now: datetime) -> bool:
    return due_at is not None and _as_utc(due_at) <= _as_utc(now)


def judge_register_row(
    row: JudgedRow, *, now: datetime, fallback_grace_minutes: int = 30
) -> tuple[RowState, int]:
    """Return the register state; only late verdicts contribute minutes past grace."""
    if row.on_leave or row.presence_state == "excused_leave":
        return ("national_service" if row.leave_kind == "national_service" else "leave", 0)
    if row.presence_state == "absent":
        return "absent", 0
    if row.punch_count == 0:
        if row.presence_state in ("completed", "on_duty"):
            return "verified", 0
        return ("absent" if _boundary_reached(row.absence_due_at, now) else "pending", 0)

    late_minutes = row.late_minutes if row.late_minutes is not None else 0
    grace_minutes = row.grace_minutes if row.grace_minutes is not None else fallback_grace_minutes
    minutes_past_grace = late_minutes - grace_minutes
    if minutes_past_grace > 0:
        return "late", minutes_past_grace
    if row.punch_count == 1 and _boundary_reached(row.judgment_due_at, now):
        return "unpaired", 0
    return ("grace" if late_minutes > 0 else "verified", 0)
