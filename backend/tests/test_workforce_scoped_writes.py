"""Direct-service scope and optimistic-concurrency contracts for workforce writes."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pytest
from sqlalchemy import func, select

from app.api.errors import AppError, ConflictError, NotFoundError, ValidationFailedError
from app.db.models import AuditLog, Employee
from app.db.workforce_models import (
    AttendanceEvaluationQueue,
    AttendanceProviderPerson,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkRotationStep,
    WorkShiftDefinition,
    WorkShiftOccurrence,
    WorkShiftOverride,
    WorkStaffingRequirement,
)
from app.services import workforce_admin_service, workforce_schedule_service
from app.services.workforce_access_service import organization_scope
from app.services.workforce_etag import etag_for, row_etag
from app.services.workforce_scope_service import WorkforceScope, WorkforceScopeEntry

START = datetime(2026, 9, 7, 1)  # 05:00 Asia/Dubai
END = START + timedelta(hours=8)


def _scope(*, department: str = "Operations") -> WorkforceScope:
    return WorkforceScope(
        entries=(WorkforceScopeEntry(scope_kind="department", department=department),)
    )


def _employee(db, employee_id: str, department: str) -> Employee:
    row = Employee(
        id=employee_id,
        name_en=employee_id,
        name_ar="موظف",
        status="Active",
        department=department,
        duty_unit=f"{department} Unit",
    )
    db.add(row)
    db.flush()
    return row


def _roster(db, admin_user) -> tuple[WorkCrew, WorkRotationPattern, WorkShiftDefinition]:
    shift = WorkShiftDefinition(
        code="scoped-morning",
        start_local_time=time(5),
        duration_minutes=480,
    )
    pattern = WorkRotationPattern(
        code="scoped-pattern",
        name="Scoped pattern",
        cycle_minutes=1440,
        timezone="Asia/Dubai",
    )
    crew = WorkCrew(code="scoped-crew", name_en="Scoped crew")
    db.add_all((shift, pattern, crew))
    db.flush()
    db.add(
        WorkRotationStep(
            pattern_id=pattern.id,
            shift_definition_id=shift.id,
            start_offset_minutes=0,
        )
    )
    db.flush()
    return crew, pattern, shift


def _policy_payload() -> dict[str, object]:
    return {
        "shift_definition_id": None,
        "grace_minutes": 10,
        "absence_after_minutes": 20,
        "early_exit_grace_minutes": 5,
        "match_before_minutes": 30,
        "match_after_minutes": 60,
        "require_checkout": True,
        "effective_from": date(2026, 9, 1),
        "effective_to": None,
    }


def _side_effect_counts(db) -> tuple[int, int, int]:
    return (
        db.scalar(select(func.count()).select_from(WorkShiftOverride)) or 0,
        db.scalar(select(func.count()).select_from(AuditLog)) or 0,
        db.scalar(select(func.count()).select_from(AttendanceEvaluationQueue)) or 0,
    )


def test_department_scope_cannot_create_update_or_retire_global_crews(
    db_session, admin_user
) -> None:
    crew = WorkCrew(code="existing", name_en="Existing")
    db_session.add(crew)
    db_session.commit()
    before = db_session.scalar(select(func.count()).select_from(AuditLog))

    with pytest.raises(AppError, match="Organization workforce scope") as created:
        workforce_admin_service.create_crew(
            db_session,
            scope=_scope(),
            if_match=etag_for(
                [
                    {
                        "id": crew.id,
                        "updated_at": crew.updated_at,
                        "created_at": crew.created_at,
                    }
                ]
            ),
            payload={"code": "denied", "name_en": "Denied", "active": True},
            actor=admin_user,
        )
    assert created.value.code == "FORBIDDEN"

    for operation in (
        lambda: workforce_admin_service.update_crew(
            db_session,
            scope=_scope(),
            crew_id=crew.id,
            payload={"name_en": "Changed"},
            if_match=row_etag(crew),
            actor=admin_user,
        ),
        lambda: workforce_admin_service.retire_crew(
            db_session,
            scope=_scope(),
            crew_id=crew.id,
            if_match=row_etag(crew),
            actor=admin_user,
        ),
    ):
        with pytest.raises(AppError) as denied:
            operation()
        assert denied.value.code == "FORBIDDEN"

    with pytest.raises(ConflictError):
        workforce_admin_service.update_crew(
            db_session,
            scope=organization_scope(),
            crew_id=crew.id,
            payload={"name_en": "Stale change"},
            if_match='"stale"',
            actor=admin_user,
        )

    db_session.flush()
    assert crew.name_en == "Existing"
    assert crew.active is True
    assert db_session.scalar(select(func.count()).select_from(WorkCrew)) == 1
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == before


def test_crew_lifecycle_changes_fields_and_audits_until_caller_rolls_back(
    db_session, admin_user
) -> None:
    scope = organization_scope()
    crew = workforce_admin_service.create_crew(
        db_session,
        scope=scope,
        if_match=workforce_admin_service.crew_collection_etag([]),
        payload={
            "code": "lifecycle",
            "name_en": "Lifecycle",
            "name_ar": "دورة",
            "active": True,
        },
        actor=admin_user,
    )
    workforce_admin_service.update_crew(
        db_session,
        scope=scope,
        crew_id=crew.id,
        payload={"name_en": "Updated lifecycle"},
        if_match=row_etag(crew),
        actor=admin_user,
    )
    db_session.flush()
    workforce_admin_service.retire_crew(
        db_session,
        scope=scope,
        crew_id=crew.id,
        if_match=row_etag(crew),
        actor=admin_user,
    )
    db_session.flush()

    assert crew.code == "lifecycle"
    assert crew.name_en == "Updated lifecycle"
    assert crew.name_ar == "دورة"
    assert crew.active is False
    assert list(
        db_session.scalars(
            select(AuditLog.action).where(AuditLog.entity_type == "work_crew").order_by(AuditLog.id)
        )
    ) == [
        "workforce.crew.created",
        "workforce.crew.updated",
        "workforce.crew.retired",
    ]

    db_session.rollback()
    assert db_session.scalar(select(WorkCrew.id).where(WorkCrew.code == "lifecycle")) is None
    assert db_session.scalar(select(AuditLog.id).limit(1)) is None


def test_department_scope_cannot_create_or_approve_global_attendance_policy(
    db_session, admin_user
) -> None:
    policy = WorkAttendancePolicy(**_policy_payload(), created_by_user_id=admin_user.id)
    db_session.add(policy)
    db_session.commit()

    with pytest.raises(AppError) as create_denied:
        workforce_admin_service.create_attendance_policy(
            db_session,
            scope=_scope(),
            payload=_policy_payload(),
            actor=admin_user,
        )
    assert create_denied.value.code == "FORBIDDEN"

    with pytest.raises(AppError) as approve_denied:
        workforce_admin_service.approve_attendance_policy(
            db_session,
            scope=_scope(),
            policy_id=policy.id,
            if_match=row_etag(policy),
            actor=admin_user,
        )
    assert approve_denied.value.code == "FORBIDDEN"
    with pytest.raises(ConflictError):
        workforce_admin_service.approve_attendance_policy(
            db_session,
            scope=organization_scope(),
            policy_id=policy.id,
            if_match='"stale"',
            actor=admin_user,
        )
    db_session.flush()
    assert policy.approved_at is None
    assert db_session.scalar(select(func.count()).select_from(WorkAttendancePolicy)) == 1
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_attendance_policy_lifecycle_changes_fields_and_audits_until_caller_rollback(
    db_session, admin_user
) -> None:
    approved_at = datetime(2026, 9, 2, 8, 30)
    policy = workforce_admin_service.create_attendance_policy(
        db_session,
        scope=organization_scope(),
        payload=_policy_payload(),
        actor=admin_user,
    )
    workforce_admin_service.approve_attendance_policy(
        db_session,
        scope=organization_scope(),
        policy_id=policy.id,
        if_match=row_etag(policy),
        actor=admin_user,
        now=approved_at,
    )
    db_session.flush()

    assert policy.grace_minutes == 10
    assert policy.absence_after_minutes == 20
    assert policy.require_checkout is True
    assert policy.approved_by_user_id == admin_user.id
    assert policy.approved_at == approved_at
    assert list(
        db_session.scalars(
            select(AuditLog.action)
            .where(AuditLog.entity_type == "work_attendance_policy")
            .order_by(AuditLog.id)
        )
    ) == [
        "workforce.attendance_policy.created",
        "workforce.attendance_policy.approved",
    ]
    assert db_session.scalar(select(AttendanceEvaluationQueue.id).limit(1)) is None

    db_session.rollback()
    assert db_session.scalar(select(WorkAttendancePolicy.id).limit(1)) is None
    assert db_session.scalar(select(AuditLog.id).limit(1)) is None


def test_department_scope_cannot_change_provider_mapping(db_session, admin_user) -> None:
    employee = _employee(db_session, "provider-target", "Operations")
    person = AttendanceProviderPerson(
        provider="biotime",
        external_person_id="provider-person",
        mapping_state="unmapped",
    )
    db_session.add(person)
    db_session.commit()

    with pytest.raises(AppError) as denied:
        workforce_admin_service.update_provider_mapping(
            db_session,
            scope=_scope(),
            person_id=person.id,
            employee_id=employee.id,
            mapping_state="verified",
            if_match=row_etag(
                person,
                extra={
                    "mapping_state": person.mapping_state,
                    "employee_id": person.employee_id,
                },
            ),
            actor=admin_user,
        )

    assert denied.value.code == "FORBIDDEN"
    with pytest.raises(ConflictError):
        workforce_admin_service.update_provider_mapping(
            db_session,
            scope=organization_scope(),
            person_id=person.id,
            employee_id=employee.id,
            mapping_state="verified",
            if_match='"stale"',
            actor=admin_user,
        )
    db_session.flush()
    assert person.mapping_state == "unmapped"
    assert person.employee_id is None
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_provider_mapping_success_is_audited_and_caller_can_roll_it_back(
    db_session, admin_user
) -> None:
    employee = _employee(db_session, "mapped-target", "Operations")
    person = AttendanceProviderPerson(
        provider="biotime",
        external_person_id="mapped-person",
        mapping_state="unmapped",
    )
    db_session.add(person)
    db_session.commit()
    verified_at = datetime(2026, 9, 2, 9)

    workforce_admin_service.update_provider_mapping(
        db_session,
        scope=organization_scope(),
        person_id=person.id,
        employee_id=employee.id,
        mapping_state="verified",
        if_match=row_etag(
            person,
            extra={
                "mapping_state": person.mapping_state,
                "employee_id": person.employee_id,
            },
        ),
        actor=admin_user,
        now=verified_at,
    )
    db_session.flush()

    assert person.employee_id == employee.id
    assert person.mapping_state == "verified"
    assert person.verified_by_user_id == admin_user.id
    assert person.verified_at == verified_at
    assert list(db_session.scalars(select(AuditLog.action))) == [
        "workforce.provider_mapping.updated"
    ]
    assert db_session.scalar(select(AttendanceEvaluationQueue.id).limit(1)) is None

    db_session.rollback()
    db_session.refresh(person)
    assert person.employee_id is None
    assert person.mapping_state == "unmapped"
    assert person.verified_by_user_id is None
    assert person.verified_at is None
    assert db_session.scalar(select(AuditLog.id).limit(1)) is None


def test_department_scope_cannot_create_or_replace_global_schedule(db_session, admin_user) -> None:
    crew, pattern, _shift = _roster(db_session, admin_user)
    current = WorkCrewSchedule(
        crew_id=crew.id,
        pattern_id=pattern.id,
        anchor_at=START,
        effective_from=START,
        version=1,
        created_by_user_id=admin_user.id,
    )
    db_session.add(current)
    db_session.commit()

    with pytest.raises(AppError) as create_denied:
        workforce_schedule_service.create_crew_schedule(
            db_session,
            scope=_scope(),
            if_match=etag_for(
                [
                    {
                        "id": current.id,
                        "version": current.version,
                        "updated_at": current.updated_at,
                        "created_at": current.created_at,
                    }
                ]
            ),
            crew_id=crew.id,
            pattern_id=pattern.id,
            anchor_at=START + timedelta(days=2),
            effective_from=START + timedelta(days=2),
            current_user=admin_user,
        )
    assert create_denied.value.code == "FORBIDDEN"

    with pytest.raises(AppError) as replace_denied:
        workforce_schedule_service.replace_crew_schedule(
            db_session,
            scope=_scope(),
            crew_id=crew.id,
            schedule_id=current.id,
            if_match=row_etag(current),
            pattern_id=pattern.id,
            anchor_at=START + timedelta(days=1),
            effective_from=START + timedelta(days=1),
            current_user=admin_user,
            now=START,
        )
    assert replace_denied.value.code == "FORBIDDEN"
    with pytest.raises(ConflictError):
        workforce_schedule_service.replace_crew_schedule(
            db_session,
            scope=organization_scope(),
            crew_id=crew.id,
            schedule_id=current.id,
            if_match='"stale"',
            pattern_id=pattern.id,
            anchor_at=START + timedelta(days=1),
            effective_from=START + timedelta(days=1),
            current_user=admin_user,
            now=START,
        )
    db_session.flush()
    assert current.effective_to is None
    assert db_session.scalar(select(func.count()).select_from(WorkCrewSchedule)) == 1
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_occurrence_generation_requires_explicit_organization_scope(db_session, admin_user) -> None:
    crew, pattern, _shift = _roster(db_session, admin_user)
    schedule = WorkCrewSchedule(
        crew_id=crew.id,
        pattern_id=pattern.id,
        anchor_at=START,
        effective_from=START,
        version=1,
        created_by_user_id=admin_user.id,
    )
    db_session.add(schedule)
    db_session.commit()

    with pytest.raises(AppError) as denied:
        workforce_schedule_service.generate_occurrences(
            db_session,
            scope=_scope(),
            crew_id=crew.id,
            starts_at=START,
            ends_at=START + timedelta(days=1),
        )

    assert denied.value.code == "FORBIDDEN"
    db_session.flush()
    assert db_session.scalar(select(func.count()).select_from(WorkShiftOccurrence)) == 0


def test_schedule_create_preserves_target_etag_then_window_error_precedence(
    db_session, admin_user
) -> None:
    crew, pattern, _shift = _roster(db_session, admin_user)
    db_session.commit()
    organization = organization_scope()
    invalid_end = START - timedelta(hours=1)

    with pytest.raises(NotFoundError) as missing:
        workforce_schedule_service.create_crew_schedule(
            db_session,
            scope=organization,
            if_match=None,
            crew_id=crew.id + 100,
            pattern_id=pattern.id,
            anchor_at=START,
            effective_from=START,
            effective_to=invalid_end,
            current_user=admin_user,
        )
    assert missing.value.code == "WORKFORCE_CREW_NOT_FOUND"

    crew.active = False
    db_session.commit()
    with pytest.raises(ValidationFailedError) as inactive:
        workforce_schedule_service.create_crew_schedule(
            db_session,
            scope=organization,
            if_match=None,
            crew_id=crew.id,
            pattern_id=pattern.id,
            anchor_at=START,
            effective_from=START,
            effective_to=invalid_end,
            current_user=admin_user,
        )
    assert inactive.value.code == "WORKFORCE_CREW_INACTIVE"

    crew.active = True
    db_session.commit()
    with pytest.raises(ConflictError):
        workforce_schedule_service.create_crew_schedule(
            db_session,
            scope=organization,
            if_match=None,
            crew_id=crew.id,
            pattern_id=pattern.id,
            anchor_at=START,
            effective_from=START,
            effective_to=invalid_end,
            current_user=admin_user,
        )

    with pytest.raises(ValueError, match="half-open and non-empty"):
        workforce_schedule_service.create_crew_schedule(
            db_session,
            scope=organization,
            if_match=workforce_schedule_service.crew_schedule_collection_etag(
                list(
                    db_session.scalars(
                        select(WorkCrewSchedule).where(WorkCrewSchedule.crew_id == crew.id)
                    )
                )
            ),
            crew_id=crew.id,
            pattern_id=pattern.id,
            anchor_at=START,
            effective_from=START,
            effective_to=invalid_end,
            current_user=admin_user,
        )

    db_session.flush()
    assert db_session.scalar(select(func.count()).select_from(WorkCrewSchedule)) == 0


def test_membership_create_and_end_authorize_employee_from_persisted_rows(
    db_session, admin_user
) -> None:
    crew, _pattern, _shift = _roster(db_session, admin_user)
    foreign = _employee(db_session, "foreign-member", "Finance")
    membership = WorkCrewMembership(
        crew_id=crew.id,
        employee_id=foreign.id,
        effective_from=START,
        created_by_user_id=admin_user.id,
        updated_by_user_id=admin_user.id,
    )
    db_session.add(membership)
    db_session.commit()

    visible_collection_etag = etag_for([])
    with pytest.raises(AppError) as create_denied:
        workforce_schedule_service.create_crew_membership(
            db_session,
            scope=_scope(),
            if_match=visible_collection_etag,
            employee_id=foreign.id,
            crew_id=crew.id,
            effective_from=START + timedelta(days=2),
            current_user=admin_user,
        )
    assert create_denied.value.code == "FORBIDDEN"

    with pytest.raises(AppError) as end_denied:
        workforce_schedule_service.end_crew_membership(
            db_session,
            scope=_scope(),
            crew_id=crew.id,
            membership_id=membership.id,
            if_match=row_etag(membership),
            effective_to=START + timedelta(days=1),
            end_reason="Denied",
            current_user=admin_user,
        )
    assert end_denied.value.code == "FORBIDDEN"
    with pytest.raises(ConflictError):
        workforce_schedule_service.end_crew_membership(
            db_session,
            scope=organization_scope(),
            crew_id=crew.id,
            membership_id=membership.id,
            if_match='"stale"',
            effective_to=START + timedelta(days=1),
            end_reason="Stale",
            current_user=admin_user,
        )
    db_session.flush()
    assert membership.effective_to is None
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 0
    assert db_session.scalar(select(func.count()).select_from(AttendanceEvaluationQueue)) == 0


def test_membership_end_changes_fields_and_stages_audit_and_queue_until_rollback(
    db_session, admin_user
) -> None:
    crew, _pattern, _shift = _roster(db_session, admin_user)
    employee = _employee(db_session, "member-end-success", "Operations")
    membership = WorkCrewMembership(
        crew_id=crew.id,
        employee_id=employee.id,
        effective_from=START,
        created_by_user_id=admin_user.id,
        updated_by_user_id=admin_user.id,
    )
    db_session.add(membership)
    db_session.commit()
    boundary = START + timedelta(days=1)

    workforce_schedule_service.end_crew_membership(
        db_session,
        scope=_scope(),
        crew_id=crew.id,
        membership_id=membership.id,
        if_match=row_etag(membership),
        effective_to=boundary,
        end_reason="Transferred",
        current_user=admin_user,
    )
    db_session.flush()

    assert membership.effective_to == boundary
    assert membership.end_reason == "Transferred"
    assert membership.updated_by_user_id == admin_user.id
    assert list(db_session.scalars(select(AuditLog.action))) == ["workforce.membership.ended"]
    queue = db_session.scalar(select(AttendanceEvaluationQueue))
    assert queue is not None
    assert queue.employee_id == employee.id
    assert queue.reason_codes == ["CREW_MEMBERSHIP_CHANGED"]

    db_session.rollback()
    db_session.refresh(membership)
    assert membership.effective_to is None
    assert membership.end_reason is None
    assert db_session.scalar(select(AuditLog.id).limit(1)) is None
    assert db_session.scalar(select(AttendanceEvaluationQueue.id).limit(1)) is None


def test_membership_create_preserves_target_etag_then_window_error_precedence(
    db_session, admin_user
) -> None:
    crew, _pattern, _shift = _roster(db_session, admin_user)
    employee = _employee(db_session, "allowed-member", "Operations")
    db_session.commit()
    scope = _scope()

    with pytest.raises(NotFoundError) as missing_employee:
        workforce_schedule_service.create_crew_membership(
            db_session,
            scope=scope,
            if_match=None,
            employee_id="missing",
            crew_id=crew.id,
            effective_from=END,
            effective_to=START,
            current_user=admin_user,
        )
    assert missing_employee.value.code == "WORKFORCE_EMPLOYEE_NOT_FOUND"

    with pytest.raises(NotFoundError) as missing_crew:
        workforce_schedule_service.create_crew_membership(
            db_session,
            scope=scope,
            if_match=None,
            employee_id=employee.id,
            crew_id=crew.id + 100,
            effective_from=END,
            effective_to=START,
            current_user=admin_user,
        )
    assert missing_crew.value.code == "WORKFORCE_CREW_NOT_FOUND"

    crew.active = False
    db_session.commit()
    with pytest.raises(ValidationFailedError) as inactive:
        workforce_schedule_service.create_crew_membership(
            db_session,
            scope=scope,
            if_match=None,
            employee_id=employee.id,
            crew_id=crew.id,
            effective_from=END,
            effective_to=START,
            current_user=admin_user,
        )
    assert inactive.value.code == "WORKFORCE_CREW_INACTIVE"

    crew.active = True
    db_session.commit()
    with pytest.raises(ConflictError):
        workforce_schedule_service.create_crew_membership(
            db_session,
            scope=scope,
            if_match=None,
            employee_id=employee.id,
            crew_id=crew.id,
            effective_from=END,
            effective_to=START,
            current_user=admin_user,
        )

    with pytest.raises(ValueError, match="half-open and non-empty"):
        workforce_schedule_service.create_crew_membership(
            db_session,
            scope=scope,
            if_match=workforce_schedule_service.crew_membership_collection_etag(
                list(
                    db_session.scalars(
                        select(WorkCrewMembership).where(WorkCrewMembership.crew_id == crew.id)
                    )
                )
            ),
            employee_id=employee.id,
            crew_id=crew.id,
            effective_from=END,
            effective_to=START,
            current_user=admin_user,
        )

    db_session.flush()
    assert db_session.scalar(select(func.count()).select_from(WorkCrewMembership)) == 0
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 0
    assert db_session.scalar(select(func.count()).select_from(AttendanceEvaluationQueue)) == 0


def test_override_create_and_cancel_authorize_employee_from_persisted_rows(
    db_session, admin_user
) -> None:
    _crew, _pattern, shift = _roster(db_session, admin_user)
    foreign = _employee(db_session, "foreign-override", "Finance")
    override = WorkShiftOverride(
        employee_id=foreign.id,
        assignment_kind="off",
        reason_kind="other",
        starts_at=START,
        ends_at=END,
        reason="Existing",
        created_by_user_id=admin_user.id,
    )
    db_session.add(override)
    db_session.commit()

    with pytest.raises(AppError) as create_denied:
        workforce_schedule_service.create_shift_override(
            db_session,
            scope=_scope(),
            employee_id=foreign.id,
            assignment_kind="work",
            reason_kind="training",
            starts_at=START + timedelta(days=1),
            ends_at=END + timedelta(days=1),
            shift_definition_id=shift.id,
            reason="Denied",
            current_user=admin_user,
        )
    assert create_denied.value.code == "FORBIDDEN"

    with pytest.raises(AppError) as cancel_denied:
        workforce_schedule_service.cancel_shift_override(
            db_session,
            scope=_scope(),
            override_id=override.id,
            if_match=row_etag(override),
            current_user=admin_user,
        )
    assert cancel_denied.value.code == "FORBIDDEN"
    with pytest.raises(ConflictError):
        workforce_schedule_service.cancel_shift_override(
            db_session,
            scope=organization_scope(),
            override_id=override.id,
            if_match='"stale"',
            current_user=admin_user,
        )
    db_session.flush()
    assert override.cancelled_at is None
    assert _side_effect_counts(db_session) == (1, 0, 0)


def test_override_create_and_cancel_lifecycle_is_audited_queued_and_caller_owned(
    db_session, admin_user
) -> None:
    _crew, _pattern, _shift = _roster(db_session, admin_user)
    employee = _employee(db_session, "override-success", "Operations")
    db_session.commit()

    def create_override() -> WorkShiftOverride:
        return workforce_schedule_service.create_shift_override(
            db_session,
            scope=_scope(),
            employee_id=employee.id,
            assignment_kind="off",
            reason_kind="training",
            starts_at=START,
            ends_at=END,
            reason="Training day",
            current_user=admin_user,
        )

    override = create_override()
    db_session.flush()
    assert override.assignment_kind == "off"
    assert override.reason_kind == "training"
    assert override.reason == "Training day"
    assert list(db_session.scalars(select(AuditLog.action))) == ["workforce.override.created"]
    queue = db_session.scalar(select(AttendanceEvaluationQueue))
    assert queue is not None
    assert queue.reason_codes == ["SHIFT_OVERRIDE_CHANGED"]
    db_session.commit()
    cancelled_at = datetime(2026, 9, 7, 12)
    workforce_schedule_service.cancel_shift_override(
        db_session,
        scope=_scope(),
        override_id=override.id,
        if_match=row_etag(override),
        current_user=admin_user,
        now=cancelled_at,
    )
    db_session.flush()

    assert override.cancelled_at == cancelled_at
    assert override.cancelled_by_user_id == admin_user.id
    assert list(db_session.scalars(select(AuditLog.action).order_by(AuditLog.id))) == [
        "workforce.override.created",
        "workforce.override.cancelled",
    ]
    queue = db_session.scalar(select(AttendanceEvaluationQueue))
    assert queue is not None
    assert queue.reason_codes == [
        "SHIFT_OVERRIDE_CANCELLED",
        "SHIFT_OVERRIDE_CHANGED",
    ]

    db_session.rollback()
    db_session.refresh(override)
    assert override.cancelled_at is None
    assert override.cancelled_by_user_id is None
    assert list(db_session.scalars(select(AuditLog.action))) == ["workforce.override.created"]


@pytest.mark.parametrize(
    ("from_department", "to_department"),
    [("Operations", "Finance"), ("Finance", "Operations")],
)
def test_swap_denies_either_foreign_leg_before_rows_audit_or_queue(
    db_session, admin_user, from_department: str, to_department: str
) -> None:
    _crew, _pattern, shift = _roster(db_session, admin_user)
    first = _employee(db_session, "swap-from", from_department)
    second = _employee(db_session, "swap-to", to_department)
    db_session.commit()

    with pytest.raises(AppError) as denied:
        workforce_schedule_service.create_shift_swap(
            db_session,
            scope=_scope(),
            from_employee_id=first.id,
            to_employee_id=second.id,
            starts_at=START,
            ends_at=END,
            shift_definition_id=shift.id,
            reason="Denied swap",
            current_user=admin_user,
        )

    assert denied.value.code == "FORBIDDEN"
    db_session.flush()
    assert _side_effect_counts(db_session) == (0, 0, 0)


def test_allowed_swap_creates_correlated_legs_audits_and_queues_until_rollback(
    db_session, admin_user
) -> None:
    _crew, _pattern, shift = _roster(db_session, admin_user)
    first = _employee(db_session, "swap-allowed-from", "Operations")
    second = _employee(db_session, "swap-allowed-to", "Operations")
    db_session.commit()

    off, work, correlation_id = workforce_schedule_service.create_shift_swap(
        db_session,
        scope=_scope(),
        from_employee_id=first.id,
        to_employee_id=second.id,
        starts_at=START,
        ends_at=END,
        shift_definition_id=shift.id,
        reason="Approved swap",
        current_user=admin_user,
    )
    db_session.flush()

    assert correlation_id
    assert (off.employee_id, off.assignment_kind, off.shift_definition_id) == (
        first.id,
        "off",
        None,
    )
    assert (work.employee_id, work.assignment_kind, work.shift_definition_id) == (
        second.id,
        "work",
        shift.id,
    )
    assert off.correlation_id == work.correlation_id == correlation_id
    assert off.reason == work.reason == "Approved swap"
    assert list(db_session.scalars(select(AuditLog.action).order_by(AuditLog.id))) == [
        "workforce.override.created",
        "workforce.override.created",
    ]
    queues = list(
        db_session.scalars(
            select(AttendanceEvaluationQueue).order_by(AttendanceEvaluationQueue.employee_id)
        )
    )
    assert [(row.employee_id, row.reason_codes) for row in queues] == [
        (first.id, ["SHIFT_OVERRIDE_CHANGED"]),
        (second.id, ["SHIFT_OVERRIDE_CHANGED"]),
    ]

    db_session.rollback()
    assert _side_effect_counts(db_session) == (0, 0, 0)


def test_requirement_create_and_approval_enforce_hierarchy_from_stored_row(
    db_session, admin_user
) -> None:
    foreign = WorkStaffingRequirement(
        scope_kind="department",
        department="Finance",
        minimum_headcount=2,
        effective_from=date(2026, 9, 1),
        created_by_user_id=admin_user.id,
    )
    db_session.add(foreign)
    db_session.commit()

    with pytest.raises(AppError) as create_denied:
        workforce_schedule_service.create_staffing_requirement(
            db_session,
            scope=_scope(),
            scope_kind="department",
            department="Finance",
            duty_unit=None,
            duty_post=None,
            minimum_headcount=3,
            effective_from=date(2026, 10, 1),
            current_user=admin_user,
        )
    assert create_denied.value.code == "FORBIDDEN"

    with pytest.raises(AppError) as approve_denied:
        workforce_schedule_service.approve_staffing_requirement(
            db_session,
            scope=_scope(),
            requirement_id=foreign.id,
            if_match=row_etag(foreign),
            current_user=admin_user,
        )
    assert approve_denied.value.code == "FORBIDDEN"
    with pytest.raises(ConflictError):
        workforce_schedule_service.approve_staffing_requirement(
            db_session,
            scope=organization_scope(),
            requirement_id=foreign.id,
            if_match='"stale"',
            current_user=admin_user,
        )
    db_session.flush()
    assert foreign.approved_at is None
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_unit_scope_without_department_can_create_and_approve_matching_requirement(
    db_session, admin_user
) -> None:
    unit_scope = WorkforceScope(
        entries=(WorkforceScopeEntry(scope_kind="duty_unit", duty_unit="Guard One"),)
    )
    requirement = workforce_schedule_service.create_staffing_requirement(
        db_session,
        scope=unit_scope,
        scope_kind="duty_unit",
        department=None,
        duty_unit="Guard One",
        duty_post=None,
        minimum_headcount=3,
        effective_from=date(2026, 9, 1),
        current_user=admin_user,
    )

    workforce_schedule_service.approve_staffing_requirement(
        db_session,
        scope=unit_scope,
        requirement_id=requirement.id,
        if_match=row_etag(requirement),
        current_user=admin_user,
    )

    assert requirement.department is None
    assert requirement.duty_unit == "Guard One"
    assert requirement.approved_at is not None


def test_missing_or_stale_write_etags_fail_before_admin_and_schedule_effects(
    db_session, admin_user
) -> None:
    crew, pattern, _shift = _roster(db_session, admin_user)
    db_session.commit()
    organization = organization_scope()

    with pytest.raises(ConflictError):
        workforce_admin_service.create_crew(
            db_session,
            scope=organization,
            if_match=None,
            payload={"code": "missing-etag", "name_en": "Missing"},
            actor=admin_user,
        )
    with pytest.raises(ConflictError):
        workforce_schedule_service.create_crew_schedule(
            db_session,
            scope=organization,
            if_match='"stale"',
            crew_id=crew.id,
            pattern_id=pattern.id,
            anchor_at=START,
            effective_from=START,
            current_user=admin_user,
        )

    db_session.flush()
    assert db_session.scalar(select(func.count()).select_from(WorkCrew)) == 1
    assert db_session.scalar(select(func.count()).select_from(WorkCrewSchedule)) == 0
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 0
