"""RED contracts for bounded, FK-safe workforce retention."""
from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.db.models import AuditLog, Employee, User
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationPunchSource,
    AttendanceProviderPerson,
    AttendancePunch,
    WorkShiftDefinition,
    WorkShiftOverride,
)
from app.schemas.workforce import WorkforceConfiguration
from app.services.workforce_retention_service import purge_expired_workforce_data

NOW = datetime(2026, 8, 17, 12, tzinfo=UTC)


def _configuration(**overrides) -> WorkforceConfiguration:
    values = {
        "integration_enabled": False,
        "sync_interval_minutes": 15,
        "stale_after_minutes": 30,
        "initial_backfill_start_at": NOW - timedelta(days=31),
        "evaluation_start_at": NOW - timedelta(days=30),
        "nationality_fold_min_count": 5,
        "excusing_record_kinds": ["annual", "sick", "national_service"],
        "provider_person_retention_days": 90,
        "punch_retention_days": 60,
        "attendance_retention_days": 30,
        "duty_event_retention_days": 30,
        "audit_retention_days": 30,
    }
    values.update(overrides)
    return WorkforceConfiguration.model_validate(values)


def _referenced_punch(db_session) -> tuple[AttendanceCase, AttendancePunch]:
    employee = Employee(id="G-RET-1", name_en="Retention Tester", name_ar="مختبر الاحتفاظ")
    actor = User(
        email="retention-actor@test.example",
        password_hash="x",
        role="admin",
        status="active",
    )
    db_session.add_all((employee, actor))
    db_session.flush()
    shift = WorkShiftDefinition(
        code="retention-shift",
        start_local_time=(NOW - timedelta(hours=8)).time(),
        duration_minutes=480,
    )
    db_session.add(shift)
    db_session.flush()
    override = WorkShiftOverride(
        employee_id=employee.id,
        assignment_kind="work",
        reason_kind="other",
        starts_at=NOW - timedelta(days=45, hours=8),
        ends_at=NOW - timedelta(days=45),
        shift_definition_id=shift.id,
        reason="retention fixture",
        created_by_user_id=actor.id,
    )
    person = AttendanceProviderPerson(
        provider="biotime",
        external_person_id="P-RET-1",
        employee_id=employee.id,
        mapping_state="verified",
        verified_at=NOW - timedelta(days=90),
        verified_by_user_id=actor.id,
        active=False,
        first_seen_at=NOW - timedelta(days=120),
        last_seen_at=NOW - timedelta(days=90),
    )
    db_session.add_all((override, person))
    db_session.flush()
    case = AttendanceCase(
        employee_id=employee.id,
        shift_override_id=override.id,
        employee_status_snapshot="active",
        crew_code_snapshot="alpha",
        crew_name_snapshot="Alpha",
        shift_code_snapshot=shift.code,
        scheduled_start_at=NOW - timedelta(days=45, hours=8),
        scheduled_end_at=NOW - timedelta(days=45),
        operational_date=date(2026, 7, 3),
        organization_snapshot_state="captured",
    )
    punch = AttendancePunch(
        provider="biotime",
        external_event_id="event-ret-1",
        provider_person_id=person.id,
        occurred_at=NOW - timedelta(days=45, hours=8),
        direction="in",
        imported_at=NOW - timedelta(days=45),
        normalized_payload_hash="retention-test-hash",
    )
    db_session.add_all((case, punch))
    db_session.flush()
    evaluation = AttendanceEvaluation(
        attendance_case_id=case.id,
        revision=1,
        presence_state="completed",
        reason_code="PUNCH_OUT_RECORDED",
        late_minutes=0,
        missing_checkout=False,
        algorithm_version="v1",
        input_fingerprint="retention-fingerprint",
        evaluated_at=NOW - timedelta(days=45),
    )
    db_session.add(evaluation)
    db_session.flush()
    db_session.add(AttendanceEvaluationPunchSource(evaluation_id=evaluation.id, punch_id=punch.id, ordinal=1))
    db_session.flush()
    return case, punch


def test_configuration_rejects_inverted_retention_and_evaluation_start_before_duty_baseline():
    with pytest.raises(ValidationError):
        _configuration(provider_person_retention_days=59)

    with pytest.raises(ValidationError) as early_start:
        _configuration(
            initial_backfill_start_at=NOW - timedelta(days=61),
            evaluation_start_at=NOW - timedelta(days=61),
            duty_assignment_baseline_at=NOW - timedelta(days=60),
        )
    assert "evaluation_start_at" in str(early_start.value)


def test_purge_keeps_referenced_evidence_then_deletes_expired_case_as_one_fk_safe_unit(db_session):
    case, punch = _referenced_punch(db_session)
    result = purge_expired_workforce_data(db_session, configuration=_configuration(), now=NOW)

    assert result.deleted_cases == 1
    assert db_session.get(AttendanceCase, case.id) is None
    assert db_session.scalar(
        select(AttendanceEvaluation).where(AttendanceEvaluation.attendance_case_id == case.id)
    ) is None
    assert db_session.get(AttendancePunch, punch.id) is not None

    result = purge_expired_workforce_data(
        db_session,
        configuration=_configuration(punch_retention_days=30, provider_person_retention_days=30),
        now=NOW,
    )
    assert result.deleted_punches == 1
    assert db_session.get(AttendancePunch, punch.id) is None


def test_purge_audit_records_only_type_cutoff_and_counts_without_row_payloads(db_session):
    _referenced_punch(db_session)
    purge_expired_workforce_data(db_session, configuration=_configuration(), now=NOW)

    audits = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "workforce.retention.purged")
    ).all()
    assert len(audits) == 1
    payload = json.loads(audits[0].payload)
    assert set(payload) == {"cutoffs", "counts"}
    assert set(payload["cutoffs"]) == {"attendance", "punch", "provider_person", "duty_event", "audit"}
    assert all(isinstance(value, int) for value in payload["counts"].values())
    assert "event-ret-1" not in audits[0].payload
    assert "G-RET-1" not in audits[0].payload


def test_purge_deletes_only_workforce_audit_history(db_session):
    """Workforce retention owns workforce audits; leave and permit history is not its to delete."""
    expired = NOW.replace(tzinfo=None) - timedelta(days=400)
    db_session.add_all(
        [
            AuditLog(actor="a@test.ae", action="workforce.crew.created", entity_type="work_crew", ts=expired),
            AuditLog(actor="a@test.ae", action="leave.status_changed", entity_type="leave", ts=expired),
            AuditLog(actor="a@test.ae", action="permit.created", entity_type="permit", ts=expired),
        ]
    )
    db_session.flush()

    result = purge_expired_workforce_data(db_session, configuration=_configuration(), now=NOW)

    assert result.deleted_audits == 1
    remaining = set(
        db_session.scalars(select(AuditLog.action).where(AuditLog.ts == expired))
    )
    assert remaining == {"leave.status_changed", "permit.created"}
