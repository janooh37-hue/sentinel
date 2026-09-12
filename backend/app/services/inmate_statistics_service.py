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

import hashlib
import json
import os
import tempfile
from calendar import monthrange
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from dataclasses import fields as dataclass_fields
from datetime import UTC, date, datetime, time
from functools import cached_property, wraps
from types import MappingProxyType
from typing import Any, Final

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.errors import AppError, ConflictError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core import inmate_statistics_xlsx as xlsx
from app.core.html_text import html_to_text
from app.core.inmate_wings import CANONICAL_WINGS, normalize_wing
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
    InmateViolationSubmission,
    InmateViolationWorkflow,
    InmateViolationWorkflowAction,
    User,
    UserPermission,
)
from app.db.workforce_models import DutyAssignmentEvent
from app.services import perm_service

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


class _SubmissionPayload(BaseModel):
    """Strict persisted report envelope, separate from the public month DTO."""

    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: int = Field(ge=1, le=1)
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    entries: list[RegisterEntry]


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
    export_ready: bool
    entries: tuple[RegisterEntry, ...]
    uncounted: tuple[UncountedRecord, ...]
    arrived_after_close: tuple[ArrivedAfterClose, ...]
    workflow: dict[str, Any] = field(default_factory=dict)
    legacy_metadata: dict[str, Any] | None = None

    @property
    def closed(self) -> bool:
        return self.closed_at is not None

    @cached_property
    def _aggregates(self) -> tuple[dict[str, int], dict[str, Any]]:
        """Three per-table counts plus the three-term month total.

        Never stored: a stored total is a second source of truth for a ``len()``.
        """

        counts = {key: 0 for key in POPULATIONS}
        wings = dict.fromkeys(CANONICAL_WINGS, 0)
        unassigned = 0
        for entry in self.entries:
            counts[entry.population] += 1
            try:
                wing = normalize_wing(entry.wing)
            except ValueError:
                wing = None
            if wing:
                wings[wing] += 1
            else:
                unassigned += 1
        counts["total"] = sum(counts[key] for key in POPULATIONS)
        positive = [value for value in wings.values() if value > 0]
        most, least = max(positive, default=0), min(positive, default=0)
        return counts, {
            "counts": [{"wing": wing.value, "violations": count} for wing, count in wings.items()],
            "most": [wing.value for wing, count in wings.items() if count == most and most],
            "most_count": most,
            "least": [wing.value for wing, count in wings.items() if count == least and least],
            "least_count": least,
            "zero": [wing.value for wing, count in wings.items() if not count],
            "unassigned_count": unassigned,
        }

    @property
    def counts(self) -> dict[str, int]:
        return self._aggregates[0]

    @property
    def wing_summary(self) -> dict[str, Any]:
        return self._aggregates[1]

    @property
    def projection_fingerprint(self) -> str:
        return _fingerprint(_snapshot(self.year, self.month, self.entries))

    @property
    def blocking(self) -> tuple[RegisterEntry, ...]:
        """Entries that prevent final approval."""

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
        try:
            wing = normalize_wing(entry.wing)
        except ValueError:
            wing = None
        if wing:
            entry.wing = wing
        else:
            missing.append("wing")
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


def build_month(db: Session, year: int, month: int, *, actor: User | None = None) -> MonthRegister:
    """One month, live or sealed. Never writes — the seal is an explicit act."""

    period = _period(db, year, month)
    if period is None or period.closed_at is None:
        entries, uncounted = effective_projection(db, year, month)
        result = MonthRegister(
            year=year,
            month=month,
            closed_at=None,
            closed_by=None,
            closed_by_name=None,
            reopened_at=period.reopened_at if period else None,
            reopened_by=period.reopened_by if period else None,
            reopened_by_name=_user_name(db, period.reopened_by) if period else None,
            export_ready=False,
            entries=entries,
            uncounted=uncounted,
            arrived_after_close=(),
        )
        return replace(result, workflow=_workflow_out(db, result, actor=actor))

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
    root = _workflow(db, year, month)
    submission = _active_submission(db, root)
    if submission is not None:
        sealed = list(_restore_entries(submission.payload))
    facts = _actor_facts(db, submission)
    metadata = _legacy_metadata(submission)
    result = MonthRegister(
        year=year,
        month=month,
        closed_at=period.closed_at,
        closed_by=period.closed_by,
        closed_by_name=(facts.get("approved") or {}).get("name_ar"),
        reopened_at=period.reopened_at,
        reopened_by=period.reopened_by,
        reopened_by_name=_user_name(db, period.reopened_by),
        export_ready=bool(period.export_path),
        entries=tuple(sealed),
        uncounted=uncounted,
        arrived_after_close=arrived,
        legacy_metadata=metadata,
    )
    return replace(result, workflow=_workflow_out(db, result, actor=actor))


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


def _transaction(operation):
    """The public mutation owns the request transaction, including every refusal."""
    @wraps(operation)
    def run(db: Session, *args, **kwargs):
        try:
            result = operation(db, *args, **kwargs)
            db.commit()
            return result
        except OperationalError as exc:
            db.rollback()
            if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                raise ConflictError("INMATE_REGISTER_STALE_WORKFLOW", "Another writer changed this month. Reload and try again.") from exc
            raise
        except Exception:
            db.rollback()
            raise
    return run

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


@_transaction
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

    _reserve_local_edit(db, year, month, actor)
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
        wing=_validated_wing(wing),
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
    return row


@_transaction
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
    _reserve_local_edit(db, row.year, row.month, actor)
    row = db.get(InmateViolationManualRow, manual_row_id, populate_existing=True)
    if row is None:
        raise NotFoundError("INMATE_REGISTER_ROW_NOT_FOUND", "Manual entry not found.")
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
        elif cell == "wing":
            row.wing = _validated_wing(value)
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
    return row


@_transaction
def delete_manual_row(db: Session, manual_row_id: int, *, actor: User) -> None:
    """The one operation that removes a line leaving no trace on any survivor."""

    row = db.get(InmateViolationManualRow, manual_row_id)
    if row is None:
        raise NotFoundError("INMATE_REGISTER_ROW_NOT_FOUND", "Manual entry not found.")
    _reserve_local_edit(db, row.year, row.month, actor)
    row = db.get(InmateViolationManualRow, manual_row_id, populate_existing=True)
    if row is None:
        raise NotFoundError("INMATE_REGISTER_ROW_NOT_FOUND", "Manual entry not found.")
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


# --------------------------------------------------------------------------- #
# completing an imported approved copy
# --------------------------------------------------------------------------- #


@_transaction
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
    reserved_month = (violation_date.year, violation_date.month)
    _reserve_local_edit(db, *reserved_month, actor)
    book = db.get(Book, book_id, populate_existing=True)
    if book is None or book.deleted_at is not None:
        raise NotFoundError("BOOK_NOT_FOUND", "Record not found.")
    version = max(book.versions, key=lambda item: item.version_no, default=None)
    fields = dict(version.fields) if version is not None and isinstance(version.fields, dict) else {}
    fresh_date = _parse_date(fields.get("report_date"))
    if (version is None or version.template_id != TEMPLATE_ID or not fields.get("imported_approved") or fresh_date is None or (fresh_date.year, fresh_date.month) != reserved_month):
        raise ConflictError("INMATE_REGISTER_STALE_PROJECTION", "The source Record changed. Reload before completing it.")
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
    for row in rows:
        row["wing"] = _validated_wing(row.get("wing")) or ""
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


def _workflow(db: Session, year: int, month: int) -> InmateViolationWorkflow | None:
    return db.scalar(select(InmateViolationWorkflow).where(InmateViolationWorkflow.year == year, InmateViolationWorkflow.month == month))


def _active_submission(db: Session, root: InmateViolationWorkflow | None) -> InmateViolationSubmission | None:
    if root is None or root.current_sequence == 0:
        return None
    return db.scalar(select(InmateViolationSubmission).where(InmateViolationSubmission.workflow_id == root.id, InmateViolationSubmission.sequence == root.current_sequence))


def _snapshot(year: int, month: int, entries: tuple[RegisterEntry, ...]) -> dict[str, Any]:
    return json.loads(json.dumps({"schema_version": 1, "year": year, "month": month, "entries": [asdict(entry) for entry in entries]}, ensure_ascii=False, default=lambda value: value.isoformat()))


def _fingerprint(payload: dict[str, Any]) -> str:
    # Keep provenance, but changing only a creator's account display name is
    # not a change to the violation being reviewed.
    canonical = {**payload, "entries": [
        {key: value for key, value in row.items() if key not in {"manual_created_by_name", "_sort_created_at"}}
        for row in payload["entries"]
    ]}
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def _restore_entries(payload: dict[str, Any]) -> tuple[RegisterEntry, ...]:
    entries = []
    for stored in payload["entries"]:
        row = dict(stored)
        row["violation_date"] = date.fromisoformat(row["violation_date"])
        if row.get("manual_created_at"):
            row["manual_created_at"] = datetime.fromisoformat(row["manual_created_at"])
        entries.append(RegisterEntry(**row))
    return tuple(entries)


def effective_projection(db: Session, year: int, month: int) -> tuple[tuple[RegisterEntry, ...], tuple[UncountedRecord, ...]]:
    entries, uncounted = project_month(db, year, month)
    period = _period(db, year, month)
    if period is not None and period.closed_at is None:
        previous = {row.row_handle: _text(row.duty_unit) for row in db.scalars(select(InmateViolationStatRow).where(InmateViolationStatRow.period_id == period.id))}
        _carry_forward_duty_units(entries, previous)
    return entries, uncounted


_READ_CAPS = ("books.view", f"books.servicerecords.{TEMPLATE_ID}")
_NAV_CAPS = ("documents.generate", f"books.service.{TEMPLATE_ID}")
_WRITE_CAPS = ("books.edit", f"books.service.{TEMPLATE_ID}")


def _caps(db: Session, user: User, stage: str) -> bool:
    capabilities = _READ_CAPS + _NAV_CAPS
    if stage == "prepare":
        capabilities += ("books.edit",)
    elif stage in {"review", "approve"}:
        capabilities += (f"inmate_statistics.{stage}",)
    effective = perm_service.effective_caps(db, user)
    # Admin lockout protection elsewhere does not waive a stage-specific deny.
    denied = set(db.scalars(select(UserPermission.capability).where(UserPermission.user_id == user.id, UserPermission.effect == "deny")))
    return user.status == "active" and all(cap in effective and cap not in denied for cap in capabilities)


def _identity(db: Session, user: User | None, stage: str, *, earlier: Sequence[dict[str, Any]] = (), selected_employee_id: str | None = None) -> dict[str, Any]:
    if user is None or not _caps(db, user, stage):
        raise AppError("INMATE_REGISTER_ACTOR_INELIGIBLE", "This account is not active or lacks the required report capabilities.", http_status=403)
    employee = db.get(Employee, user.employee_id) if user.employee_id else None
    if employee is None or not _text(employee.id) or not _text(employee.name_ar):
        raise ValidationFailedError("INMATE_REGISTER_INVALID_ACTOR_PROFILE", "Link the account to an employee with an Arabic name and employee ID.")
    if selected_employee_id is not None and employee.id != selected_employee_id:
        raise ConflictError("INMATE_REGISTER_ASSIGNEE_RELINKED", "The selected account's employee link changed. Prepare a new submission.")
    if any(item["user_id"] == user.id or item["employee_id"] == employee.id for item in earlier):
        raise ValidationFailedError("INMATE_REGISTER_ACTORS_NOT_DISTINCT", "Preparation, review and approval require different accounts and employees.")
    return {"user_id": user.id, "name_ar": employee.name_ar.strip(), "employee_id": employee.id}


def _eligible(db: Session, user: User | None, stage: str, **kwargs) -> bool:
    try:
        _identity(db, user, stage, **kwargs)
        return True
    except AppError:
        return False


def _reserve(db: Session, year: int, month: int, *, expected_version: int | None = None, states: Sequence[str] = ("draft", "awaiting_review", "awaiting_manager")) -> InmateViolationWorkflow:
    # This is deliberately the FIRST mutation. It obtains SQLite's writer
    # reservation before source projection, identity checks or a local edit.
    conditions = [InmateViolationWorkflow.year == year, InmateViolationWorkflow.month == month, InmateViolationWorkflow.state.in_(states)]
    if expected_version is not None:
        conditions.append(InmateViolationWorkflow.version == expected_version)
    changed = db.execute(update(InmateViolationWorkflow).where(*conditions).values(version=InmateViolationWorkflow.version + 1).execution_options(synchronize_session=False))
    if changed.rowcount == 0:
        # Absent roots start at version zero. Existing roots cannot be reset.
        db.execute(insert(InmateViolationWorkflow).values(year=year, month=month, version=0, current_sequence=0, state="draft").on_conflict_do_nothing(index_elements=["year", "month"]))
        changed = db.execute(update(InmateViolationWorkflow).where(*conditions).values(version=InmateViolationWorkflow.version + 1).execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            if expected_version is None:
                db.expire_all()
                _assert_open(db, year, month)
            raise ConflictError("INMATE_REGISTER_STALE_WORKFLOW", "The workflow changed or is closed. Reload before acting.")
    db.expire_all()
    for mapped in list(db.identity_map.values()):
        if isinstance(mapped, User):
            mapped._effective_caps_cache = None
    root = _workflow(db, year, month)
    assert root is not None
    return root


def _actor_facts(db: Session, submission: InmateViolationSubmission | None) -> dict[str, dict[str, Any]]:
    if submission is None:
        return {}
    return {
        event.action: {"user_id": event.actor_user_id, "name_ar": event.actor_name_ar, "employee_id": event.actor_employee_id, "acted_at": event.occurred_at}
        for event in db.scalars(select(InmateViolationWorkflowAction).where(InmateViolationWorkflowAction.submission_id == submission.id, InmateViolationWorkflowAction.action.in_(("prepared", "reviewed", "approved"))))
    }


def _append(db: Session, root: InmateViolationWorkflow, submission: InmateViolationSubmission | None, action: str, *, facts: dict[str, Any] | None = None, reason: str | None = None, occurred_at: datetime | None = None) -> None:
    facts = facts or {}
    db.add(InmateViolationWorkflowAction(workflow_id=root.id, submission_id=submission.id if submission else None, action=action, actor_user_id=facts.get("user_id"), actor_name_ar=facts.get("name_ar"), actor_employee_id=facts.get("employee_id"), reason=reason, occurred_at=occurred_at if occurred_at is not None else _utcnow()))
    db.flush()


def _reason(value: str | None) -> str:
    reason = _text(value)
    if not reason:
        raise ValidationFailedError("INMATE_REGISTER_REASON_REQUIRED", "A reason is required.", field="reason")
    return reason


def _validated_wing(value: Any) -> str | None:
    try:
        return normalize_wing(_text(value))
    except ValueError as exc:
        raise ValidationFailedError("INMATE_REGISTER_INVALID_WING", str(exc), field="wing") from exc


def _reserve_local_edit(db: Session, year: int, month: int, actor: User) -> None:
    root = _reserve(db, year, month)
    _assert_open(db, year, month)
    if actor.status != "active" or not all(perm_service.has_capability(db, actor, cap) for cap in _WRITE_CAPS):
        raise AppError("FORBIDDEN", "Register write capabilities are required.", http_status=403)
    if root.state in {"awaiting_review", "awaiting_manager"}:
        # Ordinary edits need no signing profile. Preserve whatever identity
        # exists after the reservation refreshed the account and employee.
        employee = db.get(Employee, actor.employee_id) if actor.employee_id else None
        facts = {
            "user_id": actor.id,
            "employee_id": employee.id if employee else None,
            "name_ar": (_text(employee.name_ar) or None) if employee else None,
        }
        _append(db, root, _active_submission(db, root), "invalidated", facts=facts, reason="register_changed")
        root.state = "draft"
        db.flush()


def _validated_submission(root: InmateViolationWorkflow, submission: InmateViolationSubmission) -> tuple[RegisterEntry, ...]:
    """Validate stored evidence under the action's existing writer reservation."""
    try:
        payload = submission.payload
        parsed = _SubmissionPayload.model_validate_json(
            json.dumps(payload, ensure_ascii=False, allow_nan=False), strict=True
        )
        if (parsed.year, parsed.month) != (root.year, root.month):
            raise ValueError("Submission belongs to a different month")
        expected_fields = {item.name for item in dataclass_fields(RegisterEntry)}
        if any(set(row) != expected_fields for row in payload["entries"]):
            raise ValueError("Submission entry fields do not match its schema")
        if any((entry.violation_date.year, entry.violation_date.month) != (root.year, root.month) for entry in parsed.entries):
            raise ValueError("Submission entry date belongs to a different month")
        if _fingerprint(payload) != submission.fingerprint:
            raise ValueError("Submission fingerprint does not match its stored payload")
    except (ValidationError, TypeError, ValueError) as exc:
        raise ConflictError(
            "INMATE_REGISTER_INVALID_SUBMISSION",
            "The stored report failed integrity validation. Prepare a new submission before advancing.",
        ) from exc
    return tuple(parsed.entries)


def _fresh(db: Session, root: InmateViolationWorkflow, submission: InmateViolationSubmission) -> tuple[RegisterEntry, ...]:
    reviewed_entries = _validated_submission(root, submission)
    entries, _ = effective_projection(db, root.year, root.month)
    if _fingerprint(_snapshot(root.year, root.month, entries)) != submission.fingerprint:
        raise ConflictError("INMATE_REGISTER_STALE_PROJECTION", "The submitted data changed. A new preparation and review are required.")
    return reviewed_entries


def _submission_for_action(db: Session, root: InmateViolationWorkflow, submission_id: int) -> InmateViolationSubmission:
    submission = _active_submission(db, root)
    if submission is None or submission.id != submission_id:
        raise ConflictError("INMATE_REGISTER_STALE_WORKFLOW", "This submission is no longer active.")
    return submission


def _assigned_actor(db: Session, actor: User, submission: InmateViolationSubmission, stage: str) -> dict[str, Any]:
    prefix = "reviewer" if stage == "review" else "manager"
    if getattr(submission, f"{prefix}_user_id") != actor.id:
        raise AppError("INMATE_REGISTER_WRONG_ASSIGNEE", "Only the selected person may perform this stage.", http_status=403)
    facts = _actor_facts(db, submission)
    earlier = [facts[key] for key in ("prepared", "reviewed") if key in facts and not (stage == "review" and key == "reviewed")]
    return _identity(db, actor, stage, earlier=earlier, selected_employee_id=getattr(submission, f"{prefix}_employee_id"))


@_transaction
def prepare_month(db: Session, year: int, month: int, *, actor: User, expected_version: int, expected_projection_fingerprint: str, reviewer_user_id: int, supersede_reason: str | None = None) -> MonthRegister:
    root = _reserve(db, year, month, expected_version=expected_version)
    _assert_open(db, year, month)
    facts = _identity(db, actor, "prepare")
    reviewer = _identity(db, db.get(User, reviewer_user_id), "review", earlier=[facts])
    entries, _ = effective_projection(db, year, month)
    payload = _snapshot(year, month, entries)
    fingerprint = _fingerprint(payload)
    if expected_projection_fingerprint != fingerprint:
        raise ConflictError("INMATE_REGISTER_STALE_PROJECTION", "The preview changed. Reload the report before submitting.")
    previous = _active_submission(db, root)
    if previous is not None:
        prior_facts = _actor_facts(db, previous)
        if root.state in {"awaiting_review", "awaiting_manager"} and fingerprint == previous.fingerprint:
            if actor.role != "admin" and (prior_facts.get("prepared") or {}).get("user_id") != actor.id:
                raise AppError("INMATE_REGISTER_SUPERSEDE_FORBIDDEN", "Only the preparer or an administrator may replace a fresh submission.", http_status=403)
            supersede_reason = _reason(supersede_reason)
        _append(db, root, previous, "superseded", facts=facts, reason=_text(supersede_reason) or None)
    root.current_sequence += 1
    root.state = "awaiting_review"
    submission = InmateViolationSubmission(workflow_id=root.id, sequence=root.current_sequence, payload=payload, fingerprint=fingerprint, created_at=_utcnow(), origin="workflow", reviewer_user_id=reviewer["user_id"], reviewer_employee_id=reviewer["employee_id"])
    db.add(submission)
    db.flush()
    _append(db, root, submission, "prepared", facts=facts)
    return build_month(db, year, month, actor=actor)


@_transaction
def review_month(db: Session, year: int, month: int, *, actor: User, expected_version: int, submission_id: int, manager_user_id: int) -> MonthRegister:
    root = _reserve(db, year, month, expected_version=expected_version, states=("awaiting_review",))
    submission = _submission_for_action(db, root, submission_id)
    facts = _assigned_actor(db, actor, submission, "review")
    _fresh(db, root, submission)
    earlier = [*_actor_facts(db, submission).values(), facts]
    manager = _identity(db, db.get(User, manager_user_id), "approve", earlier=earlier)
    submission.manager_user_id = manager["user_id"]
    submission.manager_employee_id = manager["employee_id"]
    root.state = "awaiting_manager"
    _append(db, root, submission, "reviewed", facts=facts)
    return build_month(db, year, month, actor=actor)


@_transaction
def return_month(db: Session, year: int, month: int, *, actor: User, expected_version: int, submission_id: int, reason: str) -> MonthRegister:
    root = _reserve(db, year, month, expected_version=expected_version, states=("awaiting_review", "awaiting_manager"))
    submission = _submission_for_action(db, root, submission_id)
    facts = _assigned_actor(db, actor, submission, "review" if root.state == "awaiting_review" else "approve")
    _append(db, root, submission, "returned", facts=facts, reason=_reason(reason))
    root.state = "draft"
    db.flush()
    return build_month(db, year, month, actor=actor)


@_transaction
def approve_month(db: Session, year: int, month: int, *, actor: User, expected_version: int, submission_id: int, today: date | None = None) -> MonthRegister:
    root = _reserve(db, year, month, expected_version=expected_version, states=("awaiting_manager",))
    _assert_open(db, year, month)
    submission = _submission_for_action(db, root, submission_id)
    facts = _assigned_actor(db, actor, submission, "approve")
    earlier = _actor_facts(db, submission)
    if "prepared" not in earlier or "reviewed" not in earlier:
        raise ConflictError("INMATE_REGISTER_STALE_WORKFLOW", "Preparation and review are required.")
    entries = _fresh(db, root, submission)
    if not month_has_ended(year, month, today=today):
        raise ConflictError("INMATE_REGISTER_MONTH_NOT_ENDED", "Final approval is available after month-end.", first_closable_date=first_closable_date(year, month).isoformat())
    if not entries:
        raise ConflictError("INMATE_REGISTER_MONTH_EMPTY", "There are no entries to approve.")
    blocking = [entry for entry in entries if entry.missing]
    if blocking:
        raise ConflictError("INMATE_REGISTER_INCOMPLETE_ENTRIES", "Complete the entries and submit the report again.", entries=[{"id": entry.handle, "name": entry.name, "missing": entry.missing} for entry in blocking])
    period = _period(db, year, month)
    if period is None:
        period = InmateViolationPeriod(year=year, month=month)
        db.add(period)
        db.flush()
    _freeze(db, period, entries)
    approved_at = _utcnow()
    period.closed_at = approved_at
    period.closed_by = actor.id
    root.state = "closed"
    _append(db, root, submission, "approved", facts=facts, occurred_at=approved_at)
    _audit(db, actor=actor, action="inmate_violation_month_closed", entity_type="inmate_violation_period", entity_id=f"{year}-{month:02d}", payload={"year": year, "month": month, "submission_id": submission.id, "row_count": len(entries)})
    db.flush()
    result = build_month(db, year, month, actor=actor)
    _write_export_copy(period, result, submission_id=submission.id)
    db.flush()
    return replace(result, export_ready=True)


@_transaction
def reopen_month(db: Session, year: int, month: int, *, actor: User, expected_version: int, reason: str) -> MonthRegister:
    root = _reserve(db, year, month, expected_version=expected_version, states=("closed",))
    if actor.role != "admin" or not _caps(db, actor, "navigation"):
        raise AppError("FORBIDDEN", "Administrator access and register navigation are required.", http_status=403)
    reason = _reason(reason)
    period = _period(db, year, month)
    if period is None or period.closed_at is None:
        raise ConflictError("INMATE_REGISTER_NOT_CLOSED", "This month is not closed.")
    period.closed_at = None
    period.closed_by = None
    period.reopened_at = _utcnow()
    period.reopened_by = actor.id
    root.state = "draft"
    employee = db.get(Employee, actor.employee_id) if actor.employee_id else None
    _append(db, root, _active_submission(db, root), "reopened", facts={"user_id": actor.id, "employee_id": actor.employee_id, "name_ar": employee.name_ar if employee else None}, reason=reason)
    _audit(db, actor=actor, action="inmate_violation_month_reopened", entity_type="inmate_violation_period", entity_id=f"{year}-{month:02d}", payload={"year": year, "month": month, "reason": reason})
    db.flush()
    return build_month(db, year, month, actor=actor)


# --------------------------------------------------------------------------- #
# the workbook
# --------------------------------------------------------------------------- #


def _assignment(db: Session, submission: InmateViolationSubmission, stage: str) -> dict[str, Any] | None:
    prefix = "reviewer" if stage == "review" else "manager"
    user_id = getattr(submission, f"{prefix}_user_id")
    employee_id = getattr(submission, f"{prefix}_employee_id")
    if user_id is None and employee_id is None:
        return None
    user = db.get(User, user_id) if user_id is not None else None
    facts = _actor_facts(db, submission)
    earlier = [facts[key] for key in ("prepared", "reviewed") if key in facts and not (stage == "review" and key == "reviewed")]
    employee = db.get(Employee, employee_id) if employee_id else None
    return {"user_id": user_id, "employee_id": employee_id, "name_ar": employee.name_ar if employee else None, "eligible": _eligible(db, user, stage, earlier=earlier, selected_employee_id=employee_id)}


def _legacy_metadata(submission: InmateViolationSubmission | None) -> dict[str, Any] | None:
    if submission is None or submission.origin != "legacy":
        return None
    # The raw SQL archive preserves NULL distinctions for audit/downgrade;
    # month responses need only closure metadata, not a duplicate full report.
    return {key: value for key, value in (submission.legacy_metadata or {}).items() if key != "stored_rows"}


def _workflow_out(db: Session, month: MonthRegister, *, actor: User | None = None) -> dict[str, Any]:
    root = _workflow(db, month.year, month.month)
    submission = _active_submission(db, root)
    state = root.state if root else "draft"
    facts = _actor_facts(db, submission)
    stale = bool(submission and state != "closed" and (state == "draft" or month.projection_fingerprint != submission.fingerprint))
    shown_facts = facts if state != "draft" else {}
    reviewer = _assignment(db, submission, "review") if submission else None
    manager = _assignment(db, submission, "approve") if submission else None
    allowed = []
    blockers = []
    if stale:
        blockers.append({"code": "INMATE_REGISTER_STALE_PROJECTION", "details": {}})
    if not month.closed and not month_has_ended(month.year, month.month):
        blockers.append({"code": "INMATE_REGISTER_MONTH_NOT_ENDED", "details": {"first_closable_date": first_closable_date(month.year, month.month).isoformat()}})
    if month.blocking:
        blockers.append({"code": "INMATE_REGISTER_INCOMPLETE_ENTRIES", "details": {"entries": [{"id": row.handle, "missing": row.missing} for row in month.blocking]}})
    current_assignment = reviewer if state == "awaiting_review" else manager if state == "awaiting_manager" else None
    if current_assignment and not current_assignment["eligible"]:
        blockers.append({"code": "INMATE_REGISTER_ASSIGNEE_INELIGIBLE", "details": {"user_id": current_assignment["user_id"], "employee_id": current_assignment["employee_id"]}})
    if actor is not None:
        if state != "closed" and _eligible(db, actor, "prepare") and (state == "draft" or stale or actor.role == "admin" or (facts.get("prepared") or {}).get("user_id") == actor.id):
            allowed.append("prepare")
        if current_assignment and current_assignment["user_id"] == actor.id and current_assignment["eligible"]:
            allowed.append("return")
            if not stale:
                if state == "awaiting_review":
                    allowed.append("review")
                elif month_has_ended(month.year, month.month) and month.entries and not month.blocking:
                    allowed.append("approve")
        if state == "closed" and actor.role == "admin" and _caps(db, actor, "navigation"):
            allowed.append("reopen")
        if state != "closed" and _caps(db, actor, "prepare") and not _eligible(db, actor, "prepare"):
            blockers.append({"code": "INMATE_REGISTER_INVALID_ACTOR_PROFILE", "details": {"user_id": actor.id}})
    legacy = bool(submission and submission.origin == "legacy" and state == "closed")
    return {
        "version": root.version if root else 0, "state": state,
        "active_submission_id": submission.id if submission else None,
        "current_sequence": root.current_sequence if root else 0,
        "reviewer": reviewer if state != "draft" else None, "manager": manager if state != "draft" else None,
        "prepared": shown_facts.get("prepared"), "reviewed": shown_facts.get("reviewed"), "approved": shown_facts.get("approved"),
        "needs_review": stale, "blockers": blockers, "allowed_actions": allowed,
        "legacy": legacy, "legacy_metadata": _legacy_metadata(submission) if legacy else None,
    }


def workflow_candidates(db: Session, year: int, month: int, *, actor: User, stage: str) -> list[dict[str, Any]]:
    root = _workflow(db, year, month)
    if root and root.state == "closed":
        raise ConflictError("INMATE_REGISTER_MONTH_CLOSED", "Reopen the month before selecting report actors.")
    if stage == "review":
        earlier = [_identity(db, actor, "prepare")]
        if "prepare" not in build_month(db, year, month, actor=actor).workflow["allowed_actions"]:
            raise AppError("INMATE_REGISTER_SUPERSEDE_FORBIDDEN", "Only the preparer or an administrator may replace a fresh submission.", http_status=403)
    else:
        submission = _active_submission(db, root)
        if root is None or root.state != "awaiting_review" or submission is None:
            raise ConflictError("INMATE_REGISTER_STALE_WORKFLOW", "A submitted report awaiting review is required.")
        reviewer = _assigned_actor(db, actor, submission, "review")
        earlier = [*_actor_facts(db, submission).values(), reviewer]
    choices = []
    for user in db.scalars(select(User).where(User.status == "active").order_by(User.id)):
        try:
            choices.append(_identity(db, user, stage, earlier=earlier))
        except AppError:
            continue
    return choices


def _get_submission(db: Session, year: int, month: int, submission_id: int) -> InmateViolationSubmission:
    submission = db.scalar(select(InmateViolationSubmission).join(InmateViolationWorkflow, InmateViolationWorkflow.id == InmateViolationSubmission.workflow_id).where(InmateViolationWorkflow.year == year, InmateViolationWorkflow.month == month, InmateViolationSubmission.id == submission_id))
    if submission is None:
        raise NotFoundError("INMATE_REGISTER_SUBMISSION_NOT_FOUND", "This report revision does not belong to the requested month.")
    return submission


def _submission_context(db: Session, submission: InmateViolationSubmission) -> dict[str, Any]:
    root = db.get(InmateViolationWorkflow, submission.workflow_id)
    assert root is not None
    facts = _actor_facts(db, submission)
    current = root.current_sequence == submission.sequence and root.state != "draft"
    stale = False
    if current and root.state != "closed":
        entries, _ = effective_projection(db, root.year, root.month)
        stale = _fingerprint(_snapshot(root.year, root.month, entries)) != submission.fingerprint
    elif root.current_sequence == submission.sequence and root.state == "draft":
        stale = True
    state = "legacy" if submission.origin == "legacy" else "approved" if "approved" in facts else "reviewed" if "reviewed" in facts else "prepared"
    return {"id": submission.id, "sequence": submission.sequence, "origin": submission.origin, "created_at": submission.created_at if submission.origin == "workflow" else None, "report_state": state, "approved_at": (facts.get("approved") or {}).get("acted_at"), "current": current, "stale": stale}


def submission_history(db: Session, year: int, month: int) -> list[dict[str, Any]]:
    root = _workflow(db, year, month)
    if root is None:
        return []
    return [_submission_context(db, submission) for submission in db.scalars(select(InmateViolationSubmission).where(InmateViolationSubmission.workflow_id == root.id).order_by(InmateViolationSubmission.sequence.desc()))]


def submission_detail(db: Session, year: int, month: int, submission_id: int) -> dict[str, Any]:
    submission = _get_submission(db, year, month, submission_id)
    context = _submission_context(db, submission)
    actions = [
        {"action": event.action, "occurred_at": event.occurred_at, "actor_user_id": event.actor_user_id,
         "actor_name_ar": event.actor_name_ar, "actor_employee_id": event.actor_employee_id, "reason": event.reason}
        for event in db.scalars(select(InmateViolationWorkflowAction).where(InmateViolationWorkflowAction.submission_id == submission_id).order_by(InmateViolationWorkflowAction.id))
    ]
    return {"submission_id": submission_id, "sequence": context["sequence"], "created_at": context["created_at"], "report_state": context["report_state"], "current": context["current"], "stale": context["stale"], "actions": actions}


def submission_month(db: Session, year: int, month: int, submission_id: int) -> MonthRegister:
    submission = _get_submission(db, year, month, submission_id)
    facts = _actor_facts(db, submission)
    legacy = submission.origin == "legacy"
    metadata = _legacy_metadata(submission)
    approved = facts.get("approved") or {}
    closed_at = approved.get("acted_at") or (metadata or {}).get("closed_at")
    if isinstance(closed_at, str):
        closed_at = datetime.fromisoformat(closed_at)
    context = _submission_context(db, submission)
    workflow = {
        "version": 0, "state": "closed" if closed_at else "awaiting_manager" if "reviewed" in facts else "awaiting_review" if "prepared" in facts else "draft",
        "active_submission_id": submission.id, "current_sequence": submission.sequence,
        "reviewer": _assignment(db, submission, "review"), "manager": _assignment(db, submission, "approve"),
        "prepared": facts.get("prepared"), "reviewed": facts.get("reviewed"), "approved": facts.get("approved"),
        "needs_review": context["stale"], "blockers": [], "allowed_actions": [], "legacy": legacy, "legacy_metadata": metadata,
    }
    return MonthRegister(year=year, month=month, closed_at=closed_at, closed_by=approved.get("user_id") or (metadata or {}).get("closed_by"), closed_by_name=approved.get("name_ar"), reopened_at=None, reopened_by=None, reopened_by_name=None, export_ready=bool(closed_at), entries=_restore_entries(submission.payload), uncounted=(), arrived_after_close=(), workflow=workflow, legacy_metadata=metadata)


def workflow_tasks(db: Session, *, actor: User, today: date | None = None) -> list[dict[str, Any]]:
    """Assigned actions plus cheap unowned discovery; no global live projection."""
    if not _caps(db, actor, "navigation"):
        return []
    can_prepare = _eligible(db, actor, "prepare")
    is_admin = actor.role == "admin"
    tasks = []
    roots = list(db.scalars(select(InmateViolationWorkflow)))
    occupied = {(root.year, root.month) for root in roots if root.state == "closed" or root.current_sequence}
    for root in roots:
        if root.state == "closed":
            continue
        submission = _active_submission(db, root)
        if submission is None:
            continue
        facts = _actor_facts(db, submission)
        preparer_id = (facts.get("prepared") or {}).get("user_id")
        stage = "review" if root.state == "awaiting_review" else "approve" if root.state == "awaiting_manager" else None
        selected_user_id = submission.reviewer_user_id if stage == "review" else submission.manager_user_id if stage == "approve" else None
        owns_preparation = preparer_id == actor.id and can_prepare
        owns_assignment = stage is not None and selected_user_id == actor.id
        if not (owns_preparation or owns_assignment or is_admin):
            continue
        assignment = _assignment(db, submission, stage) if stage else None
        eligible_assignee = bool(owns_assignment and assignment and assignment["eligible"])
        broken_assignment = bool(stage and (assignment is None or not assignment["eligible"]))
        preparer = db.get(User, preparer_id) if is_admin and preparer_id else None
        recovery_candidate = is_admin and not _eligible(db, preparer, "prepare")
        kind, code = None, None
        if is_admin and broken_assignment:
            # Broken handoffs are recoverable immediately, even in a current
            # month. Their discovery does not need a report projection.
            kind, code = "recovery", "INMATE_REGISTER_ASSIGNEE_INELIGIBLE"
        elif owns_preparation or eligible_assignee or recovery_candidate:
            # Only these callers can receive a task affected by freshness.
            # An administrator with healthy unrelated actors skips projection.
            correction = root.state == "draft" or _submission_context(db, submission)["stale"]
            if correction and recovery_candidate:
                kind, code = "recovery", "INMATE_REGISTER_INVALID_ACTOR_PROFILE"
            elif correction and owns_preparation:
                kind, code = "correction", "INMATE_REGISTER_STALE_PROJECTION"
            elif not correction and eligible_assignee:
                kind = stage
        if kind:
            tasks.append({"year": root.year, "month": root.month, "kind": kind, "submission_id": submission.id, "code": code, "row_count": len(submission.payload["entries"])})
    if can_prepare:
        counts: dict[tuple[int, int], int] = {}
        for _book, version in _current_versions(db):
            fields = version.fields if isinstance(version.fields, dict) else {}
            occurred = _parse_date(fields.get("report_date"))
            if occurred:
                key = (occurred.year, occurred.month)
                counts[key] = counts.get(key, 0) + len(_source_rows(fields)[1])
        for year, month, count in db.execute(select(InmateViolationManualRow.year, InmateViolationManualRow.month, func.count()).group_by(InmateViolationManualRow.year, InmateViolationManualRow.month)):
            counts[(year, month)] = counts.get((year, month), 0) + count
        for (year, month), count in sorted(counts.items()):
            if count and (year, month) not in occupied and month_has_ended(year, month, today=today):
                tasks.append({"year": year, "month": month, "kind": "prepare", "submission_id": None, "code": None, "row_count": count})
    return tasks

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
        legacy_force_reason=(month.legacy_metadata or {}).get("force_reason"),
        language=language,
        legacy=month.legacy_metadata is not None,
    )
    return payload, xlsx.register_filename(month.year, month.month, language)


def _export_copy_path(year: int, month: int, submission_id: int) -> str:
    return f"{EXPORT_DIR_NAME}/{year}-{month:02d}-submission-{submission_id}.xlsx"


def _write_export_copy(period: InmateViolationPeriod, month: MonthRegister, *, submission_id: int) -> None:
    """Materialise the sealed month's workbook — a file to send, not evidence.

    Each submission has its own target. Publication updates only the pending
    period transaction; rollback leaves any orphan unreferenced and preserves
    the prior approved file. The submission payload remains the report evidence.
    """

    relative = _export_copy_path(month.year, month.month, submission_id)
    target = get_settings().data_dir / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    payload, _filename = render_workbook(month, language="ar")
    staged = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, suffix=".tmp", delete=False) as stream:
            staged = stream.name
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(staged, target)
    finally:
        if staged and os.path.exists(staged):
            os.unlink(staged)
    period.export_path = relative


def export_workbook(
    db: Session,
    year: int,
    month: int,
    *,
    language: str = "ar",
    populations: Sequence[str] = POPULATIONS,
    submission_id: int | None = None,
) -> tuple[bytes, str]:
    """The download. Serves the sealed month's stored Arabic copy when it exists.

    Downloading never closes a month: an operator exporting an open month must
    not seal it by accident. The stored copy is the whole register in Arabic, so
    it only answers a request for exactly that.
    """

    if submission_id is not None:
        return render_workbook(submission_month(db, year, month, submission_id), language=language, populations=populations)
    register = build_month(db, year, month)
    period = _period(db, year, month)
    if (
        language == "ar"
        and tuple(populations) == POPULATIONS
        and register.closed
        and not register.workflow.get("legacy")
        and period is not None
        and period.export_path is not None
    ):
        stored = get_settings().data_dir / period.export_path
        if stored.is_file():
            return stored.read_bytes(), xlsx.register_filename(year, month, language)
    return render_workbook(register, language=language, populations=populations)
