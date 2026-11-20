"""Closed-period attendance statistics from effective register facts and leave records."""

from __future__ import annotations

import math
import re
from bisect import bisect_right
from calendar import monthrange
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from itertools import batched
from typing import Any, Literal
from unicodedata import normalize

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import Session, aliased

from app.api.errors import ValidationFailedError
from app.core import clock, leave_lifecycle
from app.core.attendance_verdict import RowState, judge_register_row, parse_instant
from app.db.models import Book, BookVersion, Document, Employee, Leave
from app.db.workforce_models import AttendanceCase, DutyAssignmentEvent
from app.schemas.workforce import COMPANY_STATS_UNASSIGNED, StatsStatus
from app.services.workforce_read_service import (
    iter_effective_attendance_rows,
    iter_effective_attendance_totals_rows,
)
from app.services.workforce_scope_service import WorkforceScope, scope_allows

_DAY = timedelta(days=1)
_MAX_DAYS = 366
_LEAVE_KINDS = ("annual", "administrative", "sick", "duty", "national_service", "other")
_METRICS = ("absence", "single_punch", "late")
_MIN_DUE_DUTIES = 30
_MIN_EMPLOYEE_EVENTS = 3
_STATUSES: tuple[StatsStatus, ...] = ("good", "normal", "warn", "bad")
_HOURS = re.compile(r"(?:\d+(?:\.\d*)?|\.\d+)")
_COMPANY_WORD = re.compile(r"[^\W\d_]+")
_COMPANY_NUMBER = re.compile(r"\d+")
_ARABIC_ORDINAL = {
    word: number
    for number, forms in enumerate(
        (
            ("الأولى", "الأول"),
            ("الثانية", "الثاني"),
            ("الثالثة", "الثالث"),
            ("الرابعة", "الرابع"),
            ("الخامسة", "الخامس"),
            ("السادسة", "السادس"),
            ("السابعة", "السابع"),
            ("الثامنة", "الثامن"),
            ("التاسعة", "التاسع"),
            ("العاشرة", "العاشر"),
        ),
        start=1,
    )
    for word in forms
}


def _unit(value: str | None) -> str | None:
    # Preserve exact snapshot names; only whitespace-only values are unassigned.
    return value if value and value.strip() else None


def _company_sort_key(unit: str | None) -> tuple[int, tuple[int, ...], str, str]:
    """Order ordinal, numbered, named, then unassigned companies."""
    if unit is None:
        return (3, (), "", "")
    name = normalize("NFKC", unit).strip().casefold()
    for match in _COMPANY_WORD.finditer(name):
        if (ordinal := _ARABIC_ORDINAL.get(match[0])) is not None:
            return (0, (ordinal,), name, unit)
    numbers = tuple(int(digits) for digits in _COMPANY_NUMBER.findall(name))
    return (1 if numbers else 2, numbers, name, unit)


def _selected(unit: str | None, duty_unit: str | None) -> bool:
    return (
        duty_unit is None or (unit if unit is not None else COMPANY_STATS_UNASSIGNED) == duty_unit
    )


def _period(start: date, end: date, requested_end: date, days: int) -> dict[str, Any]:
    return {
        "from_date": start,
        "to_date": end,
        "requested_to_date": requested_end,
        "days": days,
        "clamped": end < requested_end,
    }


def _coverage_from(db: Session, scope: WorkforceScope) -> date | None:
    if not scope.entries:
        return None
    query = select(
        AttendanceCase.operational_date,
        AttendanceCase.employee_id,
        AttendanceCase.department_snapshot,
        AttendanceCase.duty_unit_snapshot,
        AttendanceCase.duty_post_snapshot,
    ).order_by(AttendanceCase.operational_date)
    # The date index supplies chronological rows. Stop at the first authorized
    # snapshot; do not load judgments or use the caller's company selection.
    with db.connection().execute(query).tuples() as rows:
        for day, employee_id, department, unit, post in rows:
            if scope_allows(
                scope,
                employee_id=employee_id,
                department=department,
                duty_unit=unit,
                duty_post=post,
            ):
                return day
    return None


@dataclass(slots=True)
class _Discipline:
    absence_days: int = 0
    absence_episodes: int = 0
    single_punch: int = 0
    late_count: int = 0
    late_minutes: int = 0

    def add(self, state: RowState, minutes: int, starts_episode: bool) -> None:
        if state == "absent":
            self.absence_days += 1
            self.absence_episodes += starts_episode
        elif state == "unpaired":
            self.single_punch += 1
        elif state == "late":
            self.late_count += 1
            self.late_minutes += minutes

    def payload(self) -> dict[str, int]:
        return {
            "absence_days": self.absence_days,
            "absence_episodes": self.absence_episodes,
            "single_punch": self.single_punch,
            "late_count": self.late_count,
            "late_minutes": self.late_minutes,
        }


@dataclass(slots=True)
class _LeaveTotals:
    by_kind: dict[str, tuple[int, int]] = field(default_factory=dict)
    permit_count: int = 0
    permit_with_hours: int = 0
    permit_hours: Decimal = Decimal(0)

    def add_leave(self, kind: str, days: int) -> None:
        old_days, old_count = self.by_kind.get(kind, (0, 0))
        self.by_kind[kind] = (old_days + days, old_count + 1)

    def add_permit(self, hours: Decimal | None) -> None:
        self.permit_count += 1
        if hours is not None:
            self.permit_with_hours += 1
            self.permit_hours += hours

    def payload(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for kind in _LEAVE_KINDS:
            days, count = self.by_kind.get(kind, (0, 0))
            result[kind] = {"days": days, "count": count}
        result["exit_permits"] = {
            "count": self.permit_count,
            "hours": float(self.permit_hours) if self.permit_with_hours else None,
            "with_hours": self.permit_with_hours,
        }
        return result


@dataclass(slots=True)
class _Totals:
    people: set[str] = field(default_factory=set)
    absent_run: set[str] = field(default_factory=set)
    scheduled: int = 0
    excused: int = 0
    pending: int = 0
    discipline: _Discipline = field(default_factory=_Discipline)
    leaves: _LeaveTotals = field(default_factory=_LeaveTotals)

    def add_duty(self, employee_id: str, state: RowState, minutes: int) -> bool:
        self.people.add(employee_id)
        self.scheduled += 1
        if state == "verified" or state == "grace":
            self.absent_run.discard(employee_id)
            return False
        starts_episode = False
        if state == "absent":
            starts_episode = employee_id not in self.absent_run
            self.absent_run.add(employee_id)
        else:
            self.absent_run.discard(employee_id)
            if state in ("leave", "national_service"):
                self.excused += 1
            elif state == "pending":
                self.pending += 1
        if state in ("absent", "unpaired", "late"):
            self.discipline.add(state, minutes, starts_episode)
        return starts_episode

    def payload(self) -> dict[str, Any]:
        d = self.discipline
        due = self.scheduled - self.excused
        return {
            "strength": len(self.people),
            "duties_scheduled": self.scheduled,
            "duties_excused": self.excused,
            "duties_due": due,
            "duties_pending": self.pending,
            "absence": {"days": d.absence_days, "episodes": d.absence_episodes},
            "single_punch": d.single_punch,
            "late": {"count": d.late_count, "minutes": d.late_minutes},
            "absence_rate": round(d.absence_days * 100 / due, 1) if due else None,
            "leaves": self.leaves.payload(),
        }


@dataclass(slots=True)
class _Bucket:
    start: date
    end: date
    discipline: _Discipline = field(default_factory=_Discipline)
    sick_days: int = 0
    sick_count: int = 0

    def payload(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "end": self.end,
            **self.discipline.payload(),
            "sick_days": self.sick_days,
            "sick_count": self.sick_count,
        }


def _buckets(start: date, end: date, *, weekly: bool) -> tuple[list[_Bucket], dict[date, int]]:
    buckets: list[_Bucket] = []
    by_day: dict[date, int] = {}
    while start <= end:
        stop = (
            start + timedelta(days=min(6, (end - start).days))
            if weekly
            else min(end, start.replace(day=monthrange(start.year, start.month)[1]))
        )
        for offset in range((stop - start).days + 1):
            by_day[start + timedelta(days=offset)] = len(buckets)
        buckets.append(_Bucket(start, stop))
        start = stop + _DAY
    return buckets, by_day


@dataclass(slots=True)
class _Person:
    unit: str | None = None
    shifts: dict[str, int] = field(default_factory=dict)
    discipline: _Discipline = field(default_factory=_Discipline)
    sick_days: int = 0
    leave_days: int = 0
    leave_count: int = 0

    @property
    def score(self) -> int:
        d = self.discipline
        return d.absence_days * 3 + d.single_punch * 2 + d.late_count


@dataclass(slots=True)
class _Company:
    totals: _Totals = field(default_factory=_Totals)
    shifts: set[str] = field(default_factory=set)


@dataclass(slots=True)
class _Current:
    overall: _Totals = field(default_factory=_Totals)
    filtered: _Totals = field(default_factory=_Totals)
    companies: dict[str | None, _Company] = field(default_factory=dict)
    ranking: dict[str, _Person] = field(default_factory=dict)
    transfers: dict[str, dict[str, Any]] = field(default_factory=dict)


def _current_cases(
    db: Session,
    *,
    scope: WorkforceScope,
    start: date,
    end: date,
    duty_unit: str | None,
    now: datetime,
    series: list[_Bucket],
    bucket_index: dict[date, int],
) -> _Current:
    data = _Current()
    if duty_unit is None:
        data.filtered = data.overall
    prior_case: dict[str, tuple[str | None, bool]] = {}
    for case, judgment, _ in iter_effective_attendance_rows(
        db, scope=scope, from_date=start, to_date=end
    ):
        employee_id = case.employee_id
        unit = _unit(case.duty_unit_snapshot)
        shift = case.shift_code_snapshot
        day = case.operational_date
        state, minutes = judge_register_row(judgment, now=now)

        company = data.companies.get(unit)
        if company is None:
            company = data.companies[unit] = _Company()
        company.totals.add_duty(employee_id, state, minutes)
        if shift:
            company.shifts.add(shift)
        # Overall episodes cross company transfers. Derive other case counts
        # from the disjoint company totals, but de-duplicate strength here.
        prior = prior_case.get(employee_id)
        absent = state == "absent"
        starts_episode = absent and (prior is None or not prior[1])
        if starts_episode:
            data.overall.discipline.absence_episodes += 1
        if prior is None or unit != prior[0] or absent != prior[1]:
            prior_case[employee_id] = unit, absent

        # Work from all authorized snapshots; a filter must not erase a real transfer.
        if prior is not None and unit != prior[0]:
            data.transfers[employee_id] = {"from_unit": prior[0], "to_unit": unit, "on_date": day}

        if not _selected(unit, duty_unit):
            continue
        if duty_unit is not None:
            starts_episode = data.filtered.add_duty(employee_id, state, minutes)
        person = data.ranking.get(employee_id)
        if person is None:
            person = data.ranking[employee_id] = _Person()
        person.unit = unit
        if shift:
            person.shifts[shift] = person.shifts.get(shift, 0) + 1
        if state in ("absent", "unpaired", "late"):
            person.discipline.add(state, minutes, starts_episode)
            # A run spanning buckets counts once, in the bucket where it starts.
            series[bucket_index[day]].discipline.add(state, minutes, starts_episode)
    overall = data.overall
    overall.people.update(prior_case)
    for company in data.companies.values():
        totals = company.totals
        overall.scheduled += totals.scheduled
        overall.excused += totals.excused
        overall.pending += totals.pending
        overall.discipline.absence_days += totals.discipline.absence_days
        overall.discipline.single_punch += totals.discipline.single_punch
        overall.discipline.late_count += totals.discipline.late_count
        overall.discipline.late_minutes += totals.discipline.late_minutes
    return data


def _previous_cases(
    db: Session,
    *,
    scope: WorkforceScope,
    start: date,
    end: date,
    duty_unit: str | None,
    now: datetime,
) -> _Totals:
    totals = _Totals()
    if duty_unit is not None and not duty_unit.strip():
        return totals  # Blank snapshot names are selected only via the sentinel.
    for employee_id, judgment in iter_effective_attendance_totals_rows(
        db,
        scope=scope,
        from_date=start,
        to_date=end,
        duty_unit=duty_unit if duty_unit != COMPANY_STATS_UNASSIGNED else None,
        unassigned_only=duty_unit == COMPANY_STATS_UNASSIGNED,
    ):
        totals.add_duty(employee_id, *judge_register_row(judgment, now=now))
    return totals


@dataclass(slots=True)
class _Assignment:
    day: date
    department: str | None
    unit: str | None
    post: str | None


def _assignment_timelines(
    db: Session, employee_ids: set[str], *, today: date
) -> dict[str, list[_Assignment]]:
    timelines: dict[str, list[_Assignment]] = {}
    end = datetime.combine(today, datetime.max.time(), tzinfo=clock.ORGANIZATION_TIMEZONE)
    last_instant = end.astimezone(UTC).replace(tzinfo=None)
    for ids in batched(employee_ids, 900):
        for employee_id, effective_at, department, unit, post in db.execute(
            select(
                DutyAssignmentEvent.employee_id,
                DutyAssignmentEvent.effective_at,
                DutyAssignmentEvent.to_department,
                DutyAssignmentEvent.to_unit,
                DutyAssignmentEvent.to_post,
            )
            .where(
                DutyAssignmentEvent.employee_id.in_(ids),
                DutyAssignmentEvent.effective_at <= last_instant,
            )
            .order_by(
                DutyAssignmentEvent.employee_id,
                DutyAssignmentEvent.effective_at,
                DutyAssignmentEvent.id,
            )
        ):
            day = effective_at.replace(tzinfo=UTC).astimezone(clock.ORGANIZATION_TIMEZONE).date()
            events = timelines.setdefault(employee_id, [])
            assignment = _Assignment(day, department, unit, post)
            if events and events[-1].day == day:
                events[-1] = assignment  # Last change of the Dubai day governs that day.
            else:
                events.append(assignment)
    return timelines


def _visible_spans(
    employee: Employee, events: list[_Assignment], scope: WorkforceScope, start: date, end: date
) -> Iterator[tuple[str | None, date, date]]:
    """Clip by hierarchy, treating a transfer's Dubai day as an inclusive boundary."""
    index = bisect_right(events, start, key=lambda event: event.day)
    while start <= end:
        assignment = events[index - 1] if index else None
        stop = min(end, events[index].day - _DAY) if index < len(events) else end
        duty_unit = assignment.unit if assignment is not None else employee.duty_unit
        if scope_allows(
            scope,
            employee_id=employee.id,
            department=assignment.department if assignment is not None else employee.department,
            duty_unit=duty_unit,
            duty_post=assignment.post if assignment is not None else employee.duty_post,
        ):
            yield _unit(duty_unit), start, stop
        if stop == end:
            break
        start = stop + _DAY
        index += 1


def _parse_hours(value: object) -> Decimal | None:
    if isinstance(value, str):
        text = value.strip().replace("\N{ARABIC DECIMAL SEPARATOR}", ".")
        if not _HOURS.fullmatch(text):
            return None
        parsed = Decimal(text)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        parsed = Decimal(str(value))
    else:
        return None
    return parsed if math.isfinite(float(parsed)) else None


def _permit_hours(db: Session, leave_ids: list[int]) -> dict[int, Decimal | None]:
    """Batch the live owning Record lookup: newest Document on a current revision."""
    hours: dict[int, Decimal | None] = {}
    later = aliased(BookVersion)
    for ids in batched(leave_ids, 900):
        rows = db.execute(
            select(Document.leave_id, BookVersion.fields)
            .select_from(Document)
            .join(BookVersion, BookVersion.document_id == Document.id)
            .join(Book, Book.id == BookVersion.book_id)
            .where(
                Document.leave_id.in_(ids),
                Book.deleted_at.is_(None),
                Book.voided_at.is_(None),
                ~exists().where(
                    later.book_id == BookVersion.book_id, later.version_no > BookVersion.version_no
                ),
            )
            .order_by(Document.id.desc())
        )
        for leave_id, fields in rows:
            if leave_id is not None and leave_id not in hours:
                hours[leave_id] = _parse_hours((fields or {}).get("duration_hours"))
    return hours


def _summarize_leave(
    current: _Current,
    previous: _Totals,
    *,
    employee: Employee,
    kind: str,
    spans: Iterator[tuple[str | None, date, date]],
    from_date: date,
    duty_unit: str | None,
    series: list[_Bucket],
    bucket_index: dict[date, int],
) -> None:
    all_days = filtered_days = previous_days = 0
    company_days: dict[str | None, int] = {}
    sick_buckets: set[int] = set()
    for unit, start, end in spans:
        selected = _selected(unit, duty_unit)
        if selected and start < from_date:
            previous_days += (min(end, from_date - _DAY) - start).days + 1
        start = max(start, from_date)
        if start > end:
            continue
        days = (end - start).days + 1
        all_days += days
        company_days[unit] = company_days.get(unit, 0) + days
        if selected:
            filtered_days += days
            if kind == "sick":
                while start <= end:
                    index = bucket_index[start]
                    stop = min(series[index].end, end)
                    series[index].sick_days += (stop - start).days + 1
                    sick_buckets.add(index)
                    start = stop + _DAY

    if previous_days:
        previous.leaves.add_leave(kind, previous_days)
    if all_days:
        current.overall.leaves.add_leave(kind, all_days)
    for unit, days in company_days.items():
        if (company := current.companies.get(unit)) is not None:
            company.totals.leaves.add_leave(kind, days)
    if filtered_days:
        if current.filtered is not current.overall:
            current.filtered.leaves.add_leave(kind, filtered_days)
        if (person := current.ranking.get(employee.id)) is not None:
            person.leave_days += filtered_days
            person.leave_count += 1
            if kind == "sick":
                person.sick_days += filtered_days
    for index in sick_buckets:
        series[index].sick_count += 1


def _leaves_and_enrolment(
    db: Session,
    *,
    scope: WorkforceScope,
    today: date,
    previous_start: date,
    start: date,
    end: date,
    duty_unit: str | None,
    current: _Current,
    previous: _Totals,
    series: list[_Bucket],
    bucket_index: dict[date, int],
) -> list[dict[str, Any]]:
    leaves = db.execute(
        select(Leave, Employee)
        .join(Employee, Employee.id == Leave.employee_id)
        .where(
            Leave.deleted_at.is_(None),
            or_(
                and_(Leave.start_date <= end, Leave.end_date >= previous_start),
                and_(Leave.start_date <= today, Leave.end_date >= today),
            ),
        )
        .order_by(Leave.start_date.desc(), Leave.id.desc())
    ).all()
    timelines = _assignment_timelines(db, {person.id for _, person in leaves}, today=today)
    permits: list[tuple[int, str | None, bool]] = []
    enrolled: dict[str, dict[str, Any]] = {}
    for leave, person in leaves:
        label = leave_lifecycle.english_part(leave.leave_type).lower()
        events = timelines.get(person.id, [])
        if label == "leave permit":
            if (
                previous_start <= leave.start_date <= end
                and leave_lifecycle.canonical_status(leave.status) == "Approved"
            ):
                for unit, _, _ in _visible_spans(
                    person, events, scope, leave.start_date, leave.start_date
                ):
                    is_current = leave.start_date >= start
                    if is_current or _selected(unit, duty_unit):
                        permits.append((leave.id, unit, is_current))
            continue

        kind = leave_lifecycle.excusing_kind(leave.leave_type, leave.status, deleted=False)
        if kind is None:
            continue
        if (
            kind == "national_service"
            and leave.start_date <= today <= leave.end_date
            and leave_lifecycle.canonical_status(leave.status) == "Pending"
            and person.id not in enrolled
        ):
            for unit, _, _ in _visible_spans(person, events, scope, today, today):
                if _selected(unit, duty_unit):
                    duration = (leave.end_date - leave.start_date).days + 1
                    enrolled[person.id] = {
                        "employee_id": person.id,
                        "name_en": person.name_en,
                        "name_ar": person.name_ar,
                        "duty_unit": unit,
                        "start_date": leave.start_date,
                        "end_date": leave.end_date,
                        "return_date": leave.end_date + _DAY,
                        "days_remaining": (leave.end_date - today).days + 1,
                        "progress": (today - leave.start_date).days / duration,
                    }
        spans = _visible_spans(
            person, events, scope, max(previous_start, leave.start_date), min(end, leave.end_date)
        )
        _summarize_leave(
            current,
            previous,
            employee=person,
            kind="administrative" if label == "administrative leave" else kind,
            spans=spans,
            from_date=start,
            duty_unit=duty_unit,
            series=series,
            bucket_index=bucket_index,
        )

    hours_by_id = _permit_hours(db, [leave_id for leave_id, _, _ in permits])
    for leave_id, unit, is_current in permits:
        hours = hours_by_id.get(leave_id)
        if is_current:
            current.overall.leaves.add_permit(hours)
            if (company := current.companies.get(unit)) is not None:
                company.totals.leaves.add_permit(hours)
            if current.filtered is not current.overall and _selected(unit, duty_unit):
                current.filtered.leaves.add_permit(hours)
        else:
            previous.leaves.add_permit(hours)
    return sorted(enrolled.values(), key=lambda row: (row["return_date"], row["employee_id"]))


def _ratios(current: _Current) -> list[dict[str, Any]]:
    strength = sum(len(company.totals.people) for company in current.companies.values())
    overall = current.overall.discipline
    baselines = (overall.absence_days, overall.single_punch, overall.late_count)
    rows = []
    for unit in sorted(current.companies, key=_company_sort_key):
        company = current.companies[unit]
        people = len(company.totals.people)
        d = company.totals.discipline
        small_sample = company.totals.scheduled - company.totals.excused < _MIN_DUE_DUTIES
        ratio: dict[str, float | None] = {}
        status: dict[str, StatsStatus | None] = {}
        worst = -1
        for key, value, baseline in zip(
            _METRICS, (d.absence_days, d.single_punch, d.late_count), baselines, strict=True
        ):
            if not baseline:
                ratio[key] = status[key] = None
                continue
            r = ratio[key] = value * strength / (people * baseline)
            if small_sample:
                status[key] = None
                continue
            level = 0 if r < 0.85 else 1 if r < 1.15 else 2 if r < 1.4 else 3
            status[key] = _STATUSES[level]
            worst = max(worst, level)
        status["overall"] = _STATUSES[worst] if worst >= 0 else None
        rows.append(
            {
                "key": unit if unit is not None else COMPANY_STATS_UNASSIGNED,
                "duty_unit": unit,
                "shift_codes": sorted(company.shifts),
                "totals": company.totals.payload(),
                "ratio": ratio,
                "small_sample": small_sample,
                "status": status,
            }
        )
    return rows


def _ranking(db: Session, current: _Current, limit: int | None) -> dict[str, Any]:
    employees: dict[str, Employee] = {}
    for ids in batched(current.ranking, 900):
        employees.update(
            {
                person.id: person
                for person in db.scalars(select(Employee).where(Employee.id.in_(ids)))
            }
        )
    rows: list[dict[str, Any]] = []
    for employee_id, stats in current.ranking.items():
        person = employees.get(employee_id)
        d = stats.discipline
        events = d.absence_days + d.single_punch + d.late_count
        rows.append(
            {
                "employee_id": employee_id,
                "name_en": person.name_en if person else "",
                "name_ar": person.name_ar if person else None,
                "position": person.position if person else None,
                "position_ar": person.position_ar if person else None,
                "duty_unit": stats.unit,
                "shift_code": min(
                    stats.shifts, key=lambda code: (-stats.shifts[code], code), default=None
                ),
                **stats.discipline.payload(),
                "sick_days": stats.sick_days,
                "leave_days": stats.leave_days,
                "leave_count": stats.leave_count,
                "score": stats.score,
                "events": events,
                "small_sample": events < _MIN_EMPLOYEE_EVENTS,
                "tier": None,
                "transfer": current.transfers.get(employee_id),
            }
        )
    size = len(rows)
    average = sum(row["score"] for row in rows) / size if size else 0.0
    order: dict[str, list[str]] = {"score": [], "absence": [], "late": [], "single_punch": []}
    union: dict[str, dict[str, Any]] = {}
    sorts = (
        ("score", "score"),
        ("absence", "absence_days"),
        ("late", "late_count"),
        ("single_punch", "single_punch"),
    )
    for sort, key in sorts if limit is not None else sorts[:1]:

        def rank_key(row: dict[str, Any], metric: str = key) -> tuple[int, str, str]:
            return -row[metric], row["name_en"].casefold(), row["employee_id"]

        top = sorted(rows, key=rank_key)
        if limit is not None:
            top = top[:limit]
        order[sort] = [row["employee_id"] for row in top]
        for row in top:
            union.setdefault(row["employee_id"], row)
    for row in union.values():
        if average and not row["small_sample"]:
            if row["score"] >= 2 * average:
                row["tier"] = "needs_intervention"
            elif row["score"] >= 1.3 * average:
                row["tier"] = "above_average"
    return {"total": size, "average_score": average, "rows": list(union.values()), "order": order}


def company_attendance_stats(
    db: Session,
    *,
    scope: WorkforceScope,
    from_date: date,
    to_date: date,
    duty_unit: str | None,
    limit: int | None,
    now: datetime,
) -> dict[str, Any]:
    """Build the report. A null limit returns the full score ranking for Excel only."""
    today = clock.organization_today()
    closed_through = today - _DAY
    end = min(to_date, closed_through)
    days = (end - from_date).days + 1
    if days <= 0:
        raise ValidationFailedError(
            "ATTENDANCE_RANGE_INVALID", "The period contains no closed day."
        )
    if days > _MAX_DAYS:
        raise ValidationFailedError(
            "ATTENDANCE_RANGE_TOO_WIDE", f"The period may not exceed {_MAX_DAYS} days."
        )
    if from_date.toordinal() <= days:
        raise ValidationFailedError(
            "ATTENDANCE_RANGE_INVALID", "The comparison period is outside the supported calendar."
        )
    previous_end = from_date - _DAY
    previous_start = from_date - timedelta(days=days)
    coverage_from = _coverage_from(db, scope)
    granularity: Literal["week", "month"] = "week" if days <= 31 else "month"
    series, bucket_index = _buckets(from_date, end, weekly=granularity == "week")
    instant = parse_instant(now)
    assert instant is not None
    current = _current_cases(
        db,
        scope=scope,
        start=max(from_date, coverage_from or today),
        end=end,
        duty_unit=duty_unit,
        now=instant,
        series=series,
        bucket_index=bucket_index,
    )
    previous = (
        _previous_cases(
            db,
            scope=scope,
            start=max(previous_start, coverage_from),
            end=previous_end,
            duty_unit=duty_unit,
            now=instant,
        )
        if coverage_from is not None and coverage_from <= previous_end
        else _Totals()
    )
    enrolled = _leaves_and_enrolment(
        db,
        scope=scope,
        today=today,
        previous_start=previous_start,
        start=from_date,
        end=end,
        duty_unit=duty_unit,
        current=current,
        previous=previous,
        series=series,
        bucket_index=bucket_index,
    )
    overall = current.overall.payload()
    selected = current.filtered.payload() if duty_unit is not None else overall
    return {
        "period": _period(from_date, end, to_date, days),
        "previous_period": _period(previous_start, previous_end, previous_end, days),
        "closed_through": closed_through,
        "coverage_from": coverage_from,
        "previous_comparable": coverage_from is not None and previous_start >= coverage_from,
        "duty_unit": duty_unit,
        "granularity": granularity,
        "summary": {"current": selected, "previous": previous.payload()},
        "companies": _ratios(current),
        "overall": overall,
        "series": [bucket.payload() for bucket in series],
        "ranking": _ranking(db, current, limit),
        "national_service": {
            "enrolled": enrolled,
            "absence_days": selected["leaves"]["national_service"]["days"],
        },
    }
