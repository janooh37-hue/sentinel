"""Task 29 local operational acceptance, driven by the deterministic fake provider.

These assert on persisted rows and service results rather than UI text, and
they exercise the whole chain: provider import -> identity mapping -> punch
allocation -> evaluation revisions -> corrections -> scope enforcement.

Every acceptance point from the plan's "Local operational smoke" is covered:
map a fake person, assign a crew anchor, import deterministic punches, observe
current/self shift, late minutes, absence only after the threshold, stale
no-punch -> unknown, later Sick approval -> excused revision, corrections that
retain source facts, and supervisor scope denial.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy import select

from app.db.models import Employee, Leave, User
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceProviderPerson,
    AttendancePunch,
    DutyAssignmentEvent,
    UserWorkforceScope,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.schemas.employee import EmployeeUpdate
from app.schemas.workforce import WorkforceConfiguration
from app.services import (
    attendance_evaluation_service,
    attendance_sync_service,
    employee_service,
    scheduler_service,
    settings_service,
    workforce_dashboard_service,
    workforce_read_service,
    workforce_schedule_service,
    workforce_scope_service,
)
from app.services.workforce_access_service import organization_scope
from tests.factories.attendance import build_attendance_day, local
from tests.fakes.attendance_provider import DeterministicAttendanceProvider, person, punch

# A fixed Dubai morning shift: 08:00-16:00 local == 04:00-12:00 UTC.
SHIFT_START = datetime(2026, 8, 17, 4, 0)
SHIFT_END = datetime(2026, 8, 17, 12, 0)
OPERATIONAL_DATE = date(2026, 8, 17)
GRACE_MINUTES = 10
ABSENCE_AFTER_MINUTES = 60


@pytest.fixture()
def seeded(db_session):
    """Seed one employee on one materialized morning occurrence with a policy."""
    actor = User(email="smoke-admin@test.ae", password_hash="x", role="admin", status="active")
    employee = Employee(
        id="G-SMOKE-1",
        name_en="Smoke Officer",
        name_ar="ضابط الاختبار",
        status="Active",
        department="Operations",
        duty_unit="Gate A",
    )
    shift = WorkShiftDefinition(
        code="smoke-morning", start_local_time=time(8, 0), duration_minutes=480
    )
    pattern = WorkRotationPattern(
        code="smoke-pattern", name="Smoke pattern", cycle_minutes=7_200, timezone="Asia/Dubai"
    )
    crew = WorkCrew(code="smoke-crew", name_en="Smoke crew")
    db_session.add_all((actor, employee, shift, pattern, crew))
    db_session.flush()

    schedule = WorkCrewSchedule(
        crew_id=crew.id,
        pattern_id=pattern.id,
        anchor_at=SHIFT_START - timedelta(days=7),
        effective_from=SHIFT_START - timedelta(days=7),
        version=1,
        created_by_user_id=actor.id,
    )
    db_session.add(schedule)
    db_session.flush()

    occurrence = WorkShiftOccurrence(
        crew_id=crew.id,
        crew_schedule_id=schedule.id,
        shift_definition_id=shift.id,
        starts_at=SHIFT_START,
        ends_at=SHIFT_END,
        operational_date=OPERATIONAL_DATE,
        pattern_code_snapshot=pattern.code,
        crew_schedule_version_snapshot=schedule.version,
        source_anchor_at=schedule.anchor_at,
    )
    membership = WorkCrewMembership(
        crew_id=crew.id,
        employee_id=employee.id,
        effective_from=SHIFT_START - timedelta(days=7),
        created_by_user_id=actor.id,
        updated_by_user_id=actor.id,
    )
    policy = WorkAttendancePolicy(
        shift_definition_id=None,
        grace_minutes=GRACE_MINUTES,
        absence_after_minutes=ABSENCE_AFTER_MINUTES,
        early_exit_grace_minutes=10,
        match_before_minutes=120,
        match_after_minutes=120,
        require_checkout=True,
        effective_from=OPERATIONAL_DATE - timedelta(days=30),
        approved_by_user_id=actor.id,
        approved_at=SHIFT_START - timedelta(days=7),
        created_by_user_id=actor.id,
    )
    db_session.add_all((occurrence, membership, policy))
    db_session.flush()

    case = AttendanceCase(
        employee_id=employee.id,
        shift_occurrence_id=occurrence.id,
        employee_status_snapshot="Active",
        crew_code_snapshot=crew.code,
        crew_name_snapshot=crew.name_en,
        shift_code_snapshot=shift.code,
        department_snapshot=employee.department,
        duty_unit_snapshot=employee.duty_unit,
        duty_post_snapshot=None,
        scheduled_start_at=SHIFT_START,
        scheduled_end_at=SHIFT_END,
        operational_date=OPERATIONAL_DATE,
        organization_snapshot_state="captured",
    )
    db_session.add(case)
    db_session.commit()
    return {"actor": actor, "employee": employee, "case": case, "occurrence": occurrence}


def _import(db_session, *, punches=(), people=(), now, window_since=None):
    """Import one provider page through the real sync service.

    The window mirrors a configured operator backfill: the service opens the
    first one at ``backfill_start`` and then resumes from its own freshness.
    """
    provider = DeterministicAttendanceProvider(people=people, punches=punches)
    if people:
        attendance_sync_service.sync_people(db_session, provider=provider, now=now)
    backfill_start = window_since or (SHIFT_START - timedelta(hours=2))
    if backfill_start.tzinfo is None:
        backfill_start = backfill_start.replace(tzinfo=UTC)
    # Each call imports one page in its own right, so the stream is returned to
    # "never synced" first: freshness from an earlier call would otherwise move
    # the window past the punches this call is handing over.
    state = attendance_sync_service._state(db_session, provider="biotime", stream="punches")
    state.cursor = None
    state.window_since = None
    state.window_until = None
    state.fresh_through = None
    db_session.flush()
    imported = attendance_sync_service.sync_punches(
        db_session, provider=provider, now=now, backfill_start=backfill_start
    )
    db_session.commit()
    return imported


def _map_identity(db_session, employee_id: str, *, actor: User) -> AttendanceProviderPerson:
    row = db_session.scalar(
        select(AttendanceProviderPerson).where(
            AttendanceProviderPerson.external_person_id == "bio-smoke-1"
        )
    )
    assert row is not None, "provider person must exist before manual reconciliation"
    # A verified mapping must carry who verified it and when; the model enforces this.
    row.employee_id = employee_id
    row.mapping_state = "verified"
    row.verified_by_user_id = actor.id
    row.verified_at = SHIFT_START
    db_session.commit()
    return row


def test_mapped_person_with_punches_produces_an_on_duty_evaluation(seeded, db_session):
    """Map a fake person, import punches, and observe a verified on-duty result."""
    employee = seeded["employee"]
    now = SHIFT_START + timedelta(hours=1)

    _import(
        db_session,
        people=[person("bio-smoke-1", employee_code=employee.id, display_name="Smoke Officer")],
        now=now,
    )
    provider_person = _map_identity(db_session, employee.id, actor=seeded["actor"])
    assert provider_person.mapping_state == "verified"

    _import(
        db_session,
        punches=[
            punch(
                "evt-in-1",
                external_person_id="bio-smoke-1",
                occurred_at=SHIFT_START + timedelta(minutes=5),
                direction="in",
            )
        ],
        now=now,
    )

    # The raw source event is persisted immutably.
    stored = db_session.scalars(select(AttendancePunch)).all()
    assert [row.external_event_id for row in stored] == ["evt-in-1"]

    result = attendance_evaluation_service.evaluate_case(
        db_session, seeded["case"].id, evaluated_at=now
    )
    db_session.commit()

    assert result is not None
    evaluation = db_session.scalar(
        select(AttendanceEvaluation).where(
            AttendanceEvaluation.attendance_case_id == seeded["case"].id
        )
    )
    assert evaluation is not None
    assert evaluation.presence_state == "on_duty"
    # Inside the grace window, so no late minutes are attributed.
    assert (evaluation.late_minutes or 0) == 0


def test_late_arrival_records_minutes_without_changing_presence(seeded, db_session):
    """Late minutes are an orthogonal exception fact, not a presence downgrade."""
    employee = seeded["employee"]
    now = SHIFT_START + timedelta(hours=2)
    late_by = GRACE_MINUTES + 25

    _import(
        db_session,
        people=[person("bio-smoke-1", employee_code=employee.id)],
        now=now,
    )
    _map_identity(db_session, employee.id, actor=seeded["actor"])
    _import(
        db_session,
        punches=[
            punch(
                "evt-late-1",
                external_person_id="bio-smoke-1",
                occurred_at=SHIFT_START + timedelta(minutes=late_by),
                direction="in",
            )
        ],
        now=now,
    )

    attendance_evaluation_service.evaluate_case(db_session, seeded["case"].id, evaluated_at=now)
    db_session.commit()

    evaluation = db_session.scalar(
        select(AttendanceEvaluation).where(
            AttendanceEvaluation.attendance_case_id == seeded["case"].id
        )
    )
    assert evaluation.presence_state == "on_duty"
    assert evaluation.late_minutes == late_by - GRACE_MINUTES


def test_absence_lands_at_the_boundary_and_a_later_punch_replaces_it(seeded, db_session):
    """The site's rule: past the grace is late, twice the grace with no punch is absent.

    The absence is asserted the moment the boundary passes rather than held until
    the duty is over, so a supervisor sees the gap while the shift can still be
    covered. It is provisional on purpose: the person who walks in afterwards is a
    late arrival, and the newest revision says so.
    """
    employee = seeded["employee"]
    _import(db_session, people=[person("bio-smoke-1", employee_code=employee.id)], now=SHIFT_START)
    _map_identity(db_session, employee.id, actor=seeded["actor"])
    # A completed, punch-free window keeps freshness trustworthy.
    _import(db_session, punches=[], now=SHIFT_START + timedelta(minutes=5))

    def evaluate(at, punches=()):
        _import(db_session, punches=list(punches), now=at)
        attendance_evaluation_service.evaluate_case(db_session, seeded["case"].id, evaluated_at=at)
        db_session.commit()
        return db_session.scalar(
            select(AttendanceEvaluation)
            .where(AttendanceEvaluation.attendance_case_id == seeded["case"].id)
            .order_by(AttendanceEvaluation.revision.desc())
        )

    early = evaluate(SHIFT_START + timedelta(minutes=ABSENCE_AFTER_MINUTES - 5))
    assert (early.presence_state, early.reason_code) == (
        "scheduled",
        "SCHEDULED_BEFORE_ABSENCE_BOUNDARY",
    )

    absent = evaluate(SHIFT_START + timedelta(minutes=ABSENCE_AFTER_MINUTES + 5))
    assert (absent.presence_state, absent.reason_code) == ("absent", "NO_IN_AFTER_THRESHOLD")

    # The same person walks in an hour after being called absent. The absence
    # revision stays on the record; the effective verdict is a late arrival.
    arrived_at = SHIFT_START + timedelta(minutes=ABSENCE_AFTER_MINUTES + 60)
    late = evaluate(
        arrived_at + timedelta(minutes=5),
        punches=[
            punch(
                "evt-very-late-1",
                external_person_id="bio-smoke-1",
                occurred_at=arrived_at,
                direction="in",
            )
        ],
    )
    assert late.presence_state == "on_duty"
    assert late.late_minutes == ABSENCE_AFTER_MINUTES + 60 - GRACE_MINUTES
    assert late.revision > absent.revision


def test_stale_punch_freshness_suppresses_the_dashboard_judgment(seeded, db_session):
    """A stale punch stream withholds verified counts instead of lowering them."""
    import json as _json

    from app.db.models import AppSetting

    employee = seeded["employee"]
    db_session.add(AppSetting(key="workforce.stale_after_minutes", value=_json.dumps(30)))
    _import(db_session, people=[person("bio-smoke-1", employee_code=employee.id)], now=SHIFT_START)
    _map_identity(db_session, employee.id, actor=seeded["actor"])
    db_session.commit()

    scope = workforce_scope_service.WorkforceScope(
        entries=(workforce_scope_service.WorkforceScopeEntry(scope_kind="organization"),)
    )
    stale_now = SHIFT_START + timedelta(hours=4)
    snapshot = workforce_dashboard_service.get_workforce_snapshot(
        db_session,
        scope=scope,
        self_employee_id=None,
        include_aggregate=True,
        now=stale_now.replace(tzinfo=UTC),
    ).value

    assert snapshot["sync_health"]["punches"]["state"] in {"stale", "pending", "not_configured"}
    # Withheld, not silently zero.
    assert snapshot["current_shift"]["working"] is None


def test_later_sick_approval_appends_an_excused_revision_preserving_raw_punches(
    seeded, db_session
):
    """A retroactive Sick approval supersedes the judgment without deleting evidence."""
    employee = seeded["employee"]
    now = SHIFT_START + timedelta(hours=2)
    _import(db_session, people=[person("bio-smoke-1", employee_code=employee.id)], now=now)
    _map_identity(db_session, employee.id, actor=seeded["actor"])
    _import(
        db_session,
        punches=[
            punch(
                "evt-in-2",
                external_person_id="bio-smoke-1",
                occurred_at=SHIFT_START + timedelta(minutes=3),
                direction="in",
            )
        ],
        now=now,
    )
    attendance_evaluation_service.evaluate_case(db_session, seeded["case"].id, evaluated_at=now)
    db_session.commit()

    db_session.add(
        Leave(
            employee_id=employee.id,
            leave_type="Sick leave",
            status="Approved",
            start_date=OPERATIONAL_DATE,
            end_date=OPERATIONAL_DATE,
        )
    )
    db_session.commit()

    attendance_evaluation_service.evaluate_case(
        db_session, seeded["case"].id, evaluated_at=now + timedelta(minutes=30)
    )
    db_session.commit()

    revisions = db_session.scalars(
        select(AttendanceEvaluation)
        .where(AttendanceEvaluation.attendance_case_id == seeded["case"].id)
        .order_by(AttendanceEvaluation.revision)
    ).all()
    assert len(revisions) >= 2, "a changed source must append a revision, never rewrite one"
    assert revisions[-1].presence_state == "excused_leave"
    # The raw punch survives the excusing revision.
    assert db_session.scalars(select(AttendancePunch)).all() != []


def test_supervisor_scope_denies_an_employee_outside_the_assigned_unit(seeded, db_session):
    """A scoped supervisor never sees a person outside their resolved hierarchy."""
    supervisor = User(
        email="smoke-supervisor@test.ae", password_hash="x", role="manager", status="active"
    )
    db_session.add(supervisor)
    db_session.flush()
    db_session.add(
        UserWorkforceScope(
            user_id=supervisor.id,
            scope_kind="duty_unit",
            department="Operations",
            duty_unit="Gate B",
            created_by_user_id=seeded["actor"].id,
        )
    )
    outside = Employee(
        id="G-SMOKE-2",
        name_en="Other Unit Officer",
        name_ar="ضابط آخر",
        status="Active",
        department="Operations",
        duty_unit="Gate A",
    )
    db_session.add(outside)
    db_session.commit()

    scope = workforce_scope_service.resolve_workforce_scope(db_session, supervisor)
    assert (
        workforce_scope_service.scope_allows(
            scope,
            employee_id=outside.id,
            department=outside.department,
            duty_unit=outside.duty_unit,
            duty_post=None,
        )
        is False
    )
    assert (
        workforce_scope_service.scope_allows(
            scope,
            employee_id="G-SMOKE-3",
            department="Operations",
            duty_unit="Gate B",
            duty_post=None,
        )
        is True
    )


def _configure(db_session, *, actor: User, evaluation_start_at: datetime) -> None:
    settings_service.update_workforce_configuration(
        db_session,
        WorkforceConfiguration(
            integration_enabled=True,
            sync_interval_minutes=10,
            stale_after_minutes=90,
            initial_backfill_start_at=evaluation_start_at.replace(tzinfo=UTC),
            evaluation_start_at=evaluation_start_at.replace(tzinfo=UTC),
            nationality_fold_min_count=3,
            excusing_record_kinds=["annual", "sick"],
            provider_person_retention_days=3650,
            punch_retention_days=3650,
            attendance_retention_days=3650,
            duty_event_retention_days=3650,
            audit_retention_days=3650,
        ),
        actor=actor.email,
    )


def test_a_rostered_employee_who_never_punched_gets_a_case_and_an_absence(seeded, db_session):
    """The register has to show the person who did not turn up, not just the ones who did."""
    actor = seeded["actor"]
    occurrence = seeded["occurrence"]
    quiet = Employee(
        id="G-SMOKE-2",
        name_en="Quiet Officer",
        name_ar="ضابط صامت",
        status="Active",
        department="Operations",
        duty_unit="Gate A",
    )
    db_session.add(quiet)
    db_session.flush()
    db_session.add(
        WorkCrewMembership(
            crew_id=occurrence.crew_id,
            employee_id=quiet.id,
            effective_from=SHIFT_START - timedelta(days=7),
            created_by_user_id=actor.id,
            updated_by_user_id=actor.id,
        )
    )
    _configure(db_session, actor=actor, evaluation_start_at=SHIFT_START - timedelta(days=1))
    db_session.commit()

    # Absence is only assertable against a verified identity and a punch stream
    # that is fresh past the threshold, so both are established first.
    _import(db_session, people=[person("bio-smoke-1", employee_code=quiet.id)], now=SHIFT_START)
    _map_identity(db_session, quiet.id, actor=actor)
    now = SHIFT_END + timedelta(minutes=120)
    _import(db_session, punches=[], now=now)

    created = scheduler_service._materialize_scheduled_cases(db_session, now=now)
    db_session.commit()

    assert created == 1
    case = db_session.scalar(select(AttendanceCase).where(AttendanceCase.employee_id == quiet.id))
    assert case is not None
    assert case.scheduled_start_at == SHIFT_START
    evaluation = db_session.scalar(
        select(AttendanceEvaluation).where(AttendanceEvaluation.attendance_case_id == case.id)
    )
    assert evaluation is not None
    assert evaluation.presence_state == "absent"
    assert evaluation.reason_code == "NO_IN_AFTER_THRESHOLD"
    # The already-materialized case of the punching employee is untouched.
    assert (
        len(
            db_session.scalars(
                select(AttendanceCase).where(
                    AttendanceCase.employee_id == seeded["employee"].id
                )
            ).all()
        )
        == 1
    )


def test_materialization_is_dormant_until_a_configuration_exists(seeded, db_session):
    """No configuration means no evaluation boundary, so nothing may be judged."""
    assert scheduler_service._materialize_scheduled_cases(
        db_session, now=SHIFT_START + timedelta(hours=2)
    ) == 0


def test_directionless_punches_read_as_arrival_and_departure_once_the_duty_ends(
    seeded, db_session
):
    """This site's terminals report no in/out, so punch order carries the day.

    Mid-duty a single punch means the person is here and nothing more. When the
    window closes the earliest punch is read as the arrival and the latest as the
    departure, which is the only way late and early-exit minutes can exist on a
    provider that stamps every event ``punch_state 255``.
    """
    employee = seeded["employee"]
    late_by = GRACE_MINUTES + 20
    _import(db_session, people=[person("bio-smoke-1", employee_code=employee.id)], now=SHIFT_START)
    _map_identity(db_session, employee.id, actor=seeded["actor"])

    arrival = SHIFT_START + timedelta(minutes=late_by)
    mid_duty = SHIFT_START + timedelta(hours=4)
    _import(
        db_session,
        punches=[
            punch("evt-a", external_person_id="bio-smoke-1", occurred_at=arrival, direction=None)
        ],
        now=mid_duty,
    )
    running = attendance_evaluation_service.evaluate_case(
        db_session, seeded["case"].id, evaluated_at=mid_duty
    )
    db_session.commit()
    assert running is not None
    assert running.presence_state == "on_duty"
    assert running.reason_code == "PUNCH_RECORDED_DIRECTIONLESS"
    # Nothing is attributed while the duty runs: no late minutes, no departure.
    assert running.late_minutes is None
    assert running.final_out_at is None

    departure = SHIFT_END - timedelta(minutes=45)
    settled_at = SHIFT_END + timedelta(minutes=120)
    _import(
        db_session,
        punches=[
            punch("evt-b", external_person_id="bio-smoke-1", occurred_at=departure, direction=None)
        ],
        now=settled_at,
    )
    settled = attendance_evaluation_service.evaluate_case(
        db_session, seeded["case"].id, evaluated_at=settled_at
    )
    db_session.commit()

    assert settled is not None
    assert settled.presence_state == "completed"
    assert settled.reason_code == "PUNCH_ORDER_INFERRED"
    assert settled.late_minutes == late_by - GRACE_MINUTES
    # Left 45 minutes early against a 10-minute early-exit grace.
    assert settled.early_exit_minutes == 35
    assert settled.missing_checkout is False
    assert settled.last_direction is None


def test_a_shift_that_has_not_started_is_on_the_register_without_a_verdict(seeded, db_session):
    """Every shift of the day belongs on the register, including the next one.

    Materializing only started shifts left a site running three rotations able to
    see one of them at a time.
    """
    actor = seeded["actor"]
    occurrence = seeded["occurrence"]
    night = WorkShiftDefinition(
        code="smoke-night", start_local_time=time(21, 0), duration_minutes=480
    )
    db_session.add(night)
    db_session.flush()
    db_session.add(
        WorkShiftOccurrence(
            crew_id=occurrence.crew_id,
            crew_schedule_id=occurrence.crew_schedule_id,
            shift_definition_id=night.id,
            starts_at=SHIFT_START + timedelta(hours=13),
            ends_at=SHIFT_START + timedelta(hours=21),
            operational_date=OPERATIONAL_DATE,
            pattern_code_snapshot=occurrence.pattern_code_snapshot,
            crew_schedule_version_snapshot=occurrence.crew_schedule_version_snapshot,
            source_anchor_at=occurrence.source_anchor_at,
        )
    )
    _configure(db_session, actor=actor, evaluation_start_at=SHIFT_START - timedelta(days=1))
    db_session.commit()
    # A verified identity exists, so the reading is about timing and nothing else.
    _import(
        db_session,
        people=[person("bio-smoke-1", employee_code=seeded["employee"].id)],
        now=SHIFT_START,
    )
    _map_identity(db_session, seeded["employee"].id, actor=actor)

    # Early in the morning shift, hours before the night shift opens.
    scheduler_service._materialize_scheduled_cases(db_session, now=SHIFT_START + timedelta(hours=1))
    db_session.commit()

    codes = {
        case.shift_code_snapshot
        for case in db_session.scalars(
            select(AttendanceCase).where(AttendanceCase.employee_id == seeded["employee"].id)
        )
    }
    assert codes == {"smoke-morning", "smoke-night"}

    upcoming = db_session.scalar(
        select(AttendanceCase).where(
            AttendanceCase.employee_id == seeded["employee"].id,
            AttendanceCase.shift_code_snapshot == "smoke-night",
        )
    )
    assert upcoming is not None
    evaluation = db_session.scalar(
        select(AttendanceEvaluation).where(
            AttendanceEvaluation.attendance_case_id == upcoming.id
        )
    )
    assert evaluation is not None
    assert evaluation.presence_state == "scheduled"
    assert evaluation.reason_code == "SCHEDULED_BEFORE_ABSENCE_BOUNDARY"


def test_office_to_company_move_replaces_future_attendance_only(db_session):
    """G3019: an Office->Company duty-unit edit must follow the crew, not just the label.

    A raw ``duty_unit`` edit through ``update_employee`` used to change only the
    ``Employee`` row: ``WorkCrewMembership`` kept the person on the Office
    rotation forever, so the scheduler kept minting Office shifts, while any
    case that WAS regenerated picked up the new (Company) hierarchy from the
    employee row - Office shift, Company label, on the same case. An
    already-started shift is a historical fact; only shifts from the next
    configured Dubai boundary onward may move.
    """
    fixture = build_attendance_day(
        db_session,
        operational_date=date(2026, 8, 17),
        unit="الدوام الرسمي",
        posts=(("البوابة الرئيسية", 2),),
    )
    actor = fixture.admin
    target, office_control = fixture.employees
    trusted_scope = organization_scope()

    crew_2 = db_session.scalar(select(WorkCrew).where(WorkCrew.code == "crew_2"))
    assert crew_2 is not None

    # A stale baseline pointing at Office - the pre-fix bug also let this kind
    # of duty event outrank any later crew-driven hierarchy.
    db_session.add(
        DutyAssignmentEvent(
            employee_id=target.id,
            event_type="baseline",
            to_department=target.department,
            to_unit=target.duty_unit,
            to_post=target.duty_post,
            effective_at=datetime(2026, 8, 1, 0, 0),
            reason="baseline",
        )
    )
    db_session.flush()
    _configure(db_session, actor=actor, evaluation_start_at=datetime(2026, 8, 1, 0, 0))
    db_session.commit()

    company_control = Employee(
        id="G-9100",
        name_en="Company Control",
        name_ar="ضابط السرية",
        status="Active",
        department="الأمن",
        duty_unit="السرية الثانية",
        duty_post="البوابة الرئيسية",
    )
    db_session.add(company_control)
    db_session.flush()
    workforce_schedule_service.create_crew_membership(
        db_session,
        scope=trusted_scope,
        if_match=workforce_schedule_service.crew_membership_collection_etag(
            list(
                db_session.scalars(
                    select(WorkCrewMembership).where(WorkCrewMembership.crew_id == crew_2.id)
                )
            )
        ),
        employee_id=company_control.id,
        crew_id=crew_2.id,
        effective_from=local(date(2026, 8, 1), time(5, 0)),
        actor_user_id=actor.id,
    )

    # Occurrences for both crews across the whole test window; crew_2's own
    # schedule only starts at its 18 Aug anchor.
    workforce_schedule_service.generate_occurrences(
        db_session,
        scope=trusted_scope,
        crew_id=fixture.crew_id,
        starts_at=local(date(2026, 8, 14), time(0, 0)),
        ends_at=local(date(2026, 8, 20), time(0, 0)),
    )
    workforce_schedule_service.generate_occurrences(
        db_session,
        scope=trusted_scope,
        crew_id=crew_2.id,
        starts_at=local(date(2026, 8, 14), time(0, 0)),
        ends_at=local(date(2026, 8, 20), time(0, 0)),
    )
    db_session.flush()

    # The target's 18 Aug Office projection, materialized and evaluated as a
    # prediction BEFORE the move - the exact stale row a fixed source must not
    # leave behind.
    attendance_evaluation_service.materialize_scheduled_cases(
        db_session,
        employee_id=target.id,
        horizon=local(date(2026, 8, 18), time(23, 59)),
        evaluation_start_at=datetime(2026, 8, 1, 0, 0),
    )
    db_session.flush()
    future_office_case = db_session.scalar(
        select(AttendanceCase).where(
            AttendanceCase.employee_id == target.id,
            AttendanceCase.operational_date == date(2026, 8, 18),
        )
    )
    assert future_office_case is not None
    future_office_case_id = future_office_case.id
    attendance_evaluation_service.evaluate_case(
        db_session,
        future_office_case_id,
        evaluated_at=local(date(2026, 8, 17), time(10, 0)),
        evaluation_start_at=datetime(2026, 8, 1, 0, 0),
    )
    db_session.commit()

    started_case = db_session.scalar(
        select(AttendanceCase).where(
            AttendanceCase.employee_id == target.id,
            AttendanceCase.operational_date == date(2026, 8, 17),
        )
    )
    assert started_case is not None
    started_case_id = started_case.id
    started_snapshot = (
        started_case.crew_code_snapshot,
        started_case.duty_unit_snapshot,
        started_case.scheduled_start_at,
    )
    started_evaluations_before = [
        (row.revision, row.presence_state, row.reason_code)
        for row in db_session.scalars(
            select(AttendanceEvaluation)
            .where(AttendanceEvaluation.attendance_case_id == started_case_id)
            .order_by(AttendanceEvaluation.revision)
        )
    ]
    assert started_evaluations_before  # the started shift already has a verdict

    # Freeze the clock to 17 Aug 10:00 Dubai - mid-morning, well inside the
    # started Office shift. The next configured boundary is 13:00.
    frozen_instant = local(date(2026, 8, 17), time(10, 0))

    class _FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return frozen_instant if tz is None else frozen_instant.astimezone(tz)

    monkeypatch = pytest.MonkeyPatch()
    try:
        monkeypatch.setattr(employee_service, "datetime", _FrozenDateTime, raising=False)
        monkeypatch.setattr(
            workforce_schedule_service,
            "_now",
            lambda: frozen_instant.astimezone(UTC).replace(tzinfo=None),
            raising=False,
        )
        employee_service.update_employee(
            db_session,
            target.id,
            EmployeeUpdate(duty_unit="السرية الثانية", duty_post="البوابة الرئيسية"),
        )
    finally:
        monkeypatch.undo()

    # A shift that had already started is untouched by the move.
    unchanged = db_session.get(AttendanceCase, started_case_id)
    assert unchanged is not None
    assert (
        unchanged.crew_code_snapshot,
        unchanged.duty_unit_snapshot,
        unchanged.scheduled_start_at,
    ) == started_snapshot
    started_evaluations_after = [
        (row.revision, row.presence_state, row.reason_code)
        for row in db_session.scalars(
            select(AttendanceEvaluation)
            .where(AttendanceEvaluation.attendance_case_id == started_case_id)
            .order_by(AttendanceEvaluation.revision)
        )
    ]
    assert started_evaluations_after == started_evaluations_before

    # The stale future Office projection must not survive the move.
    assert db_session.get(AttendanceCase, future_office_case_id) is None

    def _rows_for(employee_id: str, day: date) -> list[dict]:
        return [
            row
            for row in workforce_read_service.list_attendance_day(
                db_session, scope=trusted_scope, operational_date=day
            )
            if row["employee_id"] == employee_id
        ]

    created_first = scheduler_service._materialize_scheduled_cases(
        db_session, now=local(date(2026, 8, 18), time(23, 59))
    )
    db_session.commit()
    assert created_first > 0

    target_aug18 = _rows_for(target.id, date(2026, 8, 18))
    assert [(r["crew_code"], r["shift_code"]) for r in target_aug18] == [("crew_2", "noon")]
    assert target_aug18[0]["duty_unit"] == "السرية الثانية"
    assert target_aug18[0]["duty_post"] == "البوابة الرئيسية"

    office_control_aug18 = _rows_for(office_control.id, date(2026, 8, 18))
    assert [(r["crew_code"], r["shift_code"]) for r in office_control_aug18] == [
        ("office", "office_day")
    ]

    company_control_aug18 = _rows_for(company_control.id, date(2026, 8, 18))
    assert [(r["crew_code"], r["shift_code"]) for r in company_control_aug18] == [
        ("crew_2", "noon")
    ]

    created_second = scheduler_service._materialize_scheduled_cases(
        db_session, now=local(date(2026, 8, 19), time(23, 59))
    )
    db_session.commit()
    assert created_second > 0

    target_aug19 = _rows_for(target.id, date(2026, 8, 19))
    assert sorted((r["crew_code"], r["shift_code"]) for r in target_aug19) == [
        ("crew_2", "morning"),
        ("crew_2", "night"),
    ]
    for row in target_aug19:
        assert row["duty_unit"] == "السرية الثانية"
        assert row["duty_post"] == "البوابة الرئيسية"

    office_control_aug19 = _rows_for(office_control.id, date(2026, 8, 19))
    assert [(r["crew_code"], r["shift_code"]) for r in office_control_aug19] == [
        ("office", "office_day")
    ]

    company_control_aug19 = _rows_for(company_control.id, date(2026, 8, 19))
    assert sorted((r["crew_code"], r["shift_code"]) for r in company_control_aug19) == [
        ("crew_2", "morning"),
        ("crew_2", "night"),
    ]

    target_case_ids_before = sorted(
        c.id
        for c in db_session.scalars(
            select(AttendanceCase).where(AttendanceCase.employee_id == target.id)
        )
    )

    # A second run at the same instant must not duplicate memberships or cases.
    created_repeat = scheduler_service._materialize_scheduled_cases(
        db_session, now=local(date(2026, 8, 19), time(23, 59))
    )
    db_session.commit()
    assert created_repeat == 0
    target_case_ids_after = sorted(
        c.id
        for c in db_session.scalars(
            select(AttendanceCase).where(AttendanceCase.employee_id == target.id)
        )
    )
    assert target_case_ids_after == target_case_ids_before
    target_memberships = list(
        db_session.scalars(
            select(WorkCrewMembership).where(WorkCrewMembership.employee_id == target.id)
        )
    )
    assert len(target_memberships) == 2
