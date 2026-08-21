"""Learned punch habits: what gets learned, how it widens a window, how it reads a lone punch.

Contract under test:
* Punches pair by gap, not by calendar day, so a night duty that ends after
  midnight is one duty and not two half-read ones.
* A pair is anchored to the nearest shift start, so habits are learnable without
  any roster history behind the punches.
* A habit must repeat before it counts, and attribution never reaches more than
  the approved cap before a start, nor past the person's previous duty.
* A lone punch is read as a departure only when it clearly sits at the far edge;
  otherwise the caller keeps treating it as an arrival.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy import select

from app.db.models import Employee, User
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendancePunchProfile,
    WorkAttendancePolicy,
    WorkShiftDefinition,
    WorkShiftOverride,
)
from app.services import attendance_profile_service as profiles

# Asia/Dubai is UTC+4: a 05:00 local shift starts at 01:00Z.
MORNING_START_UTC = 1 * 60
NOW = datetime(2026, 8, 20, 6, 0, tzinfo=UTC)


def _utc(moment: datetime) -> datetime:
    return moment.replace(tzinfo=None)


@pytest.fixture()
def site(db_session) -> dict[str, object]:
    """One employee, mapped to one device identity, on a site with three shifts."""
    actor = User(
        id=1,
        email="profiles@test.ae",
        password_hash="x",
        role="admin",
        status="active",
    )
    employee = Employee(
        id="G-PROF-1",
        name_en="Habit Officer",
        name_ar="ضابط الروتين",
        status="Active",
        duty_unit="Gate A",
        duty_post="Post 1",
    )
    shifts = [
        WorkShiftDefinition(code="morning", start_local_time=time(5, 0), duration_minutes=480),
        WorkShiftDefinition(code="noon", start_local_time=time(13, 0), duration_minutes=480),
        WorkShiftDefinition(code="night", start_local_time=time(21, 0), duration_minutes=480),
    ]
    db_session.add_all([actor, employee, *shifts])
    db_session.flush()
    person = AttendanceProviderPerson(
        provider="biotime",
        external_person_id="p-1",
        external_employee_code="1",
        employee_id=employee.id,
        mapping_state="verified",
        verified_by_user_id=actor.id,
        verified_at=_utc(NOW),
        active=True,
    )
    policy = WorkAttendancePolicy(
        shift_definition_id=None,
        grace_minutes=30,
        absence_after_minutes=30,
        early_exit_grace_minutes=30,
        match_before_minutes=60,
        match_after_minutes=120,
        require_checkout=True,
        effective_from=date(2026, 1, 1),
        created_by_user_id=actor.id,
        approved_by_user_id=actor.id,
        approved_at=_utc(NOW),
    )
    db_session.add_all([person, policy])
    db_session.flush()
    return {"employee": employee, "person": person, "policy": policy, "actor": actor}


def _punch(db_session, person: AttendanceProviderPerson, moment: datetime) -> AttendancePunch:
    punch = AttendancePunch(
        provider="biotime",
        external_event_id=f"e-{moment.isoformat()}",
        provider_person_id=person.id,
        occurred_at=_utc(moment),
        direction="unknown",
        normalized_payload_hash=f"h-{moment.isoformat()}",
    )
    db_session.add(punch)
    return punch


def _case(
    db_session,
    employee: Employee,
    *,
    operational_date: date,
    start: datetime,
    shift_code: str = "morning",
) -> AttendanceCase:
    """One case with the cheapest legitimate schedule source: an explicit override.

    ``ck_attendance_cases_schedule_source_required`` forbids a case that no
    occurrence and no override produced, and an override needs no crew, pattern
    or anchor - which keeps these tests about habits rather than rostering.
    """
    definition = db_session.scalar(
        select(WorkShiftDefinition).where(WorkShiftDefinition.code == shift_code)
    )
    override = WorkShiftOverride(
        employee_id=employee.id,
        assignment_kind="work",
        reason_kind="temporary_duty",
        starts_at=_utc(start),
        ends_at=_utc(start + timedelta(hours=8)),
        shift_definition_id=definition.id,
        duty_unit=employee.duty_unit,
        duty_post=employee.duty_post,
        reason="habit fixture",
        created_by_user_id=1,
    )
    db_session.add(override)
    db_session.flush()
    case = AttendanceCase(
        employee_id=employee.id,
        shift_override_id=override.id,
        operational_date=operational_date,
        scheduled_start_at=_utc(start),
        scheduled_end_at=_utc(start + timedelta(hours=8)),
        employee_status_snapshot="Active",
        shift_code_snapshot=shift_code,
        organization_snapshot_state="captured",
        duty_unit_snapshot=employee.duty_unit,
        duty_post_snapshot=employee.duty_post,
    )
    db_session.add(case)
    db_session.flush()
    return case


def test_a_habit_is_learned_from_paired_punches_without_any_roster(db_session, site) -> None:
    """Eight months of punches and no cases at all still produce a habit.

    The roster here was installed after the punches were recorded, which is the
    real situation on site: anchoring on shift starts is what makes those months
    usable instead of discarded.
    """
    person = site["person"]
    # Arrives 04:40 local (00:40Z), 20 minutes before the 05:00 shift, and leaves
    # 13:10 local, ten minutes after it ends.
    for offset in range(10):
        day = datetime(2026, 8, 1, tzinfo=UTC) - timedelta(days=offset)
        _punch(db_session, person, day.replace(hour=0, minute=40))
        _punch(db_session, person, day.replace(hour=9, minute=10))
    db_session.flush()

    result = profiles.rebuild_profiles(db_session, now=NOW)

    assert result.pairs == 10
    profile = db_session.get(AttendancePunchProfile, (site["employee"].id, "morning"))
    assert profile is not None
    assert profile.sample_days == 10
    assert profile.arrival_typical_offset == -20
    assert profile.departure_typical_offset == 10


def test_a_night_duty_is_one_pair_across_midnight(db_session, site) -> None:
    """Pairing by gap, not by date: the 21:00 arrival owns the 05:00 departure.

    Grouping by calendar day would read the departure as the next day's arrival
    and teach the night crew a habit of starting work when they go home.
    """
    person = site["person"]
    for offset in range(8):
        evening = datetime(2026, 8, 10, 16, 55, tzinfo=UTC) - timedelta(days=offset)
        _punch(db_session, person, evening)
        _punch(db_session, person, evening + timedelta(hours=8, minutes=10))
    db_session.flush()

    profiles.rebuild_profiles(db_session, now=NOW)

    learned = db_session.scalars(select(AttendancePunchProfile)).all()
    assert [row.shift_code for row in learned] == ["night"]
    assert learned[0].sample_days == 8
    # 20:55 local is five minutes before the 21:00 start.
    assert learned[0].arrival_typical_offset == -5


def test_two_punches_minutes_apart_are_not_a_duty(db_session, site) -> None:
    """A doubled punch at the gate is one sighting, not an eight-hour shift."""
    person = site["person"]
    for offset in range(6):
        day = datetime(2026, 8, 5, 0, 40, tzinfo=UTC) - timedelta(days=offset)
        _punch(db_session, person, day)
        _punch(db_session, person, day + timedelta(minutes=2))
    db_session.flush()

    result = profiles.rebuild_profiles(db_session, now=NOW)

    assert result.pairs == 0
    assert db_session.scalars(select(AttendancePunchProfile)).all() == []


def test_a_habit_must_repeat_before_it_counts(db_session, site) -> None:
    """Below the sample floor nothing is written, so the policy window stands."""
    person = site["person"]
    for offset in range(profiles.MIN_SAMPLE_DAYS - 1):
        day = datetime(2026, 8, 5, tzinfo=UTC) - timedelta(days=offset)
        _punch(db_session, person, day.replace(hour=0, minute=40))
        _punch(db_session, person, day.replace(hour=9, minute=10))
    db_session.flush()

    profiles.rebuild_profiles(db_session, now=NOW)

    assert db_session.scalars(select(AttendancePunchProfile)).all() == []


def test_attribution_widens_to_the_learned_arrival_but_not_past_the_cap(db_session, site) -> None:
    """The window covers the person's own habit, and stops at the approved cap."""
    employee, policy = site["employee"], site["policy"]
    case = _case(
        db_session,
        employee,
        operational_date=date(2026, 8, 20),
        start=datetime(2026, 8, 20, 1, 0, tzinfo=UTC),
    )

    policy_start, _ = profiles.evidence_window(db_session, case=case, policy=policy)
    assert policy_start == case.scheduled_start_at - timedelta(minutes=60)

    habitual = AttendancePunchProfile(
        employee_id=employee.id,
        shift_code="morning",
        sample_days=30,
        arrival_early_offset=-140,
        arrival_typical_offset=-120,
        departure_typical_offset=5,
        departure_late_offset=20,
        window_days=90,
        computed_at=_utc(NOW),
    )
    widened_start, _ = profiles.evidence_window(
        db_session, case=case, policy=policy, profile=habitual
    )
    assert widened_start == case.scheduled_start_at - timedelta(
        minutes=140 + profiles.WIDEN_MARGIN_MINUTES
    )

    extreme = AttendancePunchProfile(
        employee_id=employee.id,
        shift_code="morning",
        sample_days=30,
        arrival_early_offset=-600,
        arrival_typical_offset=-500,
        departure_typical_offset=5,
        departure_late_offset=20,
        window_days=90,
        computed_at=_utc(NOW),
    )
    capped_start, _ = profiles.evidence_window(
        db_session, case=case, policy=policy, profile=extreme
    )
    assert capped_start == case.scheduled_start_at - timedelta(minutes=profiles.MAX_WIDEN_MINUTES)


def test_one_punch_can_never_feed_two_duties_on_a_double_day(db_session, site) -> None:
    """On a rotation double-day the window stops at the previous duty's end.

    The three-hour cap alone would reach back to 06:00 here, into a night duty
    that ran until 07:00. One punch must not be evidence for both.
    """
    employee, policy = site["employee"], site["policy"]
    _case(
        db_session,
        employee,
        operational_date=date(2026, 8, 19),
        start=datetime(2026, 8, 19, 23, 0, tzinfo=UTC),
        shift_code="night",
    )
    second = _case(
        db_session,
        employee,
        operational_date=date(2026, 8, 20),
        start=datetime(2026, 8, 20, 9, 0, tzinfo=UTC),
        shift_code="noon",
    )
    habitual = AttendancePunchProfile(
        employee_id=employee.id,
        shift_code="noon",
        sample_days=30,
        arrival_early_offset=-170,
        arrival_typical_offset=-150,
        departure_typical_offset=5,
        departure_late_offset=20,
        window_days=90,
        computed_at=_utc(NOW),
    )

    start, _ = profiles.evidence_window(db_session, case=second, policy=policy, profile=habitual)

    assert start == datetime(2026, 8, 20, 7, 0)  # the night duty's own end


def test_a_lone_punch_at_going_home_time_is_read_as_a_departure(db_session, site) -> None:
    """The whole point: it must not be timed as an eight-hour-late arrival."""
    employee = site["employee"]
    case = _case(
        db_session,
        employee,
        operational_date=date(2026, 8, 20),
        start=datetime(2026, 8, 20, 1, 0, tzinfo=UTC),
    )
    habitual = AttendancePunchProfile(
        employee_id=employee.id,
        shift_code="morning",
        sample_days=30,
        arrival_early_offset=-25,
        arrival_typical_offset=-20,
        departure_typical_offset=10,
        departure_late_offset=30,
        window_days=90,
        computed_at=_utc(NOW),
    )

    assert (
        profiles.infer_direction(
            case=case, punch_at=case.scheduled_end_at + timedelta(minutes=8), profile=habitual
        )
        == "out"
    )
    assert (
        profiles.infer_direction(
            case=case, punch_at=case.scheduled_start_at - timedelta(minutes=18), profile=habitual
        )
        == "in"
    )
    # Mid-duty there is no nearer edge, so the punch stays uninterpreted.
    assert (
        profiles.infer_direction(
            case=case, punch_at=case.scheduled_start_at + timedelta(hours=4), profile=habitual
        )
        is None
    )


def test_the_shift_edges_answer_when_no_habit_exists(db_session, site) -> None:
    """A brand-new employee still gets the structural read, just not a personal one."""
    case = _case(
        db_session,
        site["employee"],
        operational_date=date(2026, 8, 20),
        start=datetime(2026, 8, 20, 1, 0, tzinfo=UTC),
    )

    assert (
        profiles.infer_direction(
            case=case, punch_at=case.scheduled_end_at + timedelta(minutes=2), profile=None
        )
        == "out"
    )
    assert (
        profiles.infer_direction(
            case=case, punch_at=case.scheduled_start_at + timedelta(minutes=5), profile=None
        )
        == "in"
    )


def test_a_rotating_crew_keeps_one_habit_per_shift_and_no_complaint(db_session, site) -> None:
    """Working every shift in turn is the rotation, not a rostering error.

    The crew is rostered on all three, so all three are candidate anchors and
    each turn is learned under its own shift.
    """
    person, employee = site["person"], site["employee"]
    starts = {"morning": (0, 1), "noon": (8, 9), "night": (16, 17)}
    for index, (punch_hour, case_hour) in enumerate(starts.values()):
        for offset in range(6):
            day = datetime(2026, 7, 1, tzinfo=UTC) + timedelta(days=index * 7 + offset)
            arrival = day + timedelta(hours=punch_hour, minutes=55)
            _punch(db_session, person, arrival)
            _punch(db_session, person, arrival + timedelta(hours=8))
        _case(
            db_session,
            employee,
            operational_date=date(2026, 8, 10 + index),
            start=datetime(2026, 8, 10 + index, case_hour, 0, tzinfo=UTC),
            shift_code=list(starts)[index],
        )
    db_session.flush()

    result = profiles.rebuild_profiles(db_session, now=NOW)

    learned = db_session.scalars(select(AttendancePunchProfile)).all()
    assert sorted(row.shift_code for row in learned) == ["morning", "night", "noon"]
    assert result.mismatches == ()


def test_a_habit_that_fits_another_shift_is_reported_against_its_own_row(
    db_session, site
) -> None:
    """Rostered noon, punching 04:50 to 13:00 every day: the roster is the error."""
    person, employee = site["person"], site["employee"]
    for offset in range(12):
        day = datetime(2026, 8, 1, tzinfo=UTC) - timedelta(days=offset)
        _punch(db_session, person, day.replace(hour=0, minute=50))
        _punch(db_session, person, day.replace(hour=9, minute=0))
    _case(
        db_session,
        employee,
        operational_date=date(2026, 8, 19),
        start=datetime(2026, 8, 19, 9, 0, tzinfo=UTC),
        shift_code="noon",
    )
    db_session.flush()

    result = profiles.rebuild_profiles(db_session, now=NOW)

    # Filed under the rostered shift, with the better-fitting one named.
    assert result.mismatches == ((employee.id, "noon", "morning"),)
    profile = db_session.get(AttendancePunchProfile, (employee.id, "noon"))
    assert profile is not None
    assert profile.suggested_shift_code == "morning"


def test_a_duty_matching_no_defined_shift_is_not_given_a_label(db_session, site) -> None:
    """The live case this rule exists for: a crew running 06:00 to 14:00.

    Rostered office_day (07:00), arriving 05:52, leaving 14:00. It is 68 minutes
    early for the office shift and 52 late for the morning one, so no defined
    shift fits. Naming the nearer start would be a confident wrong answer; the
    offsets are left to say what the pattern actually is.
    """
    person, employee = site["person"], site["employee"]
    db_session.add(
        WorkShiftDefinition(code="office_day", start_local_time=time(7, 0), duration_minutes=480)
    )
    db_session.flush()
    for offset in range(14):
        day = datetime(2026, 8, 1, tzinfo=UTC) - timedelta(days=offset)
        _punch(db_session, person, day.replace(hour=1, minute=52))
        _punch(db_session, person, day.replace(hour=10, minute=0))
    _case(
        db_session,
        employee,
        operational_date=date(2026, 8, 19),
        start=datetime(2026, 8, 19, 3, 0, tzinfo=UTC),
        shift_code="office_day",
    )
    db_session.flush()

    result = profiles.rebuild_profiles(db_session, now=NOW)

    assert result.mismatches == ()
    profile = db_session.get(AttendancePunchProfile, (employee.id, "office_day"))
    assert profile is not None
    assert profile.suggested_shift_code is None
    assert profile.arrival_typical_offset == -68
    assert profile.departure_typical_offset == -60
