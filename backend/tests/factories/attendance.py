"""Build a complete attendance day: crews, people, memberships, occurrences, cases.

`seed_workforce_roster` installs schedule scaffolding only — shifts, rotation
patterns, crews, crew schedules and one policy. It creates no crew memberships,
no `WorkShiftOccurrence` rows and no `AttendanceCase` rows, so a test that calls
it alone asserts against an empty database. This factory adds the rest through
the production services, in the only order that works:

* memberships need a Dubai shift-boundary `effective_from`
  (`create_crew_membership` rejects anything else);
* occurrences need a crew schedule, and are skipped before the schedule's own
  `effective_from` (the seeded anchor, e.g. crew 2's noon on 2026-08-18);
* cases only materialize from occurrences that have already STARTED relative to
  `as_of`;
* evaluation needs a policy (seeded) and a sync-state row, or every decision
  degrades to the not-yet-trustworthy path.

Punches carry no assignment row on purpose: `select_punch_case` returns None
unless `punch.direction in {"in", "out"}` and this provider reports
`punch_state 255`/"unknown" for every event, so `attendance_punch_assignments`
is permanently empty in production. Both the evaluator and the register find
punches by provider person plus the case's policy match window instead.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Employee, User
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendanceSyncState,
    WorkCrew,
    WorkCrewMembership,
)
from app.services import (
    attendance_evaluation_service,
    workforce_schedule_service,
    workforce_seed_service,
)
from app.services.workforce_access_service import organization_scope
from tests.conftest import make_user

SITE_ZONE = ZoneInfo("Asia/Dubai")

#: Nine real guard posts summing to forty, the site's actual shift strength.
GUARD_POSTS: tuple[tuple[str, int], ...] = (
    ("البوابة الرئيسية", 6),
    ("التفتيش", 6),
    ("دورية السياج", 5),
    ("برج المراقبة", 4),
    ("ليوان", 4),
    ("تفتيش المركبات", 4),
    ("بوابة الورشة", 4),
    ("ساحة المخازن", 4),
    ("غرفة التحكم", 3),
)

DEFAULT_POSTS: tuple[tuple[str, int], ...] = GUARD_POSTS[:3]

#: A membership may only start on one of these Dubai wall times.
MEMBERSHIP_START = time(5, 0)


@dataclass
class AttendanceDayFixture:
    """Everything a read-path test needs to assert against one day."""

    admin: User
    crew_id: int
    employees: list[Employee] = field(default_factory=list)
    cases: list[AttendanceCase] = field(default_factory=list)
    provider_people: dict[str, AttendanceProviderPerson] = field(default_factory=dict)


def local(day: date, at: time) -> datetime:
    """A site-local, timezone-aware instant.

    Always build instants this way rather than by subtracting a fixed offset:
    `create_crew_membership` validates against Dubai shift boundaries through
    `_is_shift_boundary`, which converts with `astimezone`.
    """
    return datetime.combine(day, at, tzinfo=SITE_ZONE)


def utc_naive(moment: datetime) -> datetime:
    """The UTC-naive form every workforce datetime column stores."""
    return moment.astimezone(UTC).replace(tzinfo=None)


def build_attendance_day(
    db: Session,
    *,
    operational_date: date,
    unit: str = "السرية الثانية",
    posts: tuple[tuple[str, int], ...] | list[tuple[str, int]] | None = None,
    punches: dict[str | None, list[time]] | None = None,
    membership_start: date = date(2026, 8, 1),
) -> AttendanceDayFixture:
    """Seed one operational day for `unit` and return what was created."""
    admin = make_user(db, role="admin", email=f"factory-{operational_date}-{unit[:6]}@test.ae")
    db.flush()

    trusted_scope = organization_scope()
    workforce_seed_service.seed_workforce_roster(
        db,
        scope=trusted_scope,
        actor_user_id=admin.id,
    )
    db.flush()

    crew_code = workforce_seed_service.DUTY_UNIT_TO_CREW[unit]
    crew = db.scalar(select(WorkCrew).where(WorkCrew.code == crew_code))
    assert crew is not None, f"seeding must create crew {crew_code}"
    fixture = AttendanceDayFixture(admin=admin, crew_id=crew.id)

    index = 0
    for post, headcount in posts or DEFAULT_POSTS:
        for _ in range(headcount):
            index += 1
            employee = Employee(
                id=f"G-{9000 + index}",
                name_en=f"Factory Person {index}",
                name_ar=f"شخص {index}",
                status="Active",
                department="الأمن",
                duty_unit=unit,
                duty_post=post,
            )
            db.add(employee)
            fixture.employees.append(employee)
            db.flush()

            person = AttendanceProviderPerson(
                provider="biotime",
                external_person_id=str(8000 + index),
                external_employee_code=employee.id,
                display_name_snapshot=employee.name_en,
                employee_id=employee.id,
                mapping_state="verified",
                # ck_attendance_provider_people_verified_fields: a verified row
                # MUST carry employee_id AND verified_by_user_id AND verified_at.
                verified_by_user_id=admin.id,
                verified_at=utc_naive(local(membership_start, MEMBERSHIP_START)),
                active=True,
                first_seen_at=utc_naive(local(membership_start, MEMBERSHIP_START)),
                last_seen_at=utc_naive(local(operational_date, time(23, 0))),
            )
            db.add(person)
            fixture.provider_people[employee.id] = person
            db.flush()

            workforce_schedule_service.create_crew_membership(
                db,
                scope=trusted_scope,
                if_match=workforce_schedule_service.crew_membership_collection_etag(
                    list(
                        db.scalars(
                            select(WorkCrewMembership).where(WorkCrewMembership.crew_id == crew.id)
                        )
                    )
                ),
                employee_id=employee.id,
                crew_id=crew.id,
                effective_from=local(membership_start, MEMBERSHIP_START),
                actor_user_id=admin.id,
            )
    db.flush()

    workforce_schedule_service.generate_occurrences(
        db,
        scope=trusted_scope,
        crew_id=crew.id,
        starts_at=local(operational_date, time(0, 0)) - timedelta(days=3),
        ends_at=local(operational_date, time(0, 0)) + timedelta(days=2),
    )
    db.flush()

    db.merge(
        AttendanceSyncState(
            provider="biotime",
            stream="punches",
            fresh_through=utc_naive(local(operational_date, time(23, 59))),
            last_success_at=utc_naive(local(operational_date, time(23, 59))),
        )
    )
    db.flush()

    as_of = local(operational_date, time(23, 59))
    evaluation_start_at = local(membership_start, time(0, 0))
    for employee in fixture.employees:
        attendance_evaluation_service.materialize_scheduled_cases(
            db,
            employee_id=employee.id,
            horizon=as_of,
            evaluation_start_at=evaluation_start_at,
        )
    db.flush()

    fixture.cases = list(
        db.scalars(
            select(AttendanceCase)
            .where(AttendanceCase.operational_date == operational_date)
            .order_by(AttendanceCase.scheduled_start_at, AttendanceCase.employee_id)
        )
    )

    if punches:
        for employee_id, times in punches.items():
            targets = (
                fixture.employees
                if employee_id is None
                else [e for e in fixture.employees if e.id == employee_id]
            )
            for employee in targets:
                for at in times:
                    add_punch(
                        db,
                        provider_person=fixture.provider_people[employee.id],
                        occurred_at=local(operational_date, at),
                    )
        db.flush()

    for case in fixture.cases:
        attendance_evaluation_service.evaluate_case(
            db, case.id, evaluated_at=as_of, evaluation_start_at=evaluation_start_at
        )
    db.commit()
    return fixture


def add_punch(
    db: Session,
    *,
    provider_person: AttendanceProviderPerson,
    occurred_at: datetime,
    device_name: str = "Main Gate Turnstile",
) -> AttendancePunch:
    """Insert one punch. Deliberately no assignment row — see the module docstring.

    `normalized_payload_hash` is NOT NULL with no server default and must be
    supplied; `direction` stays "unknown" because this provider never reports one.
    """
    punch = AttendancePunch(
        provider="biotime",
        external_event_id=f"factory-{provider_person.id}-{occurred_at.isoformat()}",
        provider_person_id=provider_person.id,
        occurred_at=utc_naive(occurred_at),
        direction="unknown",
        device_name=device_name,
        normalized_payload_hash=f"h{provider_person.id}-{int(occurred_at.timestamp())}",
    )
    db.add(punch)
    db.flush()
    return punch
