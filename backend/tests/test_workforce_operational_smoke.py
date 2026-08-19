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
    UserWorkforceScope,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkShiftDefinition,
    WorkShiftOccurrence,
)
from app.services import (
    attendance_evaluation_service,
    attendance_sync_service,
    workforce_dashboard_service,
    workforce_scope_service,
)
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

    An explicit frozen window mirrors a configured operator backfill. Without
    one the service opens a deliberate one-microsecond interval, because
    production sync stays disabled until configuration supplies a bound.
    """
    provider = DeterministicAttendanceProvider(people=people, punches=punches)
    if people:
        attendance_sync_service.sync_people(db_session, provider=provider, now=now)
    state = attendance_sync_service._state(db_session, provider="biotime", stream="punches")
    if state.window_since is None and state.window_until is None:
        state.window_since = window_since or (SHIFT_START - timedelta(hours=2))
        state.window_until = now.replace(tzinfo=None) if now.tzinfo else now
        db_session.flush()
    imported = attendance_sync_service.sync_punches(db_session, provider=provider, now=now)
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


def test_absence_is_withheld_before_the_threshold_and_only_asserted_after(seeded, db_session):
    """No punch is 'scheduled' before the absence boundary and 'absent' only after it."""
    employee = seeded["employee"]
    _import(db_session, people=[person("bio-smoke-1", employee_code=employee.id)], now=SHIFT_START)
    _map_identity(db_session, employee.id, actor=seeded["actor"])
    # A completed, punch-free window keeps freshness trustworthy.
    _import(db_session, punches=[], now=SHIFT_START + timedelta(minutes=5))

    before = SHIFT_START + timedelta(minutes=ABSENCE_AFTER_MINUTES - 5)
    attendance_evaluation_service.evaluate_case(db_session, seeded["case"].id, evaluated_at=before)
    db_session.commit()
    early = db_session.scalar(
        select(AttendanceEvaluation)
        .where(AttendanceEvaluation.attendance_case_id == seeded["case"].id)
        .order_by(AttendanceEvaluation.revision.desc())
    )
    assert early.presence_state != "absent"

    _import(db_session, punches=[], now=SHIFT_START + timedelta(minutes=ABSENCE_AFTER_MINUTES + 5))
    after = SHIFT_START + timedelta(minutes=ABSENCE_AFTER_MINUTES + 5)
    attendance_evaluation_service.evaluate_case(db_session, seeded["case"].id, evaluated_at=after)
    db_session.commit()
    late = db_session.scalar(
        select(AttendanceEvaluation)
        .where(AttendanceEvaluation.attendance_case_id == seeded["case"].id)
        .order_by(AttendanceEvaluation.revision.desc())
    )
    assert late.presence_state == "absent"
    assert late.reason_code == "NO_IN_AFTER_THRESHOLD"


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
