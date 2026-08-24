"""GET /workforce/attendance/cases/{case_id} typed evidence contract."""

from __future__ import annotations

import json
from datetime import date, datetime, time

from app.db.models import AuditLog
from app.db.workforce_models import AttendanceAdjustment, AttendanceEvaluation
from app.services import perm_service, workforce_admin_service
from tests.conftest import make_user
from tests.factories.attendance import add_punch, build_attendance_day, local
from tests.test_workforce_api_permissions import _client

DAY = date(2026, 8, 24)


def test_case_reads_historical_typed_evidence_without_punch_inference(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    employee = fixture.employees[0]
    case = next(case for case in fixture.cases if case.employee_id == employee.id and case.shift_code_snapshot == "morning")
    first = api_db.query(AttendanceEvaluation).filter_by(attendance_case_id=case.id, revision=1).one()

    # The case owns placement facts even after the employee directory changes.
    case.department_snapshot = "Operations"
    case.duty_unit_snapshot = "Main Gate"
    case.duty_post_snapshot = "Gate 1"
    case.crew_code_snapshot = "ALPHA"
    case.crew_name_snapshot = "Alpha Crew"
    case.organization_snapshot_state = "captured"
    employee.department = "Different Department"
    employee.duty_unit = "Different Unit"
    employee.duty_post = "Different Post"

    add_punch(
        api_db,
        provider_person=fixture.provider_people[employee.id],
        occurred_at=local(DAY, time(8, 9)),
        device_name="Main Gate Terminal",
    )
    second = AttendanceEvaluation(
        attendance_case_id=case.id,
        revision=2,
        provider_person_id=first.provider_person_id,
        presence_state="completed",
        reason_code="automatic_revision",
        first_in_at=first.first_in_at,
        latest_in_at=first.latest_in_at,
        final_out_at=first.final_out_at,
        late_minutes=first.late_minutes,
        early_exit_minutes=first.early_exit_minutes,
        missing_checkout=first.missing_checkout,
        algorithm_version="test-v2",
        input_fingerprint="case-evidence-revision-2",
        evaluated_at=datetime(2026, 8, 24, 12, 1),
    )
    api_db.add(second)
    api_db.flush()

    reason = "Verified against supervisor register"
    adjustment = AttendanceAdjustment(
        attendance_case_id=case.id,
        base_evaluation_id=second.id,
        replacement_presence_state="completed",
        reason=reason,
        created_by_user_id=fixture.admin.id,
        created_at=datetime(2026, 8, 24, 12, 2),
        revoked_at=datetime(2026, 8, 24, 12, 4),
        revoked_by_user_id=fixture.admin.id,
    )
    api_db.add(adjustment)
    api_db.flush()
    api_db.add_all(
        [
            AuditLog(
                actor="case-creator",
                action="workforce.attendance_adjustment.created",
                entity_type="attendance_adjustment",
                entity_id=str(adjustment.id),
                payload=json.dumps({"after": {"reason": reason}}),
                ts=datetime(2026, 8, 24, 12, 2),
            ),
            AuditLog(
                actor="case-revoker",
                action="workforce.attendance_adjustment.revoked",
                entity_type="attendance_adjustment",
                entity_id=str(adjustment.id),
                payload=json.dumps({"after": {"reason": "Duplicate register entry"}}),
                ts=datetime(2026, 8, 24, 12, 4),
            ),
        ]
    )
    api_db.commit()

    response = _client(api_db, fixture.admin).get(f"/api/v1/workforce/attendance/cases/{case.id}")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["name_en"] == employee.name_en
    assert payload["department_snapshot"] == "Operations"
    assert payload["duty_unit_snapshot"] == "Main Gate"
    assert payload["duty_post_snapshot"] == "Gate 1"
    assert payload["crew_code_snapshot"] == "ALPHA"
    assert payload["crew_name_snapshot"] == "Alpha Crew"
    assert payload["shift_code_snapshot"] == "morning"
    assert payload["organization_snapshot_state"] == "captured"
    assert payload["punches"] == [
        {"occurred_at": "2026-08-24T04:09:00Z", "device_name": "Main Gate Terminal"}
    ]
    assert [row["revision"] for row in payload["evaluations"]] == [1, 2]
    assert payload["adjustments"][0]["reason"] == reason
    assert [row["action"] for row in payload["adjustment_audit"]] == ["created", "revoked"]
    assert [row["actor"] for row in payload["adjustment_audit"]] == ["case-creator", "case-revoker"]
    assert [row["reason"] for row in payload["adjustment_audit"]] == [reason, "Duplicate register entry"]
    assert "punch_state" not in response.text
    assert "direction" not in response.text


def test_case_denies_out_of_scope_user_without_disclosing_evidence(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    outsider = make_user(api_db, role="operator", email="case-outsider@test.ae")
    perm_service.set_user_override(api_db, outsider.id, "workforce.people.view", "grant")
    perm_service.set_user_override(api_db, outsider.id, "workforce.attendance.review", "grant")
    api_db.commit()

    response = _client(api_db, outsider).get(f"/api/v1/workforce/attendance/cases/{case.id}")

    assert response.status_code == 403
    assert "punches" not in response.text
    assert "evaluations" not in response.text
    assert "adjustments" not in response.text


def test_adjustment_audits_persist_create_and_revoke_reasons(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    evaluation = api_db.query(AttendanceEvaluation).filter_by(
        attendance_case_id=case.id, revision=1
    ).one()
    created = workforce_admin_service.apply_adjustment(
        api_db,
        case_id=case.id,
        payload={"replacement_presence_state": "completed", "reason": "Supervisor register"},
        if_match=workforce_admin_service.row_etag(
            evaluation, extra={"case_id": case.id, "automatic_revision": evaluation.revision}
        ),
        actor=fixture.admin,
    )
    revoked = workforce_admin_service.revoke_adjustment(
        api_db,
        case_id=case.id,
        adjustment_id=created.id,
        reason="Duplicate register entry",
        if_match=workforce_admin_service.row_etag(created),
        actor=fixture.admin,
    )

    api_db.flush()

    entries = api_db.query(AuditLog).filter_by(
        entity_type="attendance_adjustment", entity_id=str(revoked.id)
    ).order_by(AuditLog.id).all()

    assert [entry.action.rsplit(".", maxsplit=1)[-1] for entry in entries] == ["created", "revoked"]
    assert [json.loads(entry.payload)["after"]["reason"] for entry in entries] == [
        "Supervisor register",
        "Duplicate register entry",
    ]
