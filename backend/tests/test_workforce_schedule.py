"""RED contracts for the canonical Workforce crew schedule.

These tests deliberately exercise the service through SQLite-backed workforce rows.  The
canonical rotation is timestamp arithmetic: a Monday 12:00 Asia/Dubai Noon anchor,
not a weekday rule and not a Monday 04:00 anchor.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from itertools import pairwise
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.db.models import Employee
from app.db.workforce_models import (
    WorkCrew,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkRotationStep,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.services.workforce_schedule_service import (
    create_crew_membership,
    create_crew_schedule,
    generate_occurrences,
    replace_crew_schedule,
    resolve_assignment,
)

DUBAI = ZoneInfo("Asia/Dubai")
# 2026-08-17 is a Monday.  The anchor is Noon in Dubai, persisted as 08:00 UTC.
ANCHOR_LOCAL = datetime(2026, 8, 17, 12, tzinfo=DUBAI)
ANCHOR_UTC = ANCHOR_LOCAL.astimezone(UTC)
CYCLE = timedelta(hours=120)
SHIFT_DURATION = timedelta(hours=8)


def _utc(value: datetime) -> datetime:
    """Normalize SQLite's timezone-less datetime round trip for instant assertions."""

    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _employee(db, employee_id: str) -> Employee:
    employee = Employee(
        id=employee_id,
        name_en=f"Employee {employee_id}",
        name_ar="موظف",
        status="Active",
    )
    db.add(employee)
    db.flush()
    return employee


def _canonical_crew(
    db, *, code: str = "alpha"
) -> tuple[WorkCrew, WorkRotationPattern, dict[str, int]]:
    morning = WorkShiftDefinition(
        code="morning",
        start_local_time=time(4),
        duration_minutes=480,
    )
    noon = WorkShiftDefinition(
        code="noon",
        start_local_time=time(12),
        duration_minutes=480,
    )
    night = WorkShiftDefinition(
        code="night",
        start_local_time=time(20),
        duration_minutes=480,
    )
    pattern = WorkRotationPattern(
        code=f"{code}-120h",
        name="Canonical 120-hour rotation",
        cycle_minutes=7_200,
        timezone="Asia/Dubai",
    )
    crew = WorkCrew(code=code, name_en=f"Crew {code}", name_ar=f"فريق {code}", active=True)
    db.add_all([morning, noon, night, pattern, crew])
    db.flush()
    db.add_all(
        [
            WorkRotationStep(
                pattern_id=pattern.id,
                shift_definition_id=noon.id,
                start_offset_minutes=0,
            ),
            WorkRotationStep(
                pattern_id=pattern.id,
                shift_definition_id=morning.id,
                start_offset_minutes=960,
            ),
            WorkRotationStep(
                pattern_id=pattern.id,
                shift_definition_id=night.id,
                start_offset_minutes=1_920,
            ),
        ]
    )
    db.commit()
    return crew, pattern, {"morning": morning.id, "noon": noon.id, "night": night.id}


def _schedule_canonical_crew(
    db, *, code: str = "alpha"
) -> tuple[WorkCrew, WorkCrewSchedule, dict[str, int]]:
    crew, pattern, shift_ids = _canonical_crew(db, code=code)
    schedule = create_crew_schedule(
        db,
        crew_id=crew.id,
        pattern_id=pattern.id,
        anchor_at=ANCHOR_UTC,
        effective_from=ANCHOR_UTC,
    )
    db.commit()
    return crew, schedule, shift_ids


def _occurrences(
    db, *, crew_id: int, starts_at: datetime, ends_at: datetime
) -> list[WorkShiftOccurrence]:
    return list(
        db.scalars(
            select(WorkShiftOccurrence)
            .where(
                WorkShiftOccurrence.crew_id == crew_id,
                WorkShiftOccurrence.starts_at >= starts_at,
                WorkShiftOccurrence.starts_at < ends_at,
            )
            .order_by(WorkShiftOccurrence.starts_at)
        )
    )


def _active_occurrences(db, *, crew_id: int, at: datetime) -> list[WorkShiftOccurrence]:
    return list(
        db.scalars(
            select(WorkShiftOccurrence).where(
                WorkShiftOccurrence.crew_id == crew_id,
                WorkShiftOccurrence.starts_at <= at,
                WorkShiftOccurrence.ends_at > at,
            )
        )
    )


def test_canonical_monday_noon_rotation_materializes_exact_half_open_boundaries(db_session):
    crew, _schedule, shift_ids = _schedule_canonical_crew(db_session)

    generate_occurrences(
        db_session,
        crew_id=crew.id,
        starts_at=ANCHOR_UTC,
        ends_at=ANCHOR_UTC + CYCLE + SHIFT_DURATION,
    )

    occurrences = _occurrences(
        db_session,
        crew_id=crew.id,
        starts_at=ANCHOR_UTC,
        ends_at=ANCHOR_UTC + CYCLE + SHIFT_DURATION,
    )
    expected = [
        ("noon", ANCHOR_UTC, ANCHOR_UTC + timedelta(hours=8)),
        ("morning", ANCHOR_UTC + timedelta(hours=16), ANCHOR_UTC + timedelta(hours=24)),
        ("night", ANCHOR_UTC + timedelta(hours=32), ANCHOR_UTC + timedelta(hours=40)),
        ("noon", ANCHOR_UTC + CYCLE, ANCHOR_UTC + CYCLE + timedelta(hours=8)),
    ]

    assert [
        (
            next(
                code
                for code, shift_id in shift_ids.items()
                if shift_id == occurrence.shift_definition_id
            ),
            _utc(occurrence.starts_at),
            _utc(occurrence.ends_at),
        )
        for occurrence in occurrences
    ] == expected
    assert [occurrence.operational_date for occurrence in occurrences] == [
        date(2026, 8, 17),
        date(2026, 8, 18),
        date(2026, 8, 18),
        date(2026, 8, 22),
    ]

    # Shift starts are inclusive and endings exclusive: a generated work boundary
    # can never double-assign this crew.
    for _code, starts_at, _ends_at in expected:
        active = _active_occurrences(db_session, crew_id=crew.id, at=starts_at)
        assert len(active) == 1
        assert _utc(active[0].starts_at) == starts_at
    for earlier, later in pairwise(occurrences):
        assert _utc(earlier.ends_at) <= _utc(later.starts_at)


def test_canonical_rotation_has_no_drift_across_repeated_120_hour_cycles(db_session):
    crew, _schedule, shift_ids = _schedule_canonical_crew(db_session)
    horizon = ANCHOR_UTC + CYCLE * 9

    generate_occurrences(
        db_session,
        crew_id=crew.id,
        starts_at=ANCHOR_UTC,
        ends_at=horizon,
    )

    expected = [
        (shift_ids[shift_code], ANCHOR_UTC + cycle * CYCLE + offset)
        for cycle in range(9)
        for shift_code, offset in (
            ("noon", timedelta()),
            ("morning", timedelta(hours=16)),
            ("night", timedelta(hours=32)),
        )
    ]
    occurrences = _occurrences(
        db_session,
        crew_id=crew.id,
        starts_at=ANCHOR_UTC,
        ends_at=horizon,
    )

    assert [
        (occurrence.shift_definition_id, _utc(occurrence.starts_at)) for occurrence in occurrences
    ] == expected
    assert all(
        _utc(occurrence.ends_at) - _utc(occurrence.starts_at) == SHIFT_DURATION
        for occurrence in occurrences
    )


def test_night_assignment_uses_its_dubai_start_date_and_unassigned_employee_is_unknown(db_session):
    crew, _schedule, _shift_ids = _schedule_canonical_crew(db_session)
    scheduled = _employee(db_session, "G-SCHEDULED")
    unassigned = _employee(db_session, "G-UNASSIGNED")
    create_crew_membership(
        db_session,
        employee_id=scheduled.id,
        crew_id=crew.id,
        effective_from=ANCHOR_UTC,
    )
    db_session.commit()

    generate_occurrences(
        db_session,
        crew_id=crew.id,
        starts_at=ANCHOR_UTC,
        ends_at=ANCHOR_UTC + timedelta(hours=40),
    )
    night_start = ANCHOR_UTC + timedelta(hours=32)

    assignment = resolve_assignment(db_session, employee_id=scheduled.id, at=night_start)
    assert assignment.presence == "scheduled"
    assert assignment.occurrence.operational_date == date(2026, 8, 18)
    assert _utc(assignment.occurrence.starts_at).astimezone(DUBAI) == datetime(
        2026, 8, 18, 20, tzinfo=DUBAI
    )
    assert _utc(assignment.occurrence.ends_at).astimezone(DUBAI) == datetime(
        2026, 8, 19, 4, tzinfo=DUBAI
    )

    no_membership = resolve_assignment(db_session, employee_id=unassigned.id, at=night_start)
    assert no_membership.presence == "unknown"
    assert no_membership.reason_code == "NO_CREW_MEMBERSHIP"
    assert no_membership.occurrence is None


def test_replacing_future_anchor_preserves_occurrences_generated_by_prior_schedule(db_session):
    crew, first_schedule, _shift_ids = _schedule_canonical_crew(db_session)
    past_end = ANCHOR_UTC + timedelta(hours=40)
    generate_occurrences(
        db_session,
        crew_id=crew.id,
        starts_at=ANCHOR_UTC,
        ends_at=past_end,
    )
    original = db_session.scalar(
        select(WorkShiftOccurrence).where(
            WorkShiftOccurrence.crew_id == crew.id,
            WorkShiftOccurrence.starts_at == ANCHOR_UTC,
        )
    )
    assert original is not None
    historical_snapshot = (
        original.id,
        original.crew_schedule_id,
        original.shift_definition_id,
        _utc(original.starts_at),
        _utc(original.ends_at),
        original.operational_date,
    )

    future_boundary = ANCHOR_UTC + CYCLE
    replacement = replace_crew_schedule(
        db_session,
        crew_id=crew.id,
        pattern_id=first_schedule.pattern_id,
        anchor_at=future_boundary,
        effective_from=future_boundary,
        expected_version=first_schedule.version,
        now=past_end,
    )
    db_session.commit()

    historical = db_session.get(WorkShiftOccurrence, original.id)
    assert historical is not None
    assert (
        historical.id,
        historical.crew_schedule_id,
        historical.shift_definition_id,
        _utc(historical.starts_at),
        _utc(historical.ends_at),
        historical.operational_date,
    ) == historical_snapshot
    assert historical.crew_schedule_id == first_schedule.id
    assert replacement.version == first_schedule.version + 1


def test_overlapping_schedule_versions_are_rejected_before_materialization(db_session):
    crew, first_schedule, _shift_ids = _schedule_canonical_crew(db_session)

    with pytest.raises(ValueError, match="overlap"):
        create_crew_schedule(
            db_session,
            crew_id=crew.id,
            pattern_id=first_schedule.pattern_id,
            anchor_at=ANCHOR_UTC + CYCLE,
            effective_from=ANCHOR_UTC + CYCLE,
        )


def test_overlapping_memberships_for_one_employee_are_rejected(db_session):
    crew, _schedule, _shift_ids = _schedule_canonical_crew(db_session)
    employee = _employee(db_session, "G-MEMBERSHIP")
    create_crew_membership(
        db_session,
        employee_id=employee.id,
        crew_id=crew.id,
        effective_from=ANCHOR_UTC,
    )
    db_session.commit()

    with pytest.raises(ValueError, match="overlap"):
        create_crew_membership(
            db_session,
            employee_id=employee.id,
            crew_id=crew.id,
            effective_from=ANCHOR_UTC + timedelta(hours=16),
        )
