"""The monthly time-sheet grid: one month of one site resolved to printable rows.

Two deliverables come off the same grid. The HR attendance sheet prints
``GridRow.codes`` — the truth about each day — while the Main client statistics
sheet transfers real ``AL``/``SL``/``AB``/``TR`` cells from higher-ranked
contracted rows into available lower-ranked ``P`` cells. A contracted row reads
as manned only when a lower row actually carries its code, so the client view
neither invents leave nor hides leave that nobody compensated. Drivers retains
its historical per-row filler transform.

Day codes themselves are not decided here. :mod:`app.core.timesheet_codes` owns
that as a pure function of dates, leave rows, absences and manual overrides; this
module's job is to decide *who* is on the sheet, in what order, and which of the
two blocks each row lands in — and to freeze the answer when the month closes,
because the sheet goes to HQ HR and to the client and a later re-download must
reproduce what they hold rather than absorb a leave recorded afterwards.

Loads are batched per month, never per row: the main sheet is 275 rows and the
filler lookback alone would otherwise be 275 round trips.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Final

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.core.constants import DESIGNATION_SEED, TIMESHEET_SHEETS, nationality_en
from app.core.leave_lifecycle import english_part
from app.core.timesheet_codes import (
    CODE_ABSENT,
    CODE_ANNUAL,
    CODE_NATIONAL,
    CODE_NEW,
    CODE_OFF_ROSTER,
    CODE_PRESENT,
    CODE_SICK,
    EMITTED_CODES,
    UNKNOWN_LEAVE,
    LeaveSpan,
    in_roster,
    is_void,
    month_codes,
)
from app.db.models import (
    Absence,
    Employee,
    Leave,
    TimesheetDesignation,
    TimesheetOverride,
    TimesheetPeriod,
    TimesheetRosterAssignment,
    TimesheetSnapshotRow,
    TimesheetStartAck,
    TimesheetStatFiller,
    User,
)
from app.schemas.timesheet import TimesheetRosterAssignmentWrite

#: The manual red block: a day the operator declares outside the billing window.
#: Derived by nothing — the engine never emits it — and kept by both statistics
#: blocks, because forcing it to ``P`` would put the day back on the invoice.
CODE_BLOCKED: Final[str] = "X"

#: Contracted posts for a month with no ``TimesheetPeriod`` row.
DEFAULT_POST_COUNT: Final[int] = 249

#: Block 2's code when nobody ever chose one for that employee.
DEFAULT_STAT_FILLER: Final[str] = CODE_ANNUAL

#: The two workbooks. Drivers have always been reported separately.
SHEETS: Final[tuple[str, str]] = TIMESHEET_SHEETS

#: What :func:`set_cell` and :func:`set_filler` accept. ``EMITTED_CODES`` is a
#: *tuple*, so it is unpacked — ``EMITTED_CODES | {...}`` is a ``TypeError``.
CELL_CODES: Final[frozenset[str]] = frozenset({*EMITTED_CODES, CODE_BLOCKED})

#: The cells the statistics transform leaves alone. Both roster edges, because a
#: day off the roster is not a manned post; and ``X`` in **both** blocks, because
#: a red-blocked day is outside the billing window and forcing it to ``P`` would
#: put it back on the client's invoice. Block 2 additionally keeps a real ``AB``:
#: an absence is not the filler the operator chose.
STAT_KEEP_BLOCK_1: Final[frozenset[str]] = frozenset({CODE_NEW, CODE_OFF_ROSTER, CODE_BLOCKED})
STAT_KEEP_BLOCK_2: Final[frozenset[str]] = STAT_KEEP_BLOCK_1 | {CODE_ABSENT}

#: The lower block is printed in this order after rank-first source selection.
_STAT_TRANSFER_ORDER: Final[dict[str, int]] = {
    CODE_ANNUAL: 0,
    CODE_SICK: 1,
    CODE_ABSENT: 2,
    CODE_NATIONAL: 3,
}


#: Sorts a row with no rank behind every ranked one.
_UNRANKED: Final[int] = 10**9


@dataclass(frozen=True, slots=True)
class GridRow:
    employee_id: str
    row_no: int
    name_en: str
    nationality_en: str | None
    designation_en: str | None
    designation_ar: str | None
    rank_order: int | None
    codes: list[str | None]  # 31 entries, None past month end
    stat_codes: list[str | None]  # the client variant of the same row
    stat_block: int  # 1 = billable block, 2 = surplus
    stat_filler: str | None  # block 2's assigned code, None in block 1
    joined_day: int | None  # doj falls inside this month -> NG head
    left_day: int | None  # end_date falls inside this month -> `-` tail
    start_confirmed: bool  # operator acknowledged the NG head
    notes: dict[int, str]  # day -> absence note, for the cell tooltip
    designation_id: int | None = None


@dataclass(frozen=True, slots=True)
class Issue:
    employee_id: str
    kind: str
    #  blocking: "no_designation" | "no_nationality"
    #  warning:  "unknown_leave" | "overlapping_leave" | "departed_but_active"
    #            | "no_doj" | "duplicate_name"
    detail: str


@dataclass(frozen=True, slots=True)
class Removed:
    """Someone who finished LAST month and is therefore not on this roster.

    Reported so the page can say who dropped off and why: this is the rule the
    client's invoice depends on, and it is invisible by construction.
    """

    employee_id: str
    name_en: str
    end_date: date
    last_day: int  # day of the month he finished
    month: int  # the month he finished in
    year: int  # ...and its year, so a Dec -> Jan step still reads right


@dataclass(frozen=True, slots=True)
class MonthGrid:
    year: int
    month: int
    days_in_month: int
    sheet: str  # "main" | "drivers"
    post_count: int
    rows: list[GridRow]
    blocking: list[Issue]
    warnings: list[Issue]
    removed: list[Removed]  # departures that took effect before this month
    closed_at: datetime | None
    closed_by: str | None  # the display name behind TimesheetPeriod.closed_by


# --------------------------------------------------------------------------- #
# small pure helpers
# --------------------------------------------------------------------------- #


def _utcnow() -> datetime:
    """Naive UTC, matching every other timestamp column in this database."""

    return datetime.now(UTC).replace(tzinfo=None)


def _month_bounds(year: int, month: int) -> tuple[int, date, date]:
    days_in_month = calendar.monthrange(year, month)[1]
    return days_in_month, date(year, month, 1), date(year, month, days_in_month)


def previous_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _id_sort_key(employee_id: str) -> tuple[int, str]:
    digits = employee_id.lstrip("Gg")
    return (int(digits), "") if digits.isdigit() else (_UNRANKED, employee_id)


def _statistics_codes(codes: list[str | None], *, block: int, filler: str) -> list[str | None]:
    """Block 1 shows a manned post; block 2 is parked off the presence total.

    ``X`` is kept in BOTH blocks (rule 12): a red-blocked day is outside the
    billing window, and forcing it to ``P`` puts it back on the client's invoice.
    """

    keep = STAT_KEEP_BLOCK_1 if block == 1 else STAT_KEEP_BLOCK_2
    replacement = CODE_PRESENT if block == 1 else filler
    return [None if c is None else (c if c in keep else replacement) for c in codes]


def _compensated_day(
    codes: Sequence[str | None], post_count: int
) -> list[str | None]:
    """Move real above-contract codes into available lower ``P`` cells."""

    result = list(codes)
    boundary = min(post_count, len(codes))
    sources: list[tuple[int, str]] = []
    for index, code in enumerate(codes[:boundary]):
        if code is not None and code in _STAT_TRANSFER_ORDER:
            sources.append((index, code))
    targets = [
        index
        for index, code in enumerate(codes[boundary:], start=boundary)
        if code == CODE_PRESENT
    ]

    moved = sources[: len(targets)]
    for index, _code in moved:
        result[index] = CODE_PRESENT
    moved_codes = sorted(
        (code for _index, code in moved),
        key=_STAT_TRANSFER_ORDER.__getitem__,
    )
    for index, code in zip(targets, moved_codes, strict=False):
        result[index] = code
    return result


def _apply_main_statistics(rows: Sequence[GridRow], post_count: int) -> None:
    """Derive Main statistics independently for each wire day."""

    if not rows:
        return
    for day_index in range(len(rows[0].codes)):
        compensated = _compensated_day(
            [row.codes[day_index] for row in rows],
            post_count,
        )
        for row, code in zip(rows, compensated, strict=True):
            row.stat_codes[day_index] = code


def _edge_day(value: date | None, year: int, month: int) -> int | None:
    """A roster edge reported as a day number, when it falls inside this month."""

    if value is not None and (value.year, value.month) == (year, month):
        return value.day
    return None


def _notes(absences: Iterable[Absence]) -> dict[int, str]:
    """Day -> absence note, so the cell tooltip needs no second request."""

    return {row.date.day: row.note for row in absences if row.note}


def _covers_day(employee: Employee, day: date) -> bool:
    """True when ``day`` is inside the employee's roster window.

    Exactly the call :func:`in_roster` makes for a whole month, narrowed to one
    day, so this can never disagree with the ``NG`` / ``-`` cells the engine
    writes from the same two dates.
    """

    return in_roster(doj=employee.doj, end_date=employee.end_date, month_start=day, month_end=day)


def _lists_on(designation: TimesheetDesignation | None, sheet: str) -> bool:
    """Whether a roster member is printed on ``sheet``.

    A designation routes to its own workbook. An employee with **no** designation
    is listed on the main sheet only — where he also raises a blocking issue —
    rather than silently vanishing from both deliverables.
    """

    if designation is None:
        return sheet == SHEETS[0]
    return designation.sheet == sheet


def _routes_to(designation: TimesheetDesignation | None, sheet: str) -> bool:
    """Whether a departure is reported as removed from ``sheet``.

    Stricter than :func:`_lists_on` on purpose: someone with no designation was
    on no workbook, so he cannot have dropped off one.
    """

    return designation is not None and designation.sheet == sheet


def _row_sort_key(
    employee: Employee, designation: TimesheetDesignation | None
) -> tuple[int, tuple[int, str]]:
    """Rank first, then the numeric part of the ID; unranked and non-numeric last."""

    rank = designation.rank_order if designation is not None else None
    return (_UNRANKED if rank is None else rank, _id_sort_key(employee.id))


def _leave_spans(leaves: Iterable[Leave]) -> list[LeaveSpan]:
    return [LeaveSpan(row.leave_type, row.start_date, row.end_date, row.status) for row in leaves]


def _live_leaves(leaves: Iterable[Leave]) -> list[Leave]:
    """Leaves that reach the sheet: not soft-deleted, not cancelled or rejected."""

    return [row for row in leaves if not is_void(row.status)]


# --------------------------------------------------------------------------- #
# batched month loads
# --------------------------------------------------------------------------- #


def _designations_by_id(db: Session) -> dict[int, TimesheetDesignation]:
    return {row.id: row for row in db.execute(select(TimesheetDesignation)).scalars()}


def _roster_assignments_on(db: Session, month_start: date) -> dict[str, TimesheetRosterAssignment]:
    latest = (
        select(
            TimesheetRosterAssignment.employee_id,
            func.max(TimesheetRosterAssignment.effective_from).label("effective_from"),
        )
        .where(TimesheetRosterAssignment.effective_from <= month_start)
        .group_by(TimesheetRosterAssignment.employee_id)
        .subquery()
    )
    rows = db.execute(
        select(TimesheetRosterAssignment).join(
            latest,
            and_(
                TimesheetRosterAssignment.employee_id == latest.c.employee_id,
                TimesheetRosterAssignment.effective_from == latest.c.effective_from,
            ),
        )
    ).scalars()
    return {row.employee_id: row for row in rows}


def _designation_for(
    employee_id: str,
    assignments: Mapping[str, TimesheetRosterAssignment],
    designations: Mapping[int, TimesheetDesignation],
) -> TimesheetDesignation | None:
    assignment = assignments.get(employee_id)
    if assignment is None or assignment.designation_id is None:
        return None
    return designations.get(assignment.designation_id)


def _period(db: Session, year: int, month: int) -> TimesheetPeriod | None:
    return db.execute(
        select(TimesheetPeriod).where(TimesheetPeriod.year == year, TimesheetPeriod.month == month)
    ).scalar_one_or_none()


def _roster(db: Session, month_start: date, month_end: date) -> list[Employee]:
    """Everyone employed for at least one day of the month.

    A departure keeps the employee on the sheet for the month he left — that is
    the copy HR receives on termination — and drops him the month after.

    The predicate is deliberately not pushed into the WHERE clause.
    :func:`in_roster` is the one place the two roster edges are decided, and the
    engine reads the same pair of dates when it writes the ``NG`` head and the
    ``-`` tail; a hand-written SQL copy of it is a second definition that can
    drift. The table is the site's staff — a few hundred rows — so reading all of
    it is cheaper than the risk.
    """

    return [
        employee
        for employee in db.execute(select(Employee)).scalars()
        if in_roster(
            doj=employee.doj,
            end_date=employee.end_date,
            month_start=month_start,
            month_end=month_end,
        )
    ]


def _leaves_by_employee(db: Session, month_start: date, month_end: date) -> dict[str, list[Leave]]:
    rows = db.execute(
        select(Leave).where(
            Leave.deleted_at.is_(None),
            Leave.start_date <= month_end,
            Leave.end_date >= month_start,
        )
    ).scalars()
    out: dict[str, list[Leave]] = defaultdict(list)
    for row in rows:
        out[row.employee_id].append(row)
    return out


def _absences_by_employee(
    db: Session, month_start: date, month_end: date
) -> dict[str, list[Absence]]:
    rows = db.execute(
        select(Absence).where(Absence.date >= month_start, Absence.date <= month_end)
    ).scalars()
    out: dict[str, list[Absence]] = defaultdict(list)
    for row in rows:
        out[row.employee_id].append(row)
    return out


def _overrides_by_employee(db: Session, year: int, month: int) -> dict[str, dict[int, str]]:
    rows = db.execute(
        select(TimesheetOverride).where(
            TimesheetOverride.year == year, TimesheetOverride.month == month
        )
    ).scalars()
    out: dict[str, dict[int, str]] = defaultdict(dict)
    for row in rows:
        out[row.employee_id][row.day] = row.code
    return out


def _fillers_by_employee(db: Session, year: int, month: int) -> dict[str, str]:
    """Latest block-2 filler choice at or before this month, in one query.

    The choice carries forward from the most recent *earlier* month that has one
    — not from last month, because the operator is allowed to skip months and
    "the shape is set once" has to survive that. The grouped subquery bounds the
    lookback in SQL and selects only the latest row per employee instead of
    materialising the full history.
    """

    month_index = year * 12 + month
    latest = (
        select(
            TimesheetStatFiller.employee_id.label("employee_id"),
            func.max(TimesheetStatFiller.year * 12 + TimesheetStatFiller.month).label(
                "month_index"
            ),
        )
        .where(TimesheetStatFiller.year * 12 + TimesheetStatFiller.month <= month_index)
        .group_by(TimesheetStatFiller.employee_id)
        .subquery()
    )
    rows = db.execute(
        select(TimesheetStatFiller).join(
            latest,
            and_(
                TimesheetStatFiller.employee_id == latest.c.employee_id,
                TimesheetStatFiller.year * 12 + TimesheetStatFiller.month == latest.c.month_index,
            ),
        )
    ).scalars()
    return {row.employee_id: row.code for row in rows}


def _start_acks(db: Session, year: int, month: int) -> set[str]:
    return set(
        db.execute(
            select(TimesheetStartAck.employee_id).where(
                TimesheetStartAck.year == year, TimesheetStartAck.month == month
            )
        ).scalars()
    )


def _employees_by_id(db: Session, employee_ids: Sequence[str]) -> dict[str, Employee]:
    if not employee_ids:
        return {}
    rows = db.execute(select(Employee).where(Employee.id.in_(employee_ids))).scalars()
    return {row.id: row for row in rows}


def _display_name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    user = db.get(User, user_id)
    if user is None:
        return None
    return user.display_name or user.email


# --------------------------------------------------------------------------- #
# preflight
# --------------------------------------------------------------------------- #


def _blocking_issues(
    members: Sequence[tuple[Employee, TimesheetDesignation | None]],
) -> list[Issue]:
    """What must be fixed before the workbook can be produced.

    Both columns are printed, and neither has a defensible fallback: a blank
    designation loses the row's place in the client's ranked roster, and an
    unmapped nationality would print Arabic into an English column.
    """

    issues: list[Issue] = []
    for employee, designation in members:
        if designation is None:
            issues.append(
                Issue(employee.id, "no_designation", f"{employee.name_en} has no designation.")
            )
        if nationality_en(employee.nationality) is None:
            issues.append(
                Issue(
                    employee.id,
                    "no_nationality",
                    f"{employee.name_en}: nationality {employee.nationality or '(blank)'} "
                    "has no English label.",
                )
            )
    return issues


def _overlapping_leave_issues(employee: Employee, leaves: Sequence[Leave]) -> list[Issue]:
    """Two live leave rows of the same type whose ranges intersect.

    Same-type only: an annual leave inside a national-service stint is a ranking
    question the engine already answers, while two overlapping annual leaves are
    a double entry nobody meant to file.
    """

    by_type: dict[str, list[Leave]] = defaultdict(list)
    for row in leaves:
        by_type[english_part(row.leave_type)].append(row)

    issues: list[Issue] = []
    for leave_type, rows in by_type.items():
        rows.sort(key=lambda row: row.start_date)
        covered_to = rows[0].end_date
        for row in rows[1:]:
            if row.start_date <= covered_to:
                issues.append(
                    Issue(
                        employee.id,
                        "overlapping_leave",
                        f"{employee.name_en}: two {leave_type} rows overlap on "
                        f"{row.start_date:%Y-%m-%d}.",
                    )
                )
            covered_to = max(covered_to, row.end_date)
    return issues


def _warning_issues(
    db: Session,
    members: Sequence[tuple[Employee, TimesheetDesignation | None]],
    *,
    leaves_by_employee: Mapping[str, list[Leave]],
    assignments: Mapping[str, TimesheetRosterAssignment],
    designations: Mapping[int, TimesheetDesignation],
    month_start: date,
    sheet: str,
) -> list[Issue]:
    """Everything worth telling the operator that does not stop the download."""

    issues: list[Issue] = []
    names: dict[str, list[Employee]] = defaultdict(list)

    for employee, _designation in members:
        names[employee.name_en].append(employee)
        if employee.doj is None:
            issues.append(
                Issue(employee.id, "no_doj", f"{employee.name_en} has no date of joining.")
            )
        leaves = _live_leaves(leaves_by_employee.get(employee.id, ()))
        for row in leaves:
            if english_part(row.leave_type) == UNKNOWN_LEAVE:
                issues.append(
                    Issue(
                        employee.id,
                        "unknown_leave",
                        f"{employee.name_en}: leave from {row.start_date:%Y-%m-%d} has no type; "
                        "counted as annual leave.",
                    )
                )
        issues.extend(_overlapping_leave_issues(employee, leaves))

    for name, sharers in names.items():
        if len(sharers) > 1:
            issues.extend(
                Issue(employee.id, "duplicate_name", f"{name} appears {len(sharers)} times.")
                for employee in sharers
            )

    # Off the roster but still marked Active: the departure explains a row the
    # operator expected to see, so it is reported even though there is no row.
    departed = db.execute(
        select(Employee).where(
            Employee.end_date.is_not(None),
            Employee.end_date < month_start,
            Employee.status == "Active",
        )
    ).scalars()
    issues.extend(
        Issue(
            employee.id,
            "departed_but_active",
            f"{employee.name_en} finished on {employee.end_date:%Y-%m-%d} but is still Active.",
        )
        for employee in departed
        if employee.end_date is not None
        and _lists_on(_designation_for(employee.id, assignments, designations), sheet)
    )
    return issues


def _sealed_issues(rows: Sequence[GridRow]) -> list[Issue]:
    """The preflight for a closed month, read off the frozen rows.

    Deliberately not recomputed from the live employee records: the sheet has
    already gone out, and a designation edited next year must not be able to make
    a workbook the client already holds refuse to re-download.
    """

    issues: list[Issue] = []
    for row in rows:
        if row.designation_en is None:
            issues.append(
                Issue(
                    row.employee_id,
                    "no_designation",
                    f"{row.name_en} was sealed with no designation.",
                )
            )
        if row.nationality_en is None:
            issues.append(
                Issue(
                    row.employee_id,
                    "no_nationality",
                    f"{row.name_en} was sealed with no nationality.",
                )
            )
    return issues


def _removed(
    db: Session,
    year: int,
    month: int,
    *,
    designations: Mapping[int, TimesheetDesignation],
    sheet: str,
) -> list[Removed]:
    """Who was on last month's workbook and is deliberately absent from this one."""

    prev_year, prev_month = previous_month(year, month)
    _, prev_start, prev_end = _month_bounds(prev_year, prev_month)
    assignments = _roster_assignments_on(db, prev_start)
    candidates = db.execute(
        select(Employee).where(Employee.end_date >= prev_start, Employee.end_date <= prev_end)
    ).scalars()

    out: list[Removed] = []
    for employee in candidates:
        if employee.end_date is None:
            continue
        if not _routes_to(_designation_for(employee.id, assignments, designations), sheet):
            continue
        out.append(
            Removed(
                employee_id=employee.id,
                name_en=employee.name_en,
                end_date=employee.end_date,
                last_day=employee.end_date.day,
                month=prev_month,
                year=prev_year,
            )
        )
    out.sort(key=lambda row: (row.last_day, _id_sort_key(row.employee_id)))
    return out


# --------------------------------------------------------------------------- #
# the grid
# --------------------------------------------------------------------------- #


def _members(
    db: Session,
    *,
    month_start: date,
    month_end: date,
    assignments: Mapping[str, TimesheetRosterAssignment],
    designations: Mapping[int, TimesheetDesignation],
    sheet: str,
) -> list[tuple[Employee, TimesheetDesignation | None]]:
    """The sheet's roster in printed order, each member with its designation.

    Needed by both branches of :func:`build_month`: the live one turns it into
    rows, and the sealed one still reports warnings off it, because a warning is
    about the live records rather than about the workbook that went out.
    """

    members = [
        (employee, designation)
        for employee, designation in (
            (
                employee,
                _designation_for(employee.id, assignments, designations),
            )
            for employee in _roster(db, month_start, month_end)
        )
        if _lists_on(designation, sheet)
    ]
    members.sort(key=lambda member: _row_sort_key(*member))
    return members


def _live_rows(
    db: Session,
    year: int,
    month: int,
    *,
    sheet: str,
    members: Sequence[tuple[Employee, TimesheetDesignation | None]],
    leaves_by_employee: Mapping[str, list[Leave]],
    post_count: int,
    absences: Mapping[str, list[Absence]],
    fillers: Mapping[str, str],
    acks: set[str],
) -> list[GridRow]:
    """Recompute the whole sheet from the live records."""

    overrides = _overrides_by_employee(db, year, month)

    rows: list[GridRow] = []
    for row_no, (employee, designation) in enumerate(members, start=1):
        employee_absences = absences.get(employee.id, [])
        codes = month_codes(
            year,
            month,
            doj=employee.doj,
            end_date=employee.end_date,
            leaves=_leave_spans(leaves_by_employee.get(employee.id, ())),
            absences=[row.date for row in employee_absences],
            overrides=overrides.get(employee.id),
        )
        block = 1 if row_no <= post_count else 2
        filler = fillers.get(employee.id, DEFAULT_STAT_FILLER)
        rows.append(
            GridRow(
                employee_id=employee.id,
                row_no=row_no,
                name_en=employee.name_en,
                nationality_en=nationality_en(employee.nationality),
                designation_en=designation.name_en if designation is not None else None,
                designation_ar=designation.name_ar if designation is not None else None,
                rank_order=designation.rank_order if designation is not None else None,
                codes=codes,
                stat_codes=(
                    list(codes)
                    if sheet == "main"
                    else _statistics_codes(codes, block=block, filler=filler)
                ),
                stat_block=block,
                stat_filler=filler if block == 2 else None,
                joined_day=_edge_day(employee.doj, year, month),
                left_day=_edge_day(employee.end_date, year, month),
                start_confirmed=employee.id in acks,
                notes=_notes(employee_absences),
                designation_id=designation.id if designation is not None else None,
            )
        )

    if sheet == "main":
        _apply_main_statistics(rows, post_count)

    return rows


def _sealed_rows(
    db: Session,
    period: TimesheetPeriod,
    *,
    sheet: str,
    absences: Mapping[str, list[Absence]],
    fillers: Mapping[str, str],
    acks: set[str],
) -> list[GridRow]:
    """The frozen sheet, plus the five fields the snapshot deliberately omits.

    ``TimesheetSnapshotRow`` stores identity, ``codes``, ``stat_codes`` and
    ``stat_block`` — the part that was printed and must never move. The rest is
    recomputed from sources that are either immutable history (``doj`` /
    ``end_date``) or deliberately still mutable: absence notes and the filler are
    display-only, and ``start_confirmed`` **must** stay live because a joiner's
    starting point may be acknowledged after the month closed. Freezing that flag
    into the snapshot would strand it forever.
    """

    snapshot = list(
        db.execute(
            select(TimesheetSnapshotRow)
            .where(
                TimesheetSnapshotRow.period_id == period.id,
                TimesheetSnapshotRow.sheet == sheet,
            )
            .order_by(TimesheetSnapshotRow.row_no)
        ).scalars()
    )
    employees = _employees_by_id(db, [row.employee_id for row in snapshot])

    rows: list[GridRow] = []
    for frozen in snapshot:
        employee = employees.get(frozen.employee_id)
        employee_absences = absences.get(frozen.employee_id, [])
        rows.append(
            GridRow(
                employee_id=frozen.employee_id,
                row_no=frozen.row_no,
                name_en=frozen.name_en,
                nationality_en=frozen.nationality_en,
                designation_en=frozen.designation_en,
                designation_ar=frozen.designation_ar,
                rank_order=frozen.rank_order,
                codes=list(frozen.codes),
                stat_codes=list(frozen.stat_codes),
                stat_block=frozen.stat_block,
                stat_filler=(
                    fillers.get(frozen.employee_id, DEFAULT_STAT_FILLER)
                    if frozen.stat_block == 2
                    else None
                ),
                joined_day=_edge_day(
                    employee.doj if employee is not None else None, period.year, period.month
                ),
                left_day=_edge_day(
                    employee.end_date if employee is not None else None,
                    period.year,
                    period.month,
                ),
                start_confirmed=frozen.employee_id in acks,
                notes=_notes(employee_absences),
                designation_id=None,
            )
        )
    return rows


def build_month(db: Session, year: int, month: int, *, sheet: str = "main") -> MonthGrid:
    """One month of one workbook, live or sealed.

    ``warnings`` are recomputed live either way. They describe the live records,
    never affect a code and never gate a download, so the same reasoning rule 8
    applies to ``notes`` and ``stat_filler`` applies to them: display-only values
    stay live. ``blocking`` is the one thing the seal freezes, precisely because it
    *does* gate a download — see :func:`_sealed_issues`.

    Never writes: no ``TimesheetPeriod`` row is created for a month that has none,
    because this runs against the live database on every page load and on the
    golden-file test.
    """

    days_in_month, month_start, month_end = _month_bounds(year, month)
    designations = _designations_by_id(db)
    assignments = _roster_assignments_on(db, month_start)
    period = _period(db, year, month)
    post_count = DEFAULT_POST_COUNT if period is None else period.post_count

    absences = _absences_by_employee(db, month_start, month_end)
    fillers = _fillers_by_employee(db, year, month)
    acks = _start_acks(db, year, month)
    members = _members(
        db,
        month_start=month_start,
        month_end=month_end,
        assignments=assignments,
        designations=designations,
        sheet=sheet,
    )
    leaves_by_employee = _leaves_by_employee(db, month_start, month_end)

    if period is not None and period.closed_at is not None:
        rows = _sealed_rows(db, period, sheet=sheet, absences=absences, fillers=fillers, acks=acks)
        blocking = _sealed_issues(rows)
        closed_at: datetime | None = period.closed_at
        closed_by = _display_name(db, period.closed_by)
    else:
        rows = _live_rows(
            db,
            year,
            month,
            sheet=sheet,
            members=members,
            leaves_by_employee=leaves_by_employee,
            post_count=post_count,
            absences=absences,
            fillers=fillers,
            acks=acks,
        )
        blocking = _blocking_issues(members)
        closed_at, closed_by = None, None

    warnings = _warning_issues(
        db,
        members,
        leaves_by_employee=leaves_by_employee,
        assignments=assignments,
        designations=designations,
        month_start=month_start,
        sheet=sheet,
    )

    return MonthGrid(
        year=year,
        month=month,
        days_in_month=days_in_month,
        sheet=sheet,
        post_count=post_count,
        rows=rows,
        blocking=blocking,
        warnings=warnings,
        removed=_removed(
            db,
            year,
            month,
            designations=designations,
            sheet=sheet,
        ),
        closed_at=closed_at,
        closed_by=closed_by,
    )


# --------------------------------------------------------------------------- #
# the catalog
# --------------------------------------------------------------------------- #


def seed_designations(db: Session) -> None:
    """Insert missing built-in designations by stable key, without overwrites.

    Called at startup and from the test fixtures, because the suite builds schema
    with ``metadata.create_all`` and never runs the migration that first inserted
    these rows. ``rank_order`` and all printable fields belong to the operator
    once the catalog exists, so a re-seed only fills in a missing row. A restored
    row takes its seed rank when that rank is free and the next one after the last
    otherwise, because the rank is uniquely constrained.
    """

    rows = list(db.execute(select(TimesheetDesignation)).scalars())
    existing = {row.system_key: row for row in rows if row.system_key is not None}
    taken = {row.rank_order for row in rows}
    for system_key, rank, name_en, name_ar, sheet in DESIGNATION_SEED:
        if system_key in existing:
            continue
        rank_order = rank if rank not in taken else max(taken, default=0) + 1
        taken.add(rank_order)
        db.add(
            TimesheetDesignation(
                system_key=system_key,
                name_en=name_en,
                name_ar=name_ar,
                rank_order=rank_order,
                sheet=sheet,
            )
        )
    db.commit()


def list_designations(db: Session) -> list[TimesheetDesignation]:
    """The catalog in printed order."""

    return list(
        db.execute(select(TimesheetDesignation).order_by(TimesheetDesignation.rank_order)).scalars()
    )


def _catalog_names(name_en: str, name_ar: str) -> tuple[str, str]:
    names = (name_en.strip(), name_ar.strip())
    if not all(names):
        raise ValidationFailedError(
            "DESIGNATION_NAME_REQUIRED",
            "Designation names must not be blank.",
        )
    return names


def _ensure_catalog_names_unique(
    db: Session, name_en: str, name_ar: str, *, exclude_id: int | None = None
) -> None:
    wanted = {"name_en": name_en.casefold(), "name_ar": name_ar.casefold()}
    for row in db.execute(select(TimesheetDesignation)).scalars():
        if row.id == exclude_id:
            continue
        if (
            row.name_en.casefold() == wanted["name_en"]
            or row.name_ar.casefold() == wanted["name_ar"]
        ):
            raise ValidationFailedError(
                "DESIGNATION_NAME_DUPLICATE",
                "Designation names must be unique, ignoring case.",
            )


def create_designation(
    db: Session, name_en: str, name_ar: str, *, sheet: str
) -> TimesheetDesignation:
    name_en, name_ar = _catalog_names(name_en, name_ar)
    _ensure_catalog_names_unique(db, name_en, name_ar)
    max_rank = db.execute(select(func.max(TimesheetDesignation.rank_order))).scalar_one()
    row = TimesheetDesignation(
        name_en=name_en,
        name_ar=name_ar,
        rank_order=(max_rank or 0) + 1,
        sheet=sheet,
        system_key=None,
    )
    db.add(row)
    db.commit()
    return row


def rename_designation(
    db: Session, designation_id: int, name_en: str, name_ar: str
) -> TimesheetDesignation:
    row = db.get(TimesheetDesignation, designation_id)
    if row is None:
        raise NotFoundError(
            "DESIGNATION_NOT_FOUND",
            f"No designation {designation_id}.",
            designation_id=designation_id,
        )
    name_en, name_ar = _catalog_names(name_en, name_ar)
    _ensure_catalog_names_unique(db, name_en, name_ar, exclude_id=designation_id)
    row.name_en = name_en
    row.name_ar = name_ar
    db.commit()
    return row


def reorder_designations(db: Session, ids: list[int]) -> None:
    """Rewrite ``rank_order`` to the given order.

    Two passes with a flush between them: ``rank_order`` is uniquely constrained,
    so writing the final ranks directly collides with the ranks still held by the
    rows not yet moved. The temporary values are negative, which is a space no
    real rank occupies.
    """

    rows = {row.id: row for row in db.execute(select(TimesheetDesignation)).scalars()}
    if sorted(ids) != sorted(rows):
        raise ValidationFailedError(
            "DESIGNATION_ORDER_INCOMPLETE",
            "The order must list every designation exactly once.",
            expected=len(rows),
            given=len(ids),
        )
    for position, designation_id in enumerate(ids, start=1):
        rows[designation_id].rank_order = -position
    db.flush()
    for position, designation_id in enumerate(ids, start=1):
        rows[designation_id].rank_order = position
    db.commit()


# --------------------------------------------------------------------------- #
# editing a month
# --------------------------------------------------------------------------- #


def _require_open(db: Session, year: int, month: int) -> None:
    period = _period(db, year, month)
    if period is not None and period.closed_at is not None:
        raise ConflictError(
            "TIMESHEET_CLOSED",
            "Month is closed. Reopen it before editing.",
            year=year,
            month=month,
        )


def _require_employee(db: Session, employee_id: str) -> Employee:
    """The employee every writer in this module edits on behalf of.

    Shared by all three so they answer the same way: ``timesheet_stat_fillers``
    has a foreign key and would otherwise surface an ``IntegrityError`` as a 500,
    and ``timesheet_start_acks`` deliberately has none, so an unchecked write
    there is a silent orphan row no grid will ever read.
    """

    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND", f"No employee {employee_id!r}", employee_id=employee_id
        )
    return employee


def set_roster_assignments(
    db: Session,
    year: int,
    month: int,
    assignments: Sequence[TimesheetRosterAssignmentWrite],
    *,
    actor_id: int | None,
) -> None:
    """Validate and upsert one effective roster month as a single transaction."""

    if not assignments:
        raise ValidationFailedError(
            "ROSTER_EMPTY",
            "At least one roster assignment is required.",
        )
    _require_open(db, year, month)
    employee_ids = [assignment.employee_id for assignment in assignments]
    if len(employee_ids) != len(set(employee_ids)):
        raise ValidationFailedError(
            "ROSTER_DUPLICATE_EMPLOYEE",
            "Each employee may appear only once in a roster batch.",
        )

    employees = {
        row.id
        for row in db.execute(select(Employee).where(Employee.id.in_(employee_ids))).scalars()
    }
    missing_employees = sorted(set(employee_ids) - employees)
    if missing_employees:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"No employee {missing_employees[0]!r}.",
            employee_ids=missing_employees,
        )

    designation_ids = {
        assignment.designation_id
        for assignment in assignments
        if assignment.designation_id is not None
    }
    designations = {
        row.id
        for row in db.execute(
            select(TimesheetDesignation).where(TimesheetDesignation.id.in_(designation_ids))
        ).scalars()
    }
    missing_designations = sorted(designation_ids - designations)
    if missing_designations:
        raise NotFoundError(
            "DESIGNATION_NOT_FOUND",
            f"No designation {missing_designations[0]}.",
            designation_ids=missing_designations,
        )
    inactive = [
        row.id
        for row in db.execute(
            select(TimesheetDesignation).where(
                TimesheetDesignation.id.in_(designation_ids),
                TimesheetDesignation.active.is_(False),
            )
        ).scalars()
    ]
    if inactive:
        raise ValidationFailedError(
            "DESIGNATION_INACTIVE",
            "Roster assignments require active designations.",
            designation_ids=sorted(inactive),
        )

    effective_from = date(year, month, 1)
    existing = {
        row.employee_id: row
        for row in db.execute(
            select(TimesheetRosterAssignment).where(
                TimesheetRosterAssignment.employee_id.in_(employee_ids),
                TimesheetRosterAssignment.effective_from == effective_from,
            )
        ).scalars()
    }
    for assignment in assignments:
        row = existing.get(assignment.employee_id)
        if row is None:
            db.add(
                TimesheetRosterAssignment(
                    employee_id=assignment.employee_id,
                    designation_id=assignment.designation_id,
                    effective_from=effective_from,
                    assigned_by=actor_id,
                )
            )
        else:
            row.designation_id = assignment.designation_id
            row.assigned_by = actor_id
            row.assigned_at = _utcnow()
    db.commit()


def _derived_cell_code(
    db: Session,
    year: int,
    month: int,
    employee: Employee,
    day: int,
) -> str | None:
    """Resolve one employee-month without the override layer."""

    _, month_start, month_end = _month_bounds(year, month)
    leaves = db.execute(
        select(Leave).where(
            Leave.employee_id == employee.id,
            Leave.deleted_at.is_(None),
            Leave.start_date <= month_end,
            Leave.end_date >= month_start,
        )
    ).scalars()
    absences = db.execute(
        select(Absence).where(
            Absence.employee_id == employee.id,
            Absence.date >= month_start,
            Absence.date <= month_end,
        )
    ).scalars()
    codes = month_codes(
        year,
        month,
        doj=employee.doj,
        end_date=employee.end_date,
        leaves=_leave_spans(_live_leaves(leaves)),
        absences=[row.date for row in absences],
    )
    return codes[day - 1]


def _finish(db: Session, *, commit: bool) -> None:
    """End a writer: own the transaction, or hand it back to the caller.

    ``commit=False`` still flushes, so the write is visible to the rest of the
    caller's transaction — a grid built immediately afterwards, or the document
    pipeline's own later statements — while remaining a single unit of work that
    one ``rollback`` undoes entirely.
    """

    if commit:
        db.commit()
    else:
        db.flush()


def set_cell(
    db: Session,
    year: int,
    month: int,
    employee_id: str,
    day: int,
    code: str | None,
    *,
    note: str | None = None,
    user_id: int | None = None,
) -> None:
    """Force one cell: ``AB`` records an absence, anything else an override.

    Absence is the only code with no other source in this database, so it becomes
    a real :class:`Absence` row on the employee's record rather than a sheet-local
    scribble. Everything else — including the manual red block ``X`` — is a
    :class:`TimesheetOverride`, and ``None`` clears whichever of the two exists.
    Setting one form clears the other, so the cell always shows what was last set.

    A day outside the employee's roster window is refused. The engine applies
    overrides last and unconditionally, so an override there would paint over an
    ``NG`` or ``-`` cell that the roster edge owns; and an absence there could
    never render at all, which would leave a permanent, invisible row on an
    employee's record. Painting a whole row may therefore be refused cell by cell
    at the edges, which is the intended answer.
    """

    days_in_month, _, _ = _month_bounds(year, month)
    if not 1 <= day <= days_in_month:
        raise ValidationFailedError(
            "TIMESHEET_BAD_DAY",
            f"{year}-{month:02d} has no day {day}.",
            year=year,
            month=month,
            day=day,
        )
    if code is not None and code not in CELL_CODES:
        # ``day_code``, not ``code``: ``AppError``'s first positional parameter is
        # itself named ``code``, so that detail key collides with the error code.
        raise ValidationFailedError(
            "TIMESHEET_BAD_CODE", f"{code!r} is not a time-sheet code.", day_code=code
        )
    employee = _require_employee(db, employee_id)
    _require_open(db, year, month)

    cell_date = date(year, month, day)
    if code is not None and not _covers_day(employee, cell_date):
        raise ValidationFailedError(
            "TIMESHEET_OFF_ROSTER",
            f"{employee_id} was not on the roster on {cell_date:%Y-%m-%d}.",
            employee_id=employee_id,
            day=day,
        )

    absence = db.execute(
        select(Absence).where(Absence.employee_id == employee_id, Absence.date == cell_date)
    ).scalar_one_or_none()
    override = db.execute(
        select(TimesheetOverride).where(
            TimesheetOverride.year == year,
            TimesheetOverride.month == month,
            TimesheetOverride.day == day,
            TimesheetOverride.employee_id == employee_id,
        )
    ).scalar_one_or_none()

    # Replace rather than update, so ``created_by`` names whoever set the cell
    # that is actually there. The flush forces the DELETEs ahead of the INSERT,
    # which the unique constraint on the cell requires.
    for stale in (absence, override):
        if stale is not None:
            db.delete(stale)
    db.flush()

    if code == CODE_ABSENT:
        db.add(Absence(employee_id=employee_id, date=cell_date, note=note, created_by=user_id))
    elif code is not None:
        derived_code = _derived_cell_code(db, year, month, employee, day)
        # An override equal to the derived value is a silent pin that stops the
        # cell tracking records; skip it because this is what Undo last change
        # depends on when it restores a displayed derived code.
        if derived_code != code:
            db.add(
                TimesheetOverride(
                    year=year,
                    month=month,
                    day=day,
                    employee_id=employee_id,
                    code=code,
                    note=note,
                    created_by=user_id,
                )
            )
    db.commit()


def set_post_count(
    db: Session, year: int, month: int, post_count: int, *, commit: bool = True
) -> None:
    """Set the contracted post count that splits the statistics into two blocks.

    Refused on a closed month: every row's ``stat_block`` is frozen in the
    snapshot at the split computed when the seal went on, so moving the count
    afterwards would hand the page a ``post_count`` that disagrees with its own
    rows — and rule 8 promises a later re-download reproduces what the client
    already holds.

    ``commit=False`` leaves the write in the caller's transaction — flushed, so a
    grid built straight afterwards sees it — which is how the ``PATCH`` route
    applies a post count and a set of fillers as one unit instead of committing
    each and leaving a half-applied month behind on the first failure.
    """

    _require_open(db, year, month)
    period = _period(db, year, month)
    if period is None:
        db.add(TimesheetPeriod(year=year, month=month, post_count=post_count))
    else:
        period.post_count = post_count
    _finish(db, commit=commit)


def set_filler(
    db: Session, year: int, month: int, employee_id: str, code: str, *, commit: bool = True
) -> None:
    """Choose the code block 2 prints for one employee, from this month forward.

    Validated against the same set :func:`set_cell` accepts: the filler is printed
    into a day cell of the client's sheet, so it has to be a code the legend
    carries.

    Deliberately **not** guarded by :func:`_require_open`, unlike the other two
    writers. Rule 8 reads ``stat_filler`` live after the seal because it is
    display-only there — ``stat_codes`` are already frozen — so the operator may
    still record the choice against a closed month.

    ``commit=False``: see :func:`set_post_count`.
    """

    if code not in CELL_CODES:
        raise ValidationFailedError(
            "TIMESHEET_BAD_CODE", f"{code!r} is not a time-sheet code.", day_code=code
        )
    _require_employee(db, employee_id)
    row = db.execute(
        select(TimesheetStatFiller).where(
            TimesheetStatFiller.year == year,
            TimesheetStatFiller.month == month,
            TimesheetStatFiller.employee_id == employee_id,
        )
    ).scalar_one_or_none()
    if row is None:
        db.add(TimesheetStatFiller(year=year, month=month, employee_id=employee_id, code=code))
    else:
        row.code = code
    _finish(db, commit=commit)


def delete_absences_covered_by(
    db: Session, employee_id: str, start: date, end: date, *, commit: bool = True
) -> int:
    """Drop the absences a leave now covers, and say how many went.

    A sick certificate produced after the fact supersedes the absence it explains,
    so the row is removed rather than left to argue with the leave. Allowed on a
    closed month on purpose: the absence is the employee's record, while the sheet
    that went out is protected by its snapshot.

    ``commit=False`` is what document generation passes: the supersede belongs to
    the same unit of work as the leave row that caused it, so a later failure in
    the generation pipeline takes both back.
    """

    rows = list(
        db.execute(
            select(Absence).where(
                Absence.employee_id == employee_id,
                Absence.date >= start,
                Absence.date <= end,
            )
        ).scalars()
    )
    for row in rows:
        db.delete(row)
    _finish(db, commit=commit)
    return len(rows)


def acknowledge_start(
    db: Session, year: int, month: int, employee_id: str, *, user_id: int | None = None
) -> None:
    """Record that a mid-month joiner's starting point was seen and accepted.

    An acknowledgement, not a correction: it writes no override, changes no code,
    and is never required before a download. A wrong date of joining is fixed on
    the employee record instead. Idempotent, and allowed on a closed month —
    which is why the flag is read live rather than frozen into the snapshot.

    ``user_id`` is keyword-only with a default, so the four-argument call the
    Interfaces block mandates still works untouched; it exists so rule 15's
    ``acked_by`` column records *who* accepted the starting point, which is the
    only reason an acknowledgement is worth storing at all.
    """

    _require_employee(db, employee_id)
    existing = db.execute(
        select(TimesheetStartAck).where(
            TimesheetStartAck.year == year,
            TimesheetStartAck.month == month,
            TimesheetStartAck.employee_id == employee_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return
    db.add(TimesheetStartAck(year=year, month=month, employee_id=employee_id, acked_by=user_id))
    db.commit()


# --------------------------------------------------------------------------- #
# the seal
# --------------------------------------------------------------------------- #


def _clear_snapshot(db: Session, period: TimesheetPeriod) -> None:
    """A snapshot exists exactly while the month is closed."""

    for row in db.execute(
        select(TimesheetSnapshotRow).where(TimesheetSnapshotRow.period_id == period.id)
    ).scalars():
        db.delete(row)
    db.flush()


def close_month(db: Session, year: int, month: int, *, user_id: int | None = None) -> None:
    """Freeze both workbooks for the month.

    Both sheets, not just the requested one: the drivers workbook is downloaded
    separately and would render empty after a close that only snapshotted the
    main roster. Already closed is a no-op — the first download owns the seal and
    every later one has to reproduce it.
    """

    period = _period(db, year, month)
    if period is not None and period.closed_at is not None:
        return

    grids = {sheet: build_month(db, year, month, sheet=sheet) for sheet in SHEETS}

    if period is None:
        period = TimesheetPeriod(year=year, month=month, post_count=DEFAULT_POST_COUNT)
        db.add(period)
        db.flush()
    _clear_snapshot(db, period)

    for sheet, grid in grids.items():
        for row in grid.rows:
            db.add(
                TimesheetSnapshotRow(
                    period_id=period.id,
                    employee_id=row.employee_id,
                    row_no=row.row_no,
                    name_en=row.name_en,
                    nationality_en=row.nationality_en,
                    designation_en=row.designation_en,
                    designation_ar=row.designation_ar,
                    rank_order=row.rank_order,
                    sheet=sheet,
                    codes=list(row.codes),
                    stat_codes=list(row.stat_codes),
                    stat_block=row.stat_block,
                )
            )
    period.closed_at = _utcnow()
    period.closed_by = user_id
    db.commit()


def reopen_month(db: Session, year: int, month: int, *, user_id: int | None = None) -> None:
    """Break the seal and go back to live recomputation."""

    period = _period(db, year, month)
    if period is None or period.closed_at is None:
        return
    _clear_snapshot(db, period)
    period.closed_at = None
    period.closed_by = None
    period.reopened_at = _utcnow()
    period.reopened_by = user_id
    db.commit()
