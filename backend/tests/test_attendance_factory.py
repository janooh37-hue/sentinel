"""The attendance test factory produces the rows the read paths need.

This exists because `seed_workforce_roster` installs schedule scaffolding only:
no memberships, no occurrences, no cases. Every read-path test depends on this
factory, so the factory itself is pinned first.
"""

from __future__ import annotations

from datetime import date, time

from sqlalchemy import func, select

from app.db.workforce_models import AttendanceCase, AttendancePunch
from tests.factories.attendance import build_attendance_day

DAY = date(2026, 8, 19)


def test_factory_creates_cases_for_every_seeded_person(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("البوابة الرئيسية", 3), ("التفتيش", 2)],
    )

    assert len(fixture.employees) == 5
    assert fixture.cases, "the factory must materialize started cases"
    assert {case.operational_date for case in fixture.cases} == {DAY}
    assert {case.duty_post_snapshot for case in fixture.cases} == {
        "البوابة الرئيسية",
        "التفتيش",
    }
    assert all(case.shift_code_snapshot for case in fixture.cases)
    # `fixture.cases` is filtered to the requested operational date, while the
    # generation window necessarily also materializes neighbouring days, so the
    # table legitimately holds more rows than the fixture exposes.
    assert db_session.query(AttendanceCase).count() >= len(fixture.cases)


def test_factory_day_is_the_rotation_double_day(db_session) -> None:
    """19 Aug 2026 is crew 2's morning+night day, so each person has two cases."""
    fixture = build_attendance_day(
        db_session, operational_date=DAY, posts=[("البوابة الرئيسية", 2)]
    )

    assert len(fixture.cases) == 2 * len(fixture.employees)
    assert {case.shift_code_snapshot for case in fixture.cases} == {"morning", "night"}


def test_factory_punches_are_findable_by_provider_person(db_session) -> None:
    """Punches carry no assignment row; they are found by person plus time window."""
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("البوابة الرئيسية", 1)],
        punches={None: [time(4, 52), time(12, 40)]},
    )

    person = fixture.provider_people[fixture.employees[0].id]
    first_at, last_at, count = db_session.execute(
        select(
            func.min(AttendancePunch.occurred_at),
            func.max(AttendancePunch.occurred_at),
            func.count(AttendancePunch.id),
        ).where(AttendancePunch.provider_person_id == person.id)
    ).one()

    assert count == 2
    assert first_at < last_at
    assert all(punch.direction == "unknown" for punch in db_session.scalars(select(AttendancePunch)))


def test_factory_evaluates_cases_so_presence_state_is_populated(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("التفتيش", 2)],
        punches={None: [time(4, 55), time(12, 30)]},
    )

    from app.services import workforce_read_service
    from app.services.workforce_scope_service import resolve_workforce_scope

    scope = resolve_workforce_scope(db_session, fixture.admin)
    rows = workforce_read_service.list_roster(
        db_session, scope=scope, operational_date=DAY
    )

    assert rows, "the roster must see the factory's cases"
    assert {row["duty_unit"] for row in rows} == {"السرية الثانية"}
    assert all(row["presence_state"] is not None for row in rows), (
        "every case must carry an evaluation, or the register would show blanks"
    )
