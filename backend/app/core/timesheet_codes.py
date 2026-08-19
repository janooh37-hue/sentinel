"""Pure day-code rules for the monthly time sheet.

One employee-month resolves to at most 31 single-cell codes. Everything here is
a pure function over plain values — no DB, no Excel — so the rules can be
unit-tested and reused by the time-sheet service, the client-statistics
variant, and the 2026 history import alike.

Rules (measured against the June/July 2026 workbooks on the finance share; see
``docs/superpowers/specs/2026-08-19-monthly-timesheet-design.md``):

* **Precedence**, low to high: ``P`` → ``AL`` → ``TR`` → ``SL`` → ``AB`` →
  roster edge (``NG`` / ``-``) → manual override. Roster edges outrank leave: a
  leave record reaching past someone's last working day cannot make them
  present. An override outranks everything.
* **Leave is a per-day union, never a sum.** Overlapping records of the same
  type are idempotent. This is required, not cosmetic: employee G3006 carries
  three overlapping annual-leave rows that add to 64 days inside a 31-day July.
* **Only three leave kinds consume a day** — annual, sick, national service.
  Administrative leave, leave permits, duty leave, passport release and duty
  resumption all leave the employee counted present, which is what the hand-kept
  July sheet does.
* ``NG`` covers days before the join date, ``-`` days after ``end_date``. The
  last working day *is* ``end_date``.
* Days past the end of the month are ``None`` — the day-31 column stays empty in
  a 30-day month.

``CODE_SICK`` keeps its trailing space on purpose. The workbook's per-row sick
total is ``COUNTIF(F:AJ,$AO$5)`` and ``AO5`` holds ``"SL "``; dropping the space
silently zeroes that column.
"""

from __future__ import annotations

import calendar
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Final

CODE_PRESENT: Final[str] = "P"
CODE_ANNUAL: Final[str] = "AL"
CODE_SICK: Final[str] = "SL "
CODE_ABSENT: Final[str] = "AB"
CODE_NATIONAL: Final[str] = "TR"
CODE_NEW: Final[str] = "NG"
CODE_OFF_ROSTER: Final[str] = "-"

#: Every code the renderer may emit, in legend order.
EMITTED_CODES: Final[tuple[str, ...]] = (
    CODE_PRESENT,
    CODE_ANNUAL,
    CODE_SICK,
    CODE_ABSENT,
    CODE_NATIONAL,
    CODE_NEW,
    CODE_OFF_ROSTER,
)

#: English leave-type prefix → day code. Matched against the English half of the
#: bilingual ``Leave.leave_type`` values (e.g. ``"Sick Leave - الإجازة المرضية"``).
LEAVE_TYPE_CODES: Final[Mapping[str, str]] = {
    "Annual Leave": CODE_ANNUAL,
    "Sick Leave": CODE_SICK,
    "National Service": CODE_NATIONAL,
}

#: Leave kinds that do NOT change the day code — the employee stays present.
PRESENT_LEAVE_TYPES: Final[frozenset[str]] = frozenset(
    {
        "Administrative Leave",
        "Leave Permit",
        "Duty Leave",
        "Duty Resumption",
        "Passport Release",
        "Others",
    }
)

#: Leave statuses that never reach the sheet.
VOID_LEAVE_STATUSES: Final[tuple[str, ...]] = ("Cancelled", "Rejected")

_RANK: Final[Mapping[str, int]] = {
    CODE_PRESENT: 0,
    CODE_ANNUAL: 1,
    CODE_NATIONAL: 2,
    CODE_SICK: 3,
    CODE_ABSENT: 4,
}
_ROSTER_EDGE_RANK: Final[int] = 5


@dataclass(frozen=True, slots=True)
class LeaveSpan:
    """One leave record, reduced to what the grid cares about."""

    leave_type: str
    start: date
    end: date
    status: str = "Approved"


def english_leave_type(leave_type: str) -> str:
    """English half of a bilingual ``"English - عربي"`` leave type."""

    return leave_type.split(" - ", 1)[0].strip()


def leave_code(leave_type: str) -> str | None:
    """Day code for a leave type, or ``None`` when the day stays present.

    ``"Unknown"`` — a leave whose type was lost during form generation — is
    treated as annual leave, which is what every such row in the 2026 data
    turned out to be.
    """

    english = english_leave_type(leave_type)
    if english == "Unknown":
        return CODE_ANNUAL
    return LEAVE_TYPE_CODES.get(english)


def is_void(status: str) -> bool:
    """True for a leave status that must not reach the sheet."""

    return status.startswith(VOID_LEAVE_STATUSES)


def in_roster(
    *, doj: date | None, end_date: date | None, month_start: date, month_end: date
) -> bool:
    """True when the employee was employed for at least one day of the month.

    A departure keeps the employee on the sheet for the month they left — that
    is the copy HR receives on termination — and drops them the month after.
    """

    if doj is not None and doj > month_end:
        return False
    return not (end_date is not None and end_date < month_start)


def month_codes(
    year: int,
    month: int,
    *,
    doj: date | None = None,
    end_date: date | None = None,
    leaves: Iterable[LeaveSpan] = (),
    absences: Collection[date] = (),
    overrides: Mapping[int, str] | None = None,
) -> list[str | None]:
    """Resolve one employee-month to 31 cells (``None`` past the month end).

    ``overrides`` is keyed by day of month (1-based) and wins over every rule.
    """

    days_in_month = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, days_in_month)

    codes: list[str | None] = [CODE_PRESENT] * days_in_month + [None] * (31 - days_in_month)
    ranks = [0] * days_in_month

    for span in leaves:
        if is_void(span.status):
            continue
        code = leave_code(span.leave_type)
        if code is None:
            continue
        rank = _RANK[code]
        first = max(span.start, month_start)
        last = min(span.end, month_end)
        if first > last:
            continue
        for day in range(first.day, last.day + 1):
            if rank > ranks[day - 1]:
                codes[day - 1] = code
                ranks[day - 1] = rank

    absent_rank = _RANK[CODE_ABSENT]
    for day_date in absences:
        if day_date.year != year or day_date.month != month:
            continue
        if absent_rank > ranks[day_date.day - 1]:
            codes[day_date.day - 1] = CODE_ABSENT
            ranks[day_date.day - 1] = absent_rank

    for day in range(1, days_in_month + 1):
        current = date(year, month, day)
        if doj is not None and current < doj:
            codes[day - 1] = CODE_NEW
            ranks[day - 1] = _ROSTER_EDGE_RANK
        elif end_date is not None and current > end_date:
            codes[day - 1] = CODE_OFF_ROSTER
            ranks[day - 1] = _ROSTER_EDGE_RANK

    for day, code in (overrides or {}).items():
        if 1 <= day <= days_in_month:
            codes[day - 1] = code

    return codes
