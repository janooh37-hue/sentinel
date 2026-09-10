"""Monthly inmate conduct violation register — projection, overlay, seal.

The register is the monthly view of *inmate violation occurrences*: one inmate
line on one filed ``Inmate Conduct Violations`` Record. Three rules shape every
function here.

**A Violation month is the calendar month of the Record's ``report_date``.**
That field is the occurrence date, not the filing clock (``Book.created_at`` is
never consulted). A Record whose ``report_date`` is missing or unparseable
belongs to no month at all: it is listed as *not counted* rather than dropped or
dated today.

**An open month is a pure projection.** Nothing is persisted while a month is
open — a GET never creates an ``inmate_violation_periods`` row. The projection
reads the highest-version ``BookVersion`` of every non-deleted, non-voided
Record and unions it with the ``inmate_violation_manual_rows`` overlay.

**A closed month is read from its frozen entries and never re-derived.** Duty
events are purged by ``duty_event_retention_days`` and the source Record can be
deleted or revised, so re-deriving a sealed month is not reproducible. Reopen is
therefore the only correction path (see ``reopen_month``).
"""

from __future__ import annotations

import json
from calendar import monthrange
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core import inmate_statistics_xlsx as xlsx
from app.core.html_text import html_to_text
from app.core.nationalities import (
    NATIONALITY_CODE_UNSPECIFIED,
    is_citizen,
    resolve_nationality,
)
from app.db.models import (
    AuditLog,
    Book,
    BookVersion,
    Employee,
    InmateViolationManualRow,
    InmateViolationPeriod,
    InmateViolationStatRow,
    User,
)
from app.db.workforce_models import DutyAssignmentEvent

#: The service/template this register counts. Never the employee ``Violation``
#: table — that is staff misconduct, a different domain sharing one word.
TEMPLATE_ID: Final[str] = "Inmate Conduct Violations"

#: App-wide null guard, reused verbatim (``duty_service._UNSPECIFIED``).
UNSPECIFIED: Final[str] = "غير محدد"

POPULATION_CITIZENS: Final[str] = "citizens"
POPULATION_EXPATS: Final[str] = "expats"
POPULATION_PENDING: Final[str] = "pending"
#: Document/worksheet order. ``pending`` is a group, not an inmate population.
POPULATIONS: Final[tuple[str, ...]] = (
    POPULATION_CITIZENS,
    POPULATION_EXPATS,
    POPULATION_PENDING,
)

ORIGIN_DERIVED: Final[str] = "derived"
ORIGIN_MANUAL: Final[str] = "manual"

#: Gate names surfaced per entry; the close refusal enumerates them.
MISSING_NATIONALITY: Final[str] = "nationality"
MISSING_DETAILS: Final[str] = "details"
#: Marked when the reporter's duty unit could not be resolved at all.
MISSING_DUTY_UNIT: Final[str] = "duty_unit"

_INMATE_KEYS: Final[tuple[str, ...]] = ("name", "nationality", "wing", "uid", "holding_no")


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _text(value: object) -> str:
    """Payload cells are free text typed by an operator; treat every shape."""

    if value is None:
        return ""
    return str(value).strip()


# --------------------------------------------------------------------------- #
# the entry
# --------------------------------------------------------------------------- #


@dataclass
class RegisterEntry:
    """One monthly violation register entry, open (projected) or sealed.

    ``handle`` is the stable address of the entry, identical open and closed:
    ``{book_id}:{version_no}:{row_index}`` for a derived entry, ``manual:{id}``
    for a manual one. The display ordinal ``row_no`` is never the identity.
    """

    handle: str
    origin: str
    name: str
    violation_date: date
    uid: str = ""
    nationality_label: str = ""
    nationality_code: str | None = None
    duty_unit: str = UNSPECIFIED
    details_text: str = ""
    wing: str = ""
    holding_no: str = ""
    reporter_id: str | None = None
    reporter_name: str | None = None
    source_book_id: int | None = None
    source_version_no: int | None = None
    source_row_index: int | None = None
    source_ref_number: str | None = None
    manual_row_id: int | None = None
    manual_reason: str | None = None
    manual_created_by: int | None = None
    manual_created_by_name: str | None = None
    manual_created_at: datetime | None = None
    #: Values permanently missing on a frozen entry (forced close / bridge miss).
    incomplete_marks: list[str] = field(default_factory=list)
    #: Values still required before the month may close. Empty once sealed.
    missing: list[str] = field(default_factory=list)
    #: Set on a manual entry shadowing a derived one — warn, never merge.
    duplicate_of: str | None = None
    #: The imported Record this entry is completed through, when it is one.
    completion_book_id: int | None = None
    population: str = POPULATION_PENDING
    row_no: int = 0
    _sort_created_at: str = ""

    @property
    def is_manual(self) -> bool:
        return self.origin == ORIGIN_MANUAL


@dataclass(frozen=True)
class UncountedRecord:
    """A filed Record that belongs to no Violation month."""

    book_id: int
    ref_number: str
    reason: str


@dataclass(frozen=True)
class ArrivedAfterClose:
    """An occurrence edited into a month that was already closed."""

    handle: str
    name: str
    violation_date: date
    ref_number: str | None
    source_book_id: int | None


@dataclass(frozen=True)
class MonthRegister:
    year: int
    month: int
    closed_at: datetime | None
    closed_by: int | None
    closed_by_name: str | None
    reopened_at: datetime | None
    reopened_by: int | None
    reopened_by_name: str | None
    force_reason: str | None
    export_ready: bool
    entries: tuple[RegisterEntry, ...]
    uncounted: tuple[UncountedRecord, ...]
    arrived_after_close: tuple[ArrivedAfterClose, ...]

    @property
    def closed(self) -> bool:
        return self.closed_at is not None

    @property
    def counts(self) -> dict[str, int]:
        """Three per-table counts plus the three-term month total.

        Never stored: a stored total is a second source of truth for a ``len()``.
        """

        counts = {key: 0 for key in POPULATIONS}
        for entry in self.entries:
            counts[entry.population] += 1
        counts["total"] = sum(counts[key] for key in POPULATIONS)
        return counts

    @property
    def blocking(self) -> tuple[RegisterEntry, ...]:
        """Entries a close is refused over, unless it is forced."""

        return tuple(entry for entry in self.entries if entry.missing)

    @property
    def duplicates(self) -> tuple[RegisterEntry, ...]:
        return tuple(entry for entry in self.entries if entry.duplicate_of)


# --------------------------------------------------------------------------- #
# month arithmetic
# --------------------------------------------------------------------------- #


def month_bounds(year: int, month: int) -> tuple[date, date]:
    last = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def first_closable_date(year: int, month: int) -> date:
    """A month may be closed from the first day after it ends."""

    end = month_bounds(year, month)[1]
    return date.fromordinal(end.toordinal() + 1)


def month_has_ended(year: int, month: int, *, today: date | None = None) -> bool:
    return (today or _utcnow().date()) >= first_closable_date(year, month)


def _parse_date(raw: object) -> date | None:
    value = _text(raw)
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# السربة — the reporter's duty unit as of the violation date
# --------------------------------------------------------------------------- #


def resolve_duty_unit(db: Session, reporter_id: str | None, on_date: date) -> str:
    """The reporting employee's duty unit on ``on_date``, printed verbatim.

    Newest ``DutyAssignmentEvent`` effective at or before that date wins, with
    the live ``Employee.duty_unit`` as the fallback — the pattern the attendance
    domain already uses (``attendance_evaluation_service``). ``الدوام الرسمي``
    and any future free-form unit print as they are; ``غير محدد`` appears only
    when the resolution yields nothing at all.
    """

    reporter = _text(reporter_id)
    if not reporter:
        return UNSPECIFIED
    event = db.scalar(
        select(DutyAssignmentEvent)
        .where(
            DutyAssignmentEvent.employee_id == reporter,
            DutyAssignmentEvent.effective_at <= datetime.combine(on_date, time.max),
        )
        .order_by(DutyAssignmentEvent.effective_at.desc(), DutyAssignmentEvent.id.desc())
    )
    if event is not None and _text(event.to_unit):
        return _text(event.to_unit)
    employee = db.get(Employee, reporter)
    if employee is not None and _text(employee.duty_unit):
        return _text(employee.duty_unit)
    return UNSPECIFIED


def _reporter_name(db: Session, reporter_id: str | None) -> str | None:
    reporter = _text(reporter_id)
    if not reporter:
        return None
    employee = db.get(Employee, reporter)
    if employee is None:
        return None
    return employee.name_ar or employee.name_en or None


# --------------------------------------------------------------------------- #
# the projection
# --------------------------------------------------------------------------- #


def _current_versions(db: Session) -> list[tuple[Book, BookVersion]]:
    """Every live Record of this service, paired with its current version.

    Latest version only — a revision is a correction, not a second violation.
    Deleted and voided Records are excluded (a voided paper is a discarded
    draft). ``approval_state`` is deliberately *not* a gate: the open month must
    agree with what the operator sees in Records.
    """

    latest = (
        select(
            BookVersion.book_id.label("book_id"),
            func.max(BookVersion.version_no).label("version_no"),
        )
        .group_by(BookVersion.book_id)
        .subquery()
    )
    stmt = (
        select(Book, BookVersion)
        .join(latest, latest.c.book_id == Book.id)
        .join(
            BookVersion,
            (BookVersion.book_id == latest.c.book_id)
            & (BookVersion.version_no == latest.c.version_no),
        )
        .where(
            Book.deleted_at.is_(None),
            Book.voided_at.is_(None),
            BookVersion.template_id == TEMPLATE_ID,
        )
        .order_by(Book.id)
    )
    return [(book, version) for book, version in db.execute(stmt).all()]


def _source_rows(fields: dict[str, Any]) -> tuple[str, list[dict[str, Any]], str, str | None]:
    """Normalise a version payload into ``(kind, inmate rows, details, reporter)``.

    Three payload shapes reach the register:

    * structured entry — ``inmates`` rows plus a shared ``violation_details``;
    * a completed approved-copy import — the namespaced ``completion`` block
      written by :func:`complete_import`, which is an ordinary occurrence here;
    * an uncompleted import — ``inmate_names`` only, which projects one pending
      completion entry per name so the occurrence is never hidden.
    """

    completion = fields.get("completion")
    if isinstance(completion, dict):
        rows = [row for row in completion.get("inmates", []) if isinstance(row, dict)]
        return (
            "completion",
            rows,
            html_to_text(_text(completion.get("violation_details"))),
            _text(completion.get("reporter_id")) or None,
        )
    inmates = fields.get("inmates")
    if isinstance(inmates, list):
        rows = [row for row in inmates if isinstance(row, dict)]
        if rows:
            return (
                "structured",
                rows,
                html_to_text(_text(fields.get("violation_details"))),
                _text(fields.get("reporter_id")) or None,
            )
    names = fields.get("inmate_names")
    if isinstance(names, list):
        return "import", [{"name": _text(name)} for name in names], "", None
    return "structured", [], "", None


def _project_record(
    db: Session,
    book: Book,
    version: BookVersion,
    violation_date: date,
) -> list[RegisterEntry]:
    fields = version.fields if isinstance(version.fields, dict) else {}
    kind, rows, details, reporter_id = _source_rows(fields)
    duty_unit = resolve_duty_unit(db, reporter_id, violation_date)
    reporter_name = _reporter_name(db, reporter_id)
    entries: list[RegisterEntry] = []
    for index, row in enumerate(rows):
        nationality = resolve_nationality(_text(row.get("nationality")))
        entry = RegisterEntry(
            handle=f"{book.id}:{version.version_no}:{index}",
            origin=ORIGIN_DERIVED,
            name=_text(row.get("name")),
            violation_date=violation_date,
            uid=_text(row.get("uid")),
            nationality_label=nationality.label_ar if nationality else "",
            nationality_code=nationality.code if nationality else None,
            duty_unit=duty_unit,
            details_text=details,
            wing=_text(row.get("wing")),
            holding_no=_text(row.get("holding_no")),
            reporter_id=reporter_id,
            reporter_name=reporter_name,
            source_book_id=book.id,
            source_version_no=version.version_no,
            source_row_index=index,
            source_ref_number=book.ref_number,
            completion_book_id=book.id if kind in {"import", "completion"} else None,
            _sort_created_at=book.created_at.isoformat() if book.created_at else "",
        )
        entries.append(entry)
    return entries


def _manual_entry(db: Session, row: InmateViolationManualRow) -> RegisterEntry:
    nationality = resolve_nationality(row.nationality_label)
    return RegisterEntry(
        handle=f"manual:{row.id}",
        origin=ORIGIN_MANUAL,
        name=_text(row.name),
        violation_date=row.violation_date,
        uid=_text(row.uid),
        nationality_label=nationality.label_ar if nationality else "",
        nationality_code=nationality.code if nationality else None,
        duty_unit=resolve_duty_unit(db, row.reporter_id, row.violation_date),
        details_text=_text(row.details_text),
        wing=_text(row.wing),
        holding_no=_text(row.holding_no),
        reporter_id=row.reporter_id,
        reporter_name=_reporter_name(db, row.reporter_id),
        manual_row_id=row.id,
        manual_reason=row.reason,
        manual_created_by=row.created_by,
        manual_created_by_name=_user_name(db, row.created_by),
        manual_created_at=row.created_at,
        _sort_created_at=row.created_at.isoformat() if row.created_at else "",
    )


def _sort_key(entry: RegisterEntry) -> tuple[str, int, str, int, str, str]:
    """``violation_date``, then papered entries, then ref number and position.

    A manual entry sorts after every derived entry sharing its date, then by
    creation time — the hand-written lines read beneath the papered ones.
    """

    return (
        entry.violation_date.isoformat(),
        1 if entry.is_manual else 0,
        entry.source_ref_number or "",
        entry.source_row_index if entry.source_row_index is not None else 0,
        entry._sort_created_at,
        entry.handle,
    )


def _population_of(code: str | None) -> str:
    if code is None:
        return POPULATION_PENDING
    return POPULATION_CITIZENS if is_citizen(code) else POPULATION_EXPATS


def _normalised_name(name: str) -> str:
    return " ".join(name.split())


def _finalise(entries: list[RegisterEntry], *, sealed: bool) -> tuple[RegisterEntry, ...]:
    """Group, order and number the entries, and flag what is still missing."""

    ordered = sorted(entries, key=_sort_key)
    for entry in ordered:
        entry.population = _population_of(entry.nationality_code)
        if sealed:
            continue
        missing: list[str] = []
        if entry.nationality_code is None:
            missing.append(MISSING_NATIONALITY)
        if entry.is_manual and not entry.details_text:
            missing.append(MISSING_DETAILS)
        entry.missing = missing
        # An incomplete mark says a value is permanently missing. While the
        # month is open the only such value is a nationality the history bridge
        # matched to nothing; a `غير محدد` duty unit is the ordinary null guard
        # and is explicitly neither blocked nor blocking, so it is not marked
        # here. A forced close adds its own marks over the entries it seals.
        entry.incomplete_marks = (
            [MISSING_NATIONALITY] if entry.nationality_code == NATIONALITY_CODE_UNSPECIFIED else []
        )
    derived_keys = {
        (entry.violation_date, _normalised_name(entry.name)): entry.handle
        for entry in ordered
        if not entry.is_manual
    }
    for entry in ordered:
        if entry.is_manual:
            entry.duplicate_of = derived_keys.get(
                (entry.violation_date, _normalised_name(entry.name))
            )
    counters = dict.fromkeys(POPULATIONS, 0)
    for entry in ordered:
        counters[entry.population] += 1
        entry.row_no = counters[entry.population]
    return tuple(ordered)


def project_month(
    db: Session, year: int, month: int
) -> tuple[
    tuple[RegisterEntry, ...],
    tuple[UncountedRecord, ...],
]:
    """Live projection of one month: Record occurrences plus manual entries."""

    entries: list[RegisterEntry] = []
    uncounted: list[UncountedRecord] = []
    for book, version in _current_versions(db):
        fields = version.fields if isinstance(version.fields, dict) else {}
        violation_date = _parse_date(fields.get("report_date"))
        if violation_date is None:
            uncounted.append(
                UncountedRecord(
                    book_id=book.id,
                    ref_number=book.ref_number,
                    reason="no_violation_date",
                )
            )
            continue
        if (violation_date.year, violation_date.month) != (year, month):
            continue
        entries.extend(_project_record(db, book, version, violation_date))
    for row in db.scalars(
        select(InmateViolationManualRow)
        .where(
            InmateViolationManualRow.year == year,
            InmateViolationManualRow.month == month,
        )
        .order_by(InmateViolationManualRow.id)
    ):
        entries.append(_manual_entry(db, row))
    return _finalise(entries, sealed=False), tuple(uncounted)


# --------------------------------------------------------------------------- #
# reading a month
# --------------------------------------------------------------------------- #


def _period(db: Session, year: int, month: int) -> InmateViolationPeriod | None:
    return db.scalar(
        select(InmateViolationPeriod).where(
            InmateViolationPeriod.year == year,
            InmateViolationPeriod.month == month,
        )
    )


def _user_name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    user = db.get(User, user_id)
    if user is None:
        return None
    return user.display_name or user.email


def _sealed_entry(row: InmateViolationStatRow) -> RegisterEntry:
    marks = row.incomplete_marks if isinstance(row.incomplete_marks, list) else []
    return RegisterEntry(
        handle=row.row_handle,
        origin=row.origin,
        name=row.name,
        violation_date=row.violation_date,
        uid=_text(row.uid),
        nationality_label=_text(row.nationality_label),
        nationality_code=row.nationality_code,
        duty_unit=_text(row.duty_unit) or UNSPECIFIED,
        details_text=_text(row.details_text),
        wing=_text(row.wing),
        holding_no=_text(row.holding_no),
        reporter_id=row.reporter_id,
        reporter_name=row.reporter_name,
        source_book_id=row.source_book_id,
        source_version_no=row.source_version_no,
        source_row_index=row.source_row_index,
        source_ref_number=row.source_ref_number,
        manual_reason=row.manual_reason,
        manual_created_by=row.manual_created_by,
        manual_created_by_name=row.manual_created_by_name,
        manual_created_at=row.manual_created_at,
        incomplete_marks=[str(mark) for mark in marks],
        population=row.population,
        row_no=row.row_no,
    )


def build_month(db: Session, year: int, month: int) -> MonthRegister:
    """One month, live or sealed. Never writes — the seal is an explicit act."""

    period = _period(db, year, month)
    if period is None or period.closed_at is None:
        entries, uncounted = project_month(db, year, month)
        return MonthRegister(
            year=year,
            month=month,
            closed_at=None,
            closed_by=None,
            closed_by_name=None,
            reopened_at=period.reopened_at if period else None,
            reopened_by=period.reopened_by if period else None,
            reopened_by_name=_user_name(db, period.reopened_by) if period else None,
            force_reason=None,
            export_ready=False,
            entries=entries,
            uncounted=uncounted,
            arrived_after_close=(),
        )

    sealed = [
        _sealed_entry(row)
        for row in db.scalars(
            select(InmateViolationStatRow)
            .where(InmateViolationStatRow.period_id == period.id)
            .order_by(InmateViolationStatRow.population, InmateViolationStatRow.row_no)
        )
    ]
    live, uncounted = project_month(db, year, month)
    frozen_handles = {entry.handle for entry in sealed}
    arrived = tuple(
        ArrivedAfterClose(
            handle=entry.handle,
            name=entry.name,
            violation_date=entry.violation_date,
            ref_number=entry.source_ref_number,
            source_book_id=entry.source_book_id,
        )
        for entry in live
        if entry.handle not in frozen_handles
    )
    return MonthRegister(
        year=year,
        month=month,
        closed_at=period.closed_at,
        closed_by=period.closed_by,
        closed_by_name=_user_name(db, period.closed_by),
        reopened_at=period.reopened_at,
        reopened_by=period.reopened_by,
        reopened_by_name=_user_name(db, period.reopened_by),
        force_reason=period.force_reason,
        export_ready=bool(period.export_path),
        entries=tuple(sealed),
        uncounted=uncounted,
        arrived_after_close=arrived,
    )


# --------------------------------------------------------------------------- #
# awaiting close
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class AwaitingMonth:
    year: int
    month: int
    row_count: int
    pending_count: int

    @property
    def closable(self) -> bool:
        return self.pending_count == 0


def awaiting_close(db: Session, *, today: date | None = None) -> tuple[AwaitingMonth, ...]:
    """Ended months that project at least one entry and carry no ``closed_at``.

    A standing computed state, not a fired event: it appears while a month
    qualifies and disappears the moment that month is closed. No floor — the
    historical backlog is genuinely closable.
    """

    candidates: set[tuple[int, int]] = set()
    for _book, version in _current_versions(db):
        fields = version.fields if isinstance(version.fields, dict) else {}
        violation_date = _parse_date(fields.get("report_date"))
        if violation_date is not None:
            candidates.add((violation_date.year, violation_date.month))
    for year, month in db.execute(
        select(InmateViolationManualRow.year, InmateViolationManualRow.month).distinct()
    ).all():
        candidates.add((year, month))

    closed = {
        (period.year, period.month)
        for period in db.scalars(
            select(InmateViolationPeriod).where(InmateViolationPeriod.closed_at.is_not(None))
        )
    }
    months: list[AwaitingMonth] = []
    for year, month in sorted(candidates):
        if (year, month) in closed or not month_has_ended(year, month, today=today):
            continue
        entries, _uncounted = project_month(db, year, month)
        if not entries:
            continue
        months.append(
            AwaitingMonth(
                year=year,
                month=month,
                row_count=len(entries),
                pending_count=sum(1 for entry in entries if entry.missing),
            )
        )
    return tuple(months)


# --------------------------------------------------------------------------- #
# audit
# --------------------------------------------------------------------------- #


def _audit(
    db: Session,
    *,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: str,
    payload: dict[str, Any],
) -> None:
    db.add(
        AuditLog(
            actor=actor.email if actor is not None else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            payload=json.dumps(payload, ensure_ascii=False, default=str),
        )
    )


# --------------------------------------------------------------------------- #
# manual entries
# --------------------------------------------------------------------------- #

_MANUAL_CELLS: Final[tuple[str, ...]] = (
    "name",
    "violation_date",
    "uid",
    "nationality_label",
    "wing",
    "holding_no",
    "reporter_id",
    "details_text",
    "reason",
)


def _assert_open(db: Session, year: int, month: int) -> None:
    """A closed month admits no write of any kind. Reopen is the only path."""

    period = _period(db, year, month)
    if period is not None and period.closed_at is not None:
        raise ConflictError(
            "INMATE_REGISTER_MONTH_CLOSED",
            "This Violation month is closed. Reopen it to make a correction.",
            year=year,
            month=month,
        )


def _manual_payload(row: InmateViolationManualRow) -> dict[str, Any]:
    return {cell: getattr(row, cell) for cell in _MANUAL_CELLS}


def create_manual_row(
    db: Session,
    year: int,
    month: int,
    *,
    actor: User,
    name: str,
    violation_date: date,
    reason: str,
    uid: str | None = None,
    nationality_label: str | None = None,
    wing: str | None = None,
    holding_no: str | None = None,
    reporter_id: str | None = None,
    details_text: str | None = None,
) -> InmateViolationManualRow:
    """Capture an occurrence no filed Record carries. ``reason`` is required."""

    _assert_open(db, year, month)
    if (violation_date.year, violation_date.month) != (year, month):
        raise ValidationFailedError(
            "INMATE_REGISTER_DATE_OUTSIDE_MONTH",
            "The violation date must fall inside the month being edited.",
            year=year,
            month=month,
        )
    row = InmateViolationManualRow(
        year=year,
        month=month,
        name=name.strip(),
        violation_date=violation_date,
        uid=_text(uid) or None,
        nationality_label=_text(nationality_label) or None,
        wing=_text(wing) or None,
        holding_no=_text(holding_no) or None,
        reporter_id=_text(reporter_id) or None,
        details_text=_text(details_text) or None,
        reason=reason.strip(),
        created_by=actor.id,
    )
    db.add(row)
    db.flush()
    _audit(
        db,
        actor=actor,
        action="inmate_violation_manual_row_created",
        entity_type="inmate_violation_row",
        entity_id=f"manual:{row.id}",
        payload={"year": year, "month": month, **_manual_payload(row)},
    )
    db.commit()
    db.refresh(row)
    return row


def update_manual_row(
    db: Session,
    manual_row_id: int,
    *,
    actor: User,
    changes: dict[str, Any],
) -> InmateViolationManualRow:
    row = db.get(InmateViolationManualRow, manual_row_id)
    if row is None:
        raise NotFoundError("INMATE_REGISTER_ROW_NOT_FOUND", "Manual entry not found.")
    _assert_open(db, row.year, row.month)
    before = _manual_payload(row)
    for cell, value in changes.items():
        if cell not in _MANUAL_CELLS:
            continue
        if cell in {"name", "reason"}:
            setattr(row, cell, str(value).strip())
        elif cell == "violation_date":
            if not isinstance(value, date):
                raise ValidationFailedError(
                    "INMATE_REGISTER_INVALID_DATE", "The violation date is not a date."
                )
            if (value.year, value.month) != (row.year, row.month):
                raise ValidationFailedError(
                    "INMATE_REGISTER_DATE_OUTSIDE_MONTH",
                    "The violation date must fall inside the month being edited.",
                    year=row.year,
                    month=row.month,
                )
            row.violation_date = value
        else:
            setattr(row, cell, _text(value) or None)
    row.updated_by = actor.id
    row.updated_at = _utcnow()
    db.flush()
    after = _manual_payload(row)
    changed = {
        cell: {"from": before[cell], "to": after[cell]}
        for cell in _MANUAL_CELLS
        if before[cell] != after[cell]
    }
    _audit(
        db,
        actor=actor,
        action="inmate_violation_manual_row_updated",
        entity_type="inmate_violation_row",
        entity_id=f"manual:{row.id}",
        payload={"year": row.year, "month": row.month, "reason": row.reason, "changed": changed},
    )
    db.commit()
    db.refresh(row)
    return row


def delete_manual_row(db: Session, manual_row_id: int, *, actor: User) -> None:
    """The one operation that removes a line leaving no trace on any survivor."""

    row = db.get(InmateViolationManualRow, manual_row_id)
    if row is None:
        raise NotFoundError("INMATE_REGISTER_ROW_NOT_FOUND", "Manual entry not found.")
    _assert_open(db, row.year, row.month)
    payload = {"year": row.year, "month": row.month, **_manual_payload(row)}
    _audit(
        db,
        actor=actor,
        action="inmate_violation_manual_row_deleted",
        entity_type="inmate_violation_row",
        entity_id=f"manual:{row.id}",
        payload=payload,
    )
    db.delete(row)
    db.commit()


# --------------------------------------------------------------------------- #
# completing an imported approved copy
# --------------------------------------------------------------------------- #


def complete_import(
    db: Session,
    book_id: int,
    *,
    actor: User,
    report_time: str,
    reporter_id: str,
    violation_details: str,
    inmates: list[dict[str, Any]],
) -> Book:
    """Merge a ``completion`` block into an imported Record's stored payload.

    The imported keys (``report_date``, ``inmate_names``, ``subject``,
    ``imported_approved``) are never touched and no document is rendered: the
    verbatim scan stays the Record's only artifact. A completed import is an
    ordinary structured occurrence to the projection.
    """

    book = db.get(Book, book_id)
    if book is None or book.deleted_at is not None:
        raise NotFoundError("BOOK_NOT_FOUND", "Record not found.")
    version = max(book.versions, key=lambda item: item.version_no, default=None)
    if version is None or version.template_id != TEMPLATE_ID:
        raise ValidationFailedError(
            "INMATE_REGISTER_NOT_A_VIOLATION_RECORD",
            "This Record is not an Inmate Conduct Violations Record.",
        )
    fields = dict(version.fields) if isinstance(version.fields, dict) else {}
    if not fields.get("imported_approved"):
        raise ValidationFailedError(
            "INMATE_REGISTER_NOT_AN_IMPORT",
            "Only an uploaded approved copy is completed here; revise the Record instead.",
        )
    violation_date = _parse_date(fields.get("report_date"))
    if violation_date is None:
        raise ValidationFailedError(
            "INMATE_REGISTER_RECORD_NOT_DATED",
            "This Record has no usable violation date; fix the Record first.",
        )
    _assert_open(db, violation_date.year, violation_date.month)
    if not _text(report_time):
        raise ValidationFailedError("INMATE_REGISTER_TIME_REQUIRED", "Report time is required.")
    if not _text(reporter_id) or db.get(Employee, _text(reporter_id)) is None:
        raise ValidationFailedError(
            "INMATE_REGISTER_REPORTER_REQUIRED", "A reporting employee is required."
        )
    if not html_to_text(_text(violation_details)):
        raise ValidationFailedError(
            "INMATE_REGISTER_DETAILS_REQUIRED", "The violation narrative is required."
        )
    rows = [
        {key: _text(row.get(key)) for key in _INMATE_KEYS}
        for row in inmates
        if _text(row.get("name"))
    ]
    if not rows:
        raise ValidationFailedError(
            "INMATE_REGISTER_NO_INMATES", "At least one inmate line is required."
        )
    completion = {
        "report_time": _text(report_time),
        "reporter_id": _text(reporter_id),
        "violation_details": _text(violation_details),
        "inmates": rows,
    }
    fields["completion"] = completion
    version.fields = fields
    db.flush()
    _audit(
        db,
        actor=actor,
        action="inmate_violation_import_completed",
        entity_type="book",
        entity_id=str(book.id),
        payload={
            "book_id": book.id,
            "ref_number": book.ref_number,
            "version_no": version.version_no,
            "completion": completion,
        },
    )
    db.commit()
    db.refresh(book)
    return book


# --------------------------------------------------------------------------- #
# the seal
# --------------------------------------------------------------------------- #


def _freeze(db: Session, period: InmateViolationPeriod, entries: tuple[RegisterEntry, ...]) -> None:
    for row in db.scalars(
        select(InmateViolationStatRow).where(InmateViolationStatRow.period_id == period.id)
    ):
        db.delete(row)
    db.flush()
    for entry in entries:
        db.add(
            InmateViolationStatRow(
                period_id=period.id,
                row_handle=entry.handle,
                origin=entry.origin,
                row_no=entry.row_no,
                population=entry.population,
                name=entry.name,
                uid=entry.uid or None,
                nationality_label=entry.nationality_label or None,
                nationality_code=entry.nationality_code,
                violation_date=entry.violation_date,
                duty_unit=entry.duty_unit,
                details_text=entry.details_text or None,
                wing=entry.wing or None,
                holding_no=entry.holding_no or None,
                reporter_id=entry.reporter_id,
                reporter_name=entry.reporter_name,
                source_book_id=entry.source_book_id,
                source_version_no=entry.source_version_no,
                source_row_index=entry.source_row_index,
                source_ref_number=entry.source_ref_number,
                incomplete_marks=list(entry.incomplete_marks),
                manual_reason=entry.manual_reason,
                manual_created_by=entry.manual_created_by,
                manual_created_by_name=entry.manual_created_by_name,
                manual_created_at=entry.manual_created_at,
            )
        )
    db.flush()


def _carry_forward_duty_units(
    entries: tuple[RegisterEntry, ...],
    previous: dict[str, str],
) -> None:
    """No downgrade on ``السربة`` across a re-close.

    ``duty_event_retention_days`` purges the events this column derives from, so
    a late re-close could print ``غير محدد`` where the previous seal held a real
    unit. A retroactively corrected assignment still re-derives normally,
    because it yields a real unit.
    """

    for entry in entries:
        if entry.duty_unit != UNSPECIFIED:
            continue
        sealed = previous.get(entry.handle)
        if sealed and sealed != UNSPECIFIED:
            entry.duty_unit = sealed
            entry.incomplete_marks = [
                mark for mark in entry.incomplete_marks if mark != MISSING_DUTY_UNIT
            ]


def close_month(
    db: Session,
    year: int,
    month: int,
    *,
    actor: User,
    force_reason: str | None = None,
    today: date | None = None,
) -> MonthRegister:
    """Freeze the month's entries as the register's source of truth."""

    if not month_has_ended(year, month, today=today):
        raise ConflictError(
            "INMATE_REGISTER_MONTH_NOT_ENDED",
            "A Violation month cannot be closed before it ends.",
            year=year,
            month=month,
            first_closable_date=first_closable_date(year, month).isoformat(),
        )
    period = _period(db, year, month)
    if period is not None and period.closed_at is not None:
        raise ConflictError(
            "INMATE_REGISTER_ALREADY_CLOSED",
            "This Violation month is already closed.",
            year=year,
            month=month,
        )
    entries, _uncounted = project_month(db, year, month)
    if not entries:
        raise ConflictError(
            "INMATE_REGISTER_MONTH_EMPTY",
            "This Violation month has no entries to freeze.",
            year=year,
            month=month,
        )
    blocking = [entry for entry in entries if entry.missing]
    reason = (force_reason or "").strip()
    if blocking and not reason:
        raise ConflictError(
            "INMATE_REGISTER_INCOMPLETE_ENTRIES",
            "The month has entries pending completion; closing over them needs a reason.",
            year=year,
            month=month,
            entries=[
                {"id": entry.handle, "name": entry.name, "missing": entry.missing}
                for entry in blocking
            ],
        )
    previous_units: dict[str, str] = {}
    if period is None:
        period = InmateViolationPeriod(year=year, month=month)
        db.add(period)
        db.flush()
    else:
        previous_units = {
            row.row_handle: _text(row.duty_unit)
            for row in db.scalars(
                select(InmateViolationStatRow).where(InmateViolationStatRow.period_id == period.id)
            )
        }
    _carry_forward_duty_units(entries, previous_units)
    for entry in entries:
        # A forced close records that the month was closed over unknowns; it
        # never discovers them, and it never moves an entry between groups. Only
        # the entries it sealed over are marked — an ordinary close freezes a
        # complete entry with no marks at all.
        if entry.missing:
            marks = set(entry.incomplete_marks) | set(entry.missing)
            if entry.duty_unit == UNSPECIFIED:
                marks.add(MISSING_DUTY_UNIT)
            entry.incomplete_marks = sorted(marks)
        entry.missing = []
    _freeze(db, period, entries)
    period.closed_at = _utcnow()
    period.closed_by = actor.id
    period.force_reason = reason or None
    _audit(
        db,
        actor=actor,
        action=(
            "inmate_violation_month_force_closed" if blocking else "inmate_violation_month_closed"
        ),
        entity_type="inmate_violation_period",
        entity_id=f"{year}-{month:02d}",
        payload={
            "year": year,
            "month": month,
            "row_count": len(entries),
            **({"reason": reason} if blocking else {}),
        },
    )
    db.flush()
    _write_export_copy(period, build_month(db, year, month))
    db.commit()
    return build_month(db, year, month)


def reopen_month(db: Session, year: int, month: int, *, actor: User) -> MonthRegister:
    """Return a closed month to live projection.

    The previous seal's entries stay in place until the month is closed again;
    ``closed_at IS NULL`` alone means open, so entry presence never signals
    closure.
    """

    period = _period(db, year, month)
    if period is None or period.closed_at is None:
        raise ConflictError(
            "INMATE_REGISTER_NOT_CLOSED",
            "This Violation month is not closed.",
            year=year,
            month=month,
        )
    row_count = db.scalar(
        select(func.count())
        .select_from(InmateViolationStatRow)
        .where(InmateViolationStatRow.period_id == period.id)
    )
    period.closed_at = None
    period.closed_by = None
    period.force_reason = None
    period.reopened_at = _utcnow()
    period.reopened_by = actor.id
    _audit(
        db,
        actor=actor,
        action="inmate_violation_month_reopened",
        entity_type="inmate_violation_period",
        entity_id=f"{year}-{month:02d}",
        payload={"year": year, "month": month, "row_count": int(row_count or 0)},
    )
    db.commit()
    return build_month(db, year, month)


# --------------------------------------------------------------------------- #
# the workbook
# --------------------------------------------------------------------------- #

#: Where the close-time copy of a sealed month lives, relative to ``data_dir``.
EXPORT_DIR_NAME: Final[str] = "inmate_violations"


def manual_row_month(db: Session, manual_row_id: int) -> tuple[int, int]:
    row = db.get(InmateViolationManualRow, manual_row_id)
    if row is None:
        raise NotFoundError("INMATE_REGISTER_ROW_NOT_FOUND", "Manual entry not found.")
    return row.year, row.month


def record_month(db: Session, book: Book) -> tuple[int, int]:
    """The Violation month a Record's occurrences belong to."""

    version = max(book.versions, key=lambda item: item.version_no, default=None)
    fields = version.fields if version is not None and isinstance(version.fields, dict) else {}
    violation_date = _parse_date(fields.get("report_date"))
    if violation_date is None:
        raise ValidationFailedError(
            "INMATE_REGISTER_RECORD_NOT_DATED",
            "This Record has no usable violation date.",
        )
    return violation_date.year, violation_date.month


#: The details cell of an entry with no narrative of its own, per language.
_REFERENCE_CELL: Final[Mapping[str, str]] = MappingProxyType(
    {"ar": "راجع التقرير {ref}", "en": "See Record {ref}"}
)


def _export_row(entry: RegisterEntry, ordinal: int, language: str) -> xlsx.RegisterRow:
    # An uncompleted import has no narrative yet; the scan is exactly where the
    # missing detail is, so the cell points at the paper instead of lying blank.
    details = entry.details_text
    if not details and entry.source_ref_number:
        template = _REFERENCE_CELL.get(language, _REFERENCE_CELL["ar"])
        details = template.format(ref=entry.source_ref_number)
    return xlsx.RegisterRow(
        row_no=ordinal,
        name=entry.name,
        uid=entry.uid,
        nationality_label=entry.nationality_label,
        violation_date=entry.violation_date,
        duty_unit=entry.duty_unit,
        details_text=details,
    )


def _sections(
    month: MonthRegister,
    *,
    language: str,
    populations: Sequence[str],
) -> list[xlsx.RegisterSection]:
    """The workbook's table blocks, in paper order, narrowed to ``populations``.

    An export that silently omits a filed occurrence is the one failure this
    register cannot have, so the default is every group; dropping one is an
    explicit choice the operator makes in the export workspace.
    """

    sections: list[xlsx.RegisterSection] = []
    for population in POPULATIONS:
        if population not in populations:
            continue
        rows = [entry for entry in month.entries if entry.population == population]
        sections.append(
            xlsx.RegisterSection(
                key=population,
                rows=tuple(_export_row(entry, entry.row_no, language) for entry in rows),
            )
        )
    return sections


def render_workbook(
    month: MonthRegister,
    *,
    language: str = "ar",
    populations: Sequence[str] = POPULATIONS,
) -> tuple[bytes, str]:
    """Render one month as the register workbook. Pure — no seal, no writes."""

    payload = xlsx.build_register_workbook(
        year=month.year,
        month=month.month,
        sections=_sections(month, language=language, populations=populations),
        closed_at=month.closed_at,
        closed_by_name=month.closed_by_name,
        force_reason=month.force_reason,
        language=language,
    )
    return payload, xlsx.register_filename(month.year, month.month, language)


def _export_copy_path(year: int, month: int) -> str:
    return f"{EXPORT_DIR_NAME}/{year}-{month:02d}.xlsx"


def _write_export_copy(period: InmateViolationPeriod, month: MonthRegister) -> None:
    """Materialise the sealed month's workbook — a file to send, not evidence.

    Replaced on every re-close, so only the newest copy exists. It is a cache of
    a deterministic render; the frozen entries are the proof of what a month
    contained.
    """

    relative = _export_copy_path(month.year, month.month)
    target = get_settings().data_dir / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    payload, _filename = render_workbook(month, language="ar")
    target.write_bytes(payload)
    period.export_path = relative


def export_workbook(
    db: Session,
    year: int,
    month: int,
    *,
    language: str = "ar",
    populations: Sequence[str] = POPULATIONS,
) -> tuple[bytes, str]:
    """The download. Serves the sealed month's stored Arabic copy when it exists.

    Downloading never closes a month: an operator exporting an open month must
    not seal it by accident. The stored copy is the whole register in Arabic, so
    it only answers a request for exactly that.
    """

    register = build_month(db, year, month)
    period = _period(db, year, month)
    if (
        language == "ar"
        and tuple(populations) == POPULATIONS
        and register.closed
        and period is not None
        and period.export_path is not None
    ):
        stored = get_settings().data_dir / period.export_path
        if stored.is_file():
            return stored.read_bytes(), xlsx.register_filename(year, month, language)
    return render_workbook(register, language=language, populations=populations)
