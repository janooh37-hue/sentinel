"""Absence records — the employee-facing writes for day-level absences.

An absence is a plain employee record: one ``absences`` row per day, stating a
fact about the employee the same way a sick-leave row does. The time sheet only
*reads* this table (``timesheet_service`` renders it as ``AB``); ownership of
record-side writes lives here.

Two write paths exist, deliberately separate:

- ``set_cell`` in the time sheet keeps its own add/clear, because it arbitrates
  against sheet-local overrides in the same unit of work.
- This module serves the employee record: list, range add, scoped delete, and
  the sick-leave supersede. A leave covering absent days removes those rows —
  the employee produced the paper — and returns the removed dates so the
  generation flow can announce the overwrite.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError, ValidationFailedError
from app.core.leave_lifecycle import english_part
from app.core.timesheet_codes import UNKNOWN_LEAVE, in_roster, is_void
from app.db.models import Absence, Employee, Leave


#: English leave types whose record explains an absence and therefore removes it.
SUPERSEDING_LEAVE_TYPES: Final[frozenset[str]] = frozenset(
    {"Sick Leave", "Annual Leave", "Leave Permit", "Administrative Leave"}
)


def supersedes_absence(leave_type: str) -> bool:
    """True for a leave whose paper explains the absence days it covers.

    Bilingual labels collapse via ``english_part``; ``"Unknown"`` keeps today's
    behaviour (treated as annual leave by ``timesheet_codes.leave_code``).
    """
    english = english_part(leave_type)
    return english == UNKNOWN_LEAVE or english in SUPERSEDING_LEAVE_TYPES


@dataclass
class AddRangeResult:
    """What a range add did: the rows it created, and the days it refused.

    ``skipped_off_roster`` holds the requested days outside the employee's
    roster window (before joining / after departure) — an absence there could
    never render on a sheet, so it is reported rather than recorded.
    ``skipped_on_leave`` holds days inside a non-void leave for which
    ``supersedes_absence`` is true; the leave already explains the day, so
    absence creation is refused and reported.
    """

    created: list[Absence]
    skipped_off_roster: list[date]
    skipped_on_leave: list[date]


def _get_employee_or_404(db: Session, employee_id: str) -> Employee:
    row = db.get(Employee, employee_id)
    if row is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id!r} does not exist",
            id=employee_id,
        )
    return row


def _covers_day(employee: Employee, day: date) -> bool:
    """Same roster window the time sheet computes, narrowed to one day."""

    return in_roster(doj=employee.doj, end_date=employee.end_date, month_start=day, month_end=day)


def _days_on_leave(db: Session, employee_id: str, start: date, end: date) -> set[date]:
    """Days in ``[start, end]`` inside a live leave that supersedes absence."""
    rows = db.execute(
        select(Leave.leave_type, Leave.status, Leave.start_date, Leave.end_date).where(
            Leave.employee_id == employee_id,
            Leave.deleted_at.is_(None),
            Leave.start_date <= end,
            Leave.end_date >= start,
        )
    ).all()
    covered: set[date] = set()
    for leave_type, status, leave_start, leave_end in rows:
        if is_void(status) or not supersedes_absence(leave_type):
            continue
        day = max(leave_start, start)
        while day <= min(leave_end, end):
            covered.add(day)
            day += timedelta(days=1)
    return covered


def list_for_employee(db: Session, employee_id: str) -> list[Absence]:
    """Every absence on the record, newest day first."""

    _get_employee_or_404(db, employee_id)
    return list(
        db.execute(
            select(Absence).where(Absence.employee_id == employee_id).order_by(Absence.date.desc())
        )
        .scalars()
        .all()
    )


def add_range(
    db: Session,
    employee_id: str,
    *,
    start: date,
    end: date,
    note: str | None = None,
    user_id: int | None = None,
    commit: bool = True,
) -> AddRangeResult:
    """Record an absence for every day in ``[start, end]`` (inclusive).

    Idempotent per day: a day already marked keeps its existing row and is not
    reported again, so a double-submit changes nothing. Days outside the
    employee's roster window are skipped and reported. Allowed on a closed
    time-sheet month on purpose: the record is fact, while the sheet that went
    out is protected by its snapshot.
    """

    if end < start:
        raise ValidationFailedError(
            "ABSENCE_RANGE_INVERTED",
            f"End date {end:%Y-%m-%d} is before start date {start:%Y-%m-%d}.",
            start=start.isoformat(),
            end=end.isoformat(),
        )
    employee = _get_employee_or_404(db, employee_id)

    existing = set(
        db.execute(
            select(Absence.date).where(
                Absence.employee_id == employee_id,
                Absence.date >= start,
                Absence.date <= end,
            )
        )
        .scalars()
        .all()
    )
    on_leave = _days_on_leave(db, employee_id, start, end)

    created: list[Absence] = []
    skipped_off_roster: list[date] = []
    skipped_on_leave: list[date] = []
    day = start
    while day <= end:
        if day in existing:
            pass
        elif not _covers_day(employee, day):
            skipped_off_roster.append(day)
        elif day in on_leave:
            skipped_on_leave.append(day)
        else:
            row = Absence(employee_id=employee_id, date=day, note=note, created_by=user_id)
            db.add(row)
            created.append(row)
        day += timedelta(days=1)
    db.commit() if commit else db.flush()
    return AddRangeResult(created, skipped_off_roster, skipped_on_leave)


@dataclass
class Episode:
    """A contiguous run of absence days — one row in the register table."""

    rows: list[Absence]

    @property
    def start(self) -> date:
        return self.rows[0].date

    @property
    def end(self) -> date:
        return self.rows[-1].date

    @property
    def day_count(self) -> int:
        return len(self.rows)

    @property
    def notes(self) -> str | None:
        """Distinct non-null day notes in day order, joined for the register."""
        seen: list[str] = []
        for row in self.rows:
            if row.note and row.note not in seen:
                seen.append(row.note)
        return "; ".join(seen) if seen else None


def list_episodes(db: Session, employee_id: str) -> list[Episode]:
    """Group the employee's absence days into contiguous episodes.

    Days that touch (``d`` then ``d + 1``) form one row — adding a new day
    that extends a run updates that row's end date. Any gap, including a
    single day (a sick-leave day in between, a rest day), starts a new row.
    """
    _get_employee_or_404(db, employee_id)
    rows = list(
        db.execute(
            select(Absence).where(Absence.employee_id == employee_id).order_by(Absence.date)
        ).scalars()
    )
    episodes: list[Episode] = []
    for row in rows:
        if episodes and row.date == episodes[-1].end + timedelta(days=1):
            episodes[-1].rows.append(row)
        else:
            episodes.append(Episode(rows=[row]))
    return episodes


def delete_range(db: Session, employee_id: str, start: date, end: date) -> int:
    """Un-mark every day in ``[start, end]``. Scoped to the employee.

    This is how an episode row is removed from the register: the UI deletes
    the whole run, not day by day. Returns the number of days removed.
    """
    if start > end:
        raise ValidationFailedError(
            "ABSENCE_RANGE_INVERTED",
            f"start_date {start} is after end_date {end}",
            start_date=str(start),
            end_date=str(end),
        )
    removed = delete_absences_covered_by(db, employee_id, start, end)
    return len(removed)


def delete_absences_covered_by(
    db: Session, employee_id: str, start: date, end: date, *, commit: bool = True
) -> list[date]:
    """Drop the absences a leave now covers, and return the removed dates.

    A sick certificate produced after the fact supersedes the absence it
    explains, so the row is removed rather than left to argue with the leave on
    the time sheet. Allowed on a closed month on purpose: the absence is the
    employee's record, while the sheet that went out is protected by its
    snapshot. The dates come back so document generation can announce the
    overwrite to the operator.

    ``commit=False`` is what document generation passes: the supersede belongs
    to the same unit of work as the leave row that caused it, so a later
    failure in the generation pipeline takes both back.
    """

    rows = list(
        db.execute(
            select(Absence)
            .where(
                Absence.employee_id == employee_id,
                Absence.date >= start,
                Absence.date <= end,
            )
            .order_by(Absence.date)
        ).scalars()
    )
    removed = [row.date for row in rows]
    for row in rows:
        db.delete(row)
    if commit:
        db.commit()
    else:
        db.flush()
    return removed


__all__ = [
    "SUPERSEDING_LEAVE_TYPES",
    "AddRangeResult",
    "Episode",
    "add_range",
    "delete_absences_covered_by",
    "delete_range",
    "list_episodes",
    "list_for_employee",
    "supersedes_absence",
]
