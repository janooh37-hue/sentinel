"""Idempotent installation of this site's shift plan, rotation, and crews.

The workforce domain is deliberately data-driven: nothing about shift times or
crew count is compiled in. This module installs the configuration the site
operates today, so an administrator does not have to hand-enter it, and so the
values live in one reviewable place rather than in a migration and a fixture and
a test.

Everything here is derived from facts confirmed by the site owner:

* Three eight-hour shifts starting **05:00, 13:00 and 21:00** local. These are
  one hour later than the boundaries the original design assumed, because the
  night shift ends at 05:00.
* Five guard crews on a five-day cycle. A crew works **Noon on day one, then
  both Morning and Night on day two, then rests three days.** Two crews are on
  duty each day and three are off, which is exactly enough to cover three
  shifts with five crews.
* Office staff (``الدوام الرسمي``) are not in the rotation: Monday to Thursday
  07:00-15:00, Saturday and Sunday off. Friday is deliberately absent here:
  it alternates between two groups and is owned by the separate Friday roster
  service. Seeding a Friday step now would mark the off group absent weekly.

Crews are keyed to the duty-unit vocabulary in ``app/core/duty.py`` so that
``Employee.duty_unit`` — which already records each person's unit — is the only
membership input. Nothing is re-entered.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.workforce_models import (
    AttendanceCase,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkRotationStep,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.services import workforce_schedule_service
from app.services.workforce_access_service import require_organization
from app.services.workforce_etag import etag_for
from app.services.workforce_scope_service import WorkforceScope

_ORGANIZATION_SCHEDULE_MESSAGE = (
    "Organization workforce scope is required for crew and anchor changes."
)

SITE_TIMEZONE = "Asia/Dubai"
_ZONE = ZoneInfo(SITE_TIMEZONE)

SHIFT_MORNING = "morning"
SHIFT_NOON = "noon"
SHIFT_NIGHT = "night"
SHIFT_OFFICE = "office_day"

PATTERN_GUARD = "guard_5crew"
PATTERN_OFFICE = "office_week"

OFFICE_CREW_CODE = "office"

_DAY_MINUTES = 24 * 60


@dataclass(frozen=True, slots=True)
class _ShiftSpec:
    code: str
    start: time
    duration_minutes: int


_SHIFTS: tuple[_ShiftSpec, ...] = (
    _ShiftSpec(SHIFT_MORNING, time(5, 0), 480),
    _ShiftSpec(SHIFT_NOON, time(13, 0), 480),
    _ShiftSpec(SHIFT_NIGHT, time(21, 0), 480),
    _ShiftSpec(SHIFT_OFFICE, time(7, 0), 480),
)

# Offsets are measured from the crew's own cycle start, which is its Noon shift.
# Noon runs 13:00-21:00; the next morning at 05:00 is 16 hours later, and that
# same day's night at 21:00 is 32 hours later. The cycle then runs to 7200
# minutes (five days), leaving three full days with no step: the rest period.
_GUARD_STEPS: tuple[tuple[str, int], ...] = (
    (SHIFT_NOON, 0),
    (SHIFT_MORNING, 16 * 60),
    (SHIFT_NIGHT, 32 * 60),
)
_GUARD_CYCLE_MINUTES = 5 * _DAY_MINUTES

# Monday through Thursday from a Monday 07:00 anchor. Friday is owned elsewhere.
_OFFICE_STEPS: tuple[tuple[str, int], ...] = (
    (SHIFT_OFFICE, 0),
    (SHIFT_OFFICE, 1 * _DAY_MINUTES),
    (SHIFT_OFFICE, 2 * _DAY_MINUTES),
    (SHIFT_OFFICE, 3 * _DAY_MINUTES),
)
_OFFICE_CYCLE_MINUTES = 7 * _DAY_MINUTES


@dataclass(frozen=True, slots=True)
class _CrewSpec:
    code: str
    name_en: str
    name_ar: str
    pattern: str
    #: Local date whose offset-zero shift starts this crew's cycle.
    anchor_date: date


# Noon rotates 1 → 2 → 3 → 4 → 5 by day, and the crew that worked noon
# yesterday works today's morning and night. Anchoring crew 2 to 18 Aug 2026
# reproduces the roster the site confirmed for that day: noon 2, morning 1,
# night 1, with crews 3, 4 and 5 resting.
_CREWS: tuple[_CrewSpec, ...] = (
    _CrewSpec("crew_1", "First Company", "السرية الأولى", PATTERN_GUARD, date(2026, 8, 17)),
    _CrewSpec("crew_2", "Second Company", "السرية الثانية", PATTERN_GUARD, date(2026, 8, 18)),
    _CrewSpec("crew_3", "Third Company", "السرية الثالثة", PATTERN_GUARD, date(2026, 8, 19)),
    _CrewSpec("crew_4", "Fourth Company", "السرية الرابعة", PATTERN_GUARD, date(2026, 8, 20)),
    _CrewSpec("crew_5", "Fifth Company", "السرية الخامسة", PATTERN_GUARD, date(2026, 8, 21)),
    # 17 Aug 2026 is a Monday, which is where the office week begins.
    _CrewSpec(
        OFFICE_CREW_CODE, "Official Hours", "الدوام الرسمي", PATTERN_OFFICE, date(2026, 8, 17)
    ),
)

#: ``Employee.duty_unit`` value -> crew code. The duty unit is already recorded
#: per employee, so this is the whole of the membership input.
DUTY_UNIT_TO_CREW: dict[str, str] = {crew.name_ar: crew.code for crew in _CREWS}

#: The site's rule: an arrival past the grace is late, and a start with no punch
#: at all is an absence once twice the grace has gone by. Absence is provisional
#: - a punch arriving later re-evaluates the case into a late arrival - so the
#: boundary can sit an hour into the duty without condemning anyone permanently.
_GRACE_MINUTES = 30
_POLICY = {
    "grace_minutes": _GRACE_MINUTES,
    "absence_after_minutes": _GRACE_MINUTES * 2,
    "early_exit_grace_minutes": 30,
    "match_before_minutes": 60,
    "match_after_minutes": 120,
    "require_checkout": True,
}


def _local_start(day: date, at: time) -> datetime:
    """Return the UTC-naive instant of a local wall time on a local date."""
    return datetime.combine(day, at, tzinfo=_ZONE).astimezone(UTC).replace(tzinfo=None)


def _ensure_shifts(db: Session) -> tuple[dict[str, WorkShiftDefinition], int]:
    """Install the site's shift windows, correcting any that disagree.

    Migration 0071 seeds 04:00/12:00/20:00, which was the design's assumption
    before the site confirmed that the night shift ends at 05:00 and every
    window is an hour later. Skipping a code that already exists would silently
    keep the wrong hours and generate the entire roster against them, so a
    mismatch is corrected here and reported to the caller: anchors and
    occurrences derived from the old times have to be rebuilt.
    """
    existing = {row.code: row for row in db.scalars(select(WorkShiftDefinition))}
    corrected = 0
    for spec in _SHIFTS:
        row = existing.get(spec.code)
        if row is None:
            row = WorkShiftDefinition(
                code=spec.code,
                start_local_time=spec.start,
                duration_minutes=spec.duration_minutes,
            )
            db.add(row)
            existing[spec.code] = row
            continue
        if row.start_local_time != spec.start or row.duration_minutes != spec.duration_minutes:
            row.start_local_time = spec.start
            row.duration_minutes = spec.duration_minutes
            corrected += 1
    db.flush()
    return existing, corrected


def _ensure_pattern(
    db: Session,
    *,
    code: str,
    name: str,
    cycle_minutes: int,
    steps: tuple[tuple[str, int], ...],
    shifts: dict[str, WorkShiftDefinition],
) -> WorkRotationPattern:
    pattern = db.scalar(select(WorkRotationPattern).where(WorkRotationPattern.code == code))
    if pattern is None:
        pattern = WorkRotationPattern(
            code=code, name=name, cycle_minutes=cycle_minutes, timezone=SITE_TIMEZONE
        )
        db.add(pattern)
        db.flush()

    present = {
        row.start_offset_minutes
        for row in db.scalars(
            select(WorkRotationStep).where(WorkRotationStep.pattern_id == pattern.id)
        )
    }
    for shift_code, offset in steps:
        if offset in present:
            continue
        db.add(
            WorkRotationStep(
                pattern_id=pattern.id,
                shift_definition_id=shifts[shift_code].id,
                start_offset_minutes=offset,
            )
        )
    db.flush()
    return pattern


def _ensure_crews(db: Session) -> dict[str, WorkCrew]:
    existing = {row.code: row for row in db.scalars(select(WorkCrew))}
    for spec in _CREWS:
        if spec.code in existing:
            continue
        row = WorkCrew(code=spec.code, name_en=spec.name_en, name_ar=spec.name_ar)
        db.add(row)
        existing[spec.code] = row
    db.flush()
    return existing


def _ensure_schedules(
    db: Session,
    *,
    crews: dict[str, WorkCrew],
    patterns: dict[str, WorkRotationPattern],
    shifts: dict[str, WorkShiftDefinition],
    actor_user_id: int,
    scope: WorkforceScope,
) -> int:
    created = 0
    for spec in _CREWS:
        crew = crews[spec.code]
        if db.scalar(select(WorkCrewSchedule).where(WorkCrewSchedule.crew_id == crew.id)):
            continue
        pattern = patterns[spec.pattern]
        offset_zero = next(code for code, offset in _steps_for(spec.pattern) if offset == 0)
        anchor = _local_start(spec.anchor_date, shifts[offset_zero].start_local_time)
        workforce_schedule_service.create_crew_schedule(
            db,
            scope=scope,
            if_match=etag_for([]),
            crew_id=crew.id,
            pattern_id=pattern.id,
            anchor_at=anchor,
            # The schedule becomes effective exactly when its first shift
            # starts, so no occurrence is ever generated before the roster the
            # site actually ran.
            effective_from=anchor,
            actor_user_id=actor_user_id,
        )
        created += 1
    return created


def _steps_for(pattern_code: str) -> tuple[tuple[str, int], ...]:
    return _GUARD_STEPS if pattern_code == PATTERN_GUARD else _OFFICE_STEPS


def _ensure_policy(db: Session, *, actor_user_id: int, effective_from: date) -> bool:
    """Install the organization-default attendance policy when none exists."""
    existing = db.scalar(
        select(WorkAttendancePolicy).where(WorkAttendancePolicy.shift_definition_id.is_(None))
    )
    if existing is not None:
        return False
    now = datetime.now(UTC).replace(tzinfo=None)
    db.add(
        WorkAttendancePolicy(
            shift_definition_id=None,
            effective_from=effective_from,
            created_by_user_id=actor_user_id,
            # Seeded policy is approved on installation: an unapproved policy
            # would leave the evaluator with no values at all, which reads as
            # "unknown" for every employee rather than as a safe default.
            approved_by_user_id=actor_user_id,
            approved_at=now,
            **_POLICY,
        )
    )
    db.flush()
    return True


@dataclass(frozen=True, slots=True)
class SeedResult:
    """What installation actually changed, so a re-run is visibly a no-op."""

    shifts: int
    patterns: int
    crews: int
    schedules: int
    policy_created: bool


def seed_workforce_roster(
    db: Session,
    *,
    scope: WorkforceScope,
    actor_user_id: int,
    effective_from: date | None = None,
) -> SeedResult:
    """Install shifts, rotation patterns, crews, anchors, and the default policy.

    Safe to run repeatedly: every step is keyed on a natural identifier and
    skipped when already present. The caller owns the transaction.
    """
    require_organization(scope, message=_ORGANIZATION_SCHEDULE_MESSAGE)
    before_shifts = db.scalar(select(WorkShiftDefinition).limit(1)) is not None
    shifts, corrected = _ensure_shifts(db)
    if corrected:
        # Anchors and materialized occurrences were derived from the old windows
        # and now describe shifts that no longer exist, so they must be rebuilt.
        # Occurrences that already carry an attendance case are evaluated facts,
        # and this domain never rewrites those: refuse instead, and let an
        # operator retire the old schedule deliberately.
        judged = db.scalar(
            select(AttendanceCase.id)
            .join(
                WorkShiftOccurrence,
                WorkShiftOccurrence.id == AttendanceCase.shift_occurrence_id,
            )
            .limit(1)
        )
        if judged is not None:
            raise ValueError(
                "shift windows changed but evaluated attendance already exists; "
                "retire the affected schedules before reseeding"
            )
        db.query(WorkShiftOccurrence).delete()
        db.query(WorkCrewSchedule).delete()
        db.flush()

    patterns = {
        PATTERN_GUARD: _ensure_pattern(
            db,
            code=PATTERN_GUARD,
            name="Five-crew guard rotation",
            cycle_minutes=_GUARD_CYCLE_MINUTES,
            steps=_GUARD_STEPS,
            shifts=shifts,
        ),
        PATTERN_OFFICE: _ensure_pattern(
            db,
            code=PATTERN_OFFICE,
            name="Office week",
            cycle_minutes=_OFFICE_CYCLE_MINUTES,
            steps=_OFFICE_STEPS,
            shifts=shifts,
        ),
    }
    crews = _ensure_crews(db)
    schedules = _ensure_schedules(
        db,
        crews=crews,
        patterns=patterns,
        shifts=shifts,
        actor_user_id=actor_user_id,
        scope=scope,
    )
    policy_created = _ensure_policy(
        db,
        actor_user_id=actor_user_id,
        effective_from=effective_from or min(spec.anchor_date for spec in _CREWS),
    )
    return SeedResult(
        shifts=corrected if before_shifts else len(_SHIFTS),
        patterns=len(patterns),
        crews=len(crews),
        schedules=schedules,
        policy_created=policy_created,
    )


__all__ = [
    "DUTY_UNIT_TO_CREW",
    "OFFICE_CREW_CODE",
    "PATTERN_GUARD",
    "PATTERN_OFFICE",
    "SITE_TIMEZONE",
    "SeedResult",
    "seed_workforce_roster",
]
