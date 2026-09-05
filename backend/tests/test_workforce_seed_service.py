"""The seeded roster must reproduce the roster the site actually runs.

The site owner stated four facts about 18 and 19 August 2026. If the generated
occurrences disagree with any of them, the rotation is wrong and every downstream
attendance decision would be wrong with it, so they are asserted directly rather
than restating the pattern arithmetic.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.api.errors import AppError
from app.db.workforce_models import (
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.services import workforce_schedule_service, workforce_seed_service
from app.services.workforce_access_service import organization_scope
from app.services.workforce_scope_service import WorkforceScope, WorkforceScopeEntry

DUBAI = ZoneInfo("Asia/Dubai")


def _seed(db_session, admin_user) -> None:
    workforce_seed_service.seed_workforce_roster(
        db_session,
        scope=organization_scope(),
        actor_user_id=admin_user.id,
    )
    db_session.flush()


def test_seed_requires_explicit_organization_scope(db_session, admin_user) -> None:
    department_scope = WorkforceScope(
        entries=(WorkforceScopeEntry(scope_kind="department", department="Operations"),)
    )

    with pytest.raises(AppError) as denied:
        workforce_seed_service.seed_workforce_roster(
            db_session,
            scope=department_scope,
            actor_user_id=admin_user.id,
        )

    assert denied.value.code == "FORBIDDEN"
    db_session.flush()
    assert db_session.scalar(select(WorkCrew.id).limit(1)) is None
    assert db_session.scalar(select(WorkCrewSchedule.id).limit(1)) is None
    assert db_session.scalar(select(WorkRotationPattern.id).limit(1)) is None
    assert db_session.scalar(select(WorkShiftDefinition.id).limit(1)) is None
    assert db_session.scalar(select(WorkAttendancePolicy.id).limit(1)) is None


def _generate(db_session, *, start: date, days: int) -> None:
    starts_at = datetime.combine(start, datetime.min.time(), tzinfo=DUBAI).astimezone(UTC)
    ends_at = starts_at + timedelta(days=days)
    for crew_id in db_session.scalars(select(WorkCrew.id)):
        workforce_schedule_service.generate_occurrences(
            db_session,
            scope=organization_scope(),
            crew_id=crew_id,
            starts_at=starts_at,
            ends_at=ends_at,
        )
    db_session.flush()


def _roster(db_session, day: date) -> dict[str, str]:
    """Return {shift code: crew code} for occurrences starting on a local date."""
    rows = db_session.execute(
        select(WorkShiftOccurrence, WorkCrew, WorkShiftDefinition)
        .join(WorkCrew, WorkCrew.id == WorkShiftOccurrence.crew_id)
        .join(
            WorkShiftDefinition,
            WorkShiftDefinition.id == WorkShiftOccurrence.shift_definition_id,
        )
    ).all()
    roster: dict[str, str] = {}
    for occurrence, crew, shift in rows:
        local = occurrence.starts_at.replace(tzinfo=UTC).astimezone(DUBAI)
        if local.date() == day:
            roster[shift.code] = crew.code
    return roster


@pytest.fixture
def seeded(db_session, admin_user):
    _seed(db_session, admin_user)
    _generate(db_session, start=date(2026, 8, 17), days=12)
    return db_session


def test_shift_windows_are_one_hour_later_than_the_original_design(seeded):
    """Night ends at 05:00, so the whole plan shifts from 04/12/20 to 05/13/21."""
    shifts = {row.code: row for row in seeded.scalars(select(WorkShiftDefinition))}

    assert shifts["morning"].start_local_time.hour == 5
    assert shifts["noon"].start_local_time.hour == 13
    assert shifts["night"].start_local_time.hour == 21
    assert {shifts[code].duration_minutes for code in ("morning", "noon", "night")} == {480}


def test_eighteenth_august_matches_the_stated_roster(seeded):
    """Owner: noon is crew 2, and crew 1 works both morning and night."""
    roster = _roster(seeded, date(2026, 8, 18))

    assert roster["noon"] == "crew_2"
    assert roster["morning"] == "crew_1"
    assert roster["night"] == "crew_1"


def test_nineteenth_august_matches_the_stated_roster(seeded):
    """Owner: crew 3 takes noon, crew 2 moves to morning."""
    roster = _roster(seeded, date(2026, 8, 19))

    assert roster["noon"] == "crew_3"
    assert roster["morning"] == "crew_2"
    assert roster["night"] == "crew_2"


def test_noon_rotates_through_every_crew_then_wraps(seeded):
    noon_by_day = [_roster(seeded, date(2026, 8, day)).get("noon") for day in range(18, 24)]

    assert noon_by_day == ["crew_2", "crew_3", "crew_4", "crew_5", "crew_1", "crew_2"]


def test_yesterdays_noon_crew_works_todays_morning_and_night(seeded):
    for day in range(18, 23):
        today = _roster(seeded, date(2026, 8, day))
        yesterday = _roster(seeded, date(2026, 8, day - 1))

        assert today["morning"] == yesterday["noon"]
        assert today["night"] == today["morning"]


def test_each_crew_works_three_shifts_and_rests_three_days(seeded):
    for crew_code in ("crew_1", "crew_2", "crew_3", "crew_4", "crew_5"):
        working_days = {
            _roster(seeded, date(2026, 8, day)).get(shift) and date(2026, 8, day)
            for day in range(18, 23)
            for shift in ("morning", "noon", "night")
            if _roster(seeded, date(2026, 8, day)).get(shift) == crew_code
        }
        shifts_worked = sum(
            1
            for day in range(18, 23)
            for shift in ("morning", "noon", "night")
            if _roster(seeded, date(2026, 8, day)).get(shift) == crew_code
        )

        assert shifts_worked == 3, crew_code
        # Three shifts across two calendar days leaves three days of rest in a
        # five-day cycle.
        assert len({d for d in working_days if d}) == 2, crew_code


def test_exactly_two_crews_are_on_duty_each_day(seeded):
    """Five crews cover three shifts only if one crew doubles up.

    Office duty is excluded: it is a separate pattern on its own weekly cycle
    and does not participate in the guard rotation's coverage arithmetic.
    """
    for day in range(18, 23):
        roster = {
            shift: crew
            for shift, crew in _roster(seeded, date(2026, 8, day)).items()
            if shift != "office_day"
        }

        assert set(roster) == {"morning", "noon", "night"}
        assert len(set(roster.values())) == 2


def test_night_occurrence_is_attributed_to_the_day_it_starts(seeded):
    roster = _roster(seeded, date(2026, 8, 18))
    occurrence = seeded.scalars(
        select(WorkShiftOccurrence)
        .join(WorkCrew, WorkCrew.id == WorkShiftOccurrence.crew_id)
        .where(WorkCrew.code == roster["night"])
    ).all()
    nights = [
        row for row in occurrence if row.starts_at.replace(tzinfo=UTC).astimezone(DUBAI).hour == 21
    ]

    assert nights, "expected a night occurrence"
    first = min(nights, key=lambda row: row.starts_at)
    local_start = first.starts_at.replace(tzinfo=UTC).astimezone(DUBAI)
    local_end = first.ends_at.replace(tzinfo=UTC).astimezone(DUBAI)

    assert local_start.date() == date(2026, 8, 18)
    assert local_end.date() == date(2026, 8, 19)
    assert local_end.hour == 5


def test_office_crew_works_monday_to_thursday_only(seeded):
    """Friday belongs to the alternating A/B roster service, not to this pattern."""
    office_days = {
        row.starts_at.replace(tzinfo=UTC).astimezone(DUBAI).date()
        for row in seeded.scalars(
            select(WorkShiftOccurrence)
            .join(WorkCrew, WorkCrew.id == WorkShiftOccurrence.crew_id)
            .where(WorkCrew.code == workforce_seed_service.OFFICE_CREW_CODE)
        )
    }
    weekdays = {day.weekday() for day in office_days}

    # Monday..Thursday are 0..3; Friday=4, Saturday=5, Sunday=6 must be absent.
    assert weekdays == {0, 1, 2, 3}


def test_office_shift_starts_at_seven_local(seeded):
    office = seeded.scalar(
        select(WorkShiftDefinition).where(WorkShiftDefinition.code == "office_day")
    )

    assert office.start_local_time.hour == 7
    assert office.duration_minutes == 480


def test_every_duty_unit_string_maps_to_a_seeded_crew(seeded):
    """`Employee.duty_unit` is the only membership input, so every unit must map."""
    from app.core.duty import SEED_UNITS

    codes = {row.code for row in seeded.scalars(select(WorkCrew))}

    for unit in SEED_UNITS:
        assert unit in workforce_seed_service.DUTY_UNIT_TO_CREW
        assert workforce_seed_service.DUTY_UNIT_TO_CREW[unit] in codes


def test_seeding_twice_changes_nothing(db_session, admin_user):
    _seed(db_session, admin_user)
    counts = {
        model: db_session.scalar(select(model).with_only_columns(model.id).count_())
        if False
        else len(list(db_session.scalars(select(model))))
        for model in (WorkShiftDefinition, WorkCrew, WorkShiftOccurrence)
    }

    second = workforce_seed_service.seed_workforce_roster(
        db_session,
        scope=organization_scope(),
        actor_user_id=admin_user.id,
    )
    db_session.flush()

    assert second.schedules == 0
    assert second.policy_created is False
    for model, count in counts.items():
        assert len(list(db_session.scalars(select(model)))) == count


def test_default_policy_is_seeded_approved_with_thirty_minute_grace(seeded):
    from app.db.workforce_models import WorkAttendancePolicy

    policy = seeded.scalar(
        select(WorkAttendancePolicy).where(WorkAttendancePolicy.shift_definition_id.is_(None))
    )

    assert policy is not None
    assert policy.grace_minutes == 30
    # The site's ladder: past the grace is late, twice the grace with no punch at
    # all is an absence.
    assert policy.absence_after_minutes == 60
    assert policy.require_checkout is True
    # An unapproved policy leaves the evaluator with no values, which reads as
    # "unknown" for every employee rather than as a safe default.
    assert policy.approved_at is not None
