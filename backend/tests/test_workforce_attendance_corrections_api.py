"""GET /workforce/attendance/cases/{case_id} typed evidence contract."""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta

from app.db.models import AuditLog
from app.db.workforce_models import (
    AttendanceAdjustment,
    AttendanceEvaluation,
    AttendanceEvaluationPunchSource,
    AttendancePunchAssignment,
)
from app.services import perm_service, workforce_admin_service, workforce_read_service
from app.services.workforce_scope_service import resolve_workforce_scope
from tests.conftest import make_user
from tests.factories.attendance import add_punch, build_attendance_day, local
from tests.test_workforce_api_permissions import _client

DAY = date(2026, 8, 24)

def _adjustment_payload(effective: dict[str, object], *, reason: str, **changes: object) -> dict[str, object]:
    payload = {
        "replacement_presence_state": effective["presence_state"],
        "replacement_first_in_at": effective["first_in_at"],
        "replacement_latest_in_at": effective["latest_in_at"],
        "replacement_final_out_at": effective["final_out_at"],
        "replacement_late_minutes": effective["late_minutes"],
        "replacement_early_exit_minutes": effective["early_exit_minutes"],
        "replacement_missing_checkout": effective["missing_checkout"],
        "reason": reason,
    }
    payload.update(changes)
    return payload


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
    punch = add_punch(
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
    api_db.add(
        AttendanceEvaluationPunchSource(
            evaluation_id=second.id,
            punch_id=punch.id,
            ordinal=1,
        )
    )

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


def test_exceptions_endpoint_orders_nonempty_mixed_severity_rows(api_db) -> None:
    fixture = build_attendance_day(
        api_db,
        operational_date=DAY,
        posts=[("Gate 1", 5)],
    )
    for case in fixture.cases:
        evaluation = api_db.query(AttendanceEvaluation).filter_by(attendance_case_id=case.id, revision=1).one()
        evaluation.presence_state = "completed"
        evaluation.late_minutes = None
        evaluation.early_exit_minutes = None
        evaluation.missing_checkout = False
    cases = [case for case in fixture.cases if case.shift_code_snapshot == "morning"][:5]
    expected = []
    for case, presence, late, early, missing in (
        (cases[0], "completed", 5, 0, False),
        (cases[1], "unknown", 0, 0, False),
        (cases[2], "absent", 0, 0, False),
        (cases[3], "completed", 0, 4, False),
        (cases[4], "completed", 0, 0, True),
    ):
        evaluation = api_db.query(AttendanceEvaluation).filter_by(attendance_case_id=case.id, revision=1).one()
        evaluation.presence_state = presence
        evaluation.late_minutes = late or None
        evaluation.early_exit_minutes = early or None
        evaluation.missing_checkout = missing
        expected.append(case.employee_id)
    api_db.commit()

    response = _client(api_db, fixture.admin).get(
        f"/api/v1/workforce/attendance/exceptions?operational_date={DAY.isoformat()}&limit=20"
    )

    assert response.status_code == 200, response.text
    assert [item["employee_id"] for item in response.json()["items"][:5]] == [
        expected[2], expected[4], expected[0], expected[3], expected[1]
    ]


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
    created = workforce_admin_service.apply_adjustment(
        api_db,
        case_id=case.id,
        payload={"replacement_presence_state": "completed", "reason": "Supervisor register"},
        if_match=workforce_admin_service.attendance_case_etag(api_db, case.id),
        actor=fixture.admin,
    )
    revoked = workforce_admin_service.revoke_adjustment(
        api_db,
        case_id=case.id,
        adjustment_id=created.id,
        reason="Duplicate register entry",
        if_match=workforce_admin_service.attendance_case_etag(api_db, case.id),
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


def test_case_punches_exclude_events_assigned_to_an_overlapping_case(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    employee = fixture.employees[0]
    target_case = next(
        row
        for row in fixture.cases
        if row.employee_id == employee.id and row.shift_code_snapshot == "morning"
    )
    other_case = next(
        row for row in fixture.cases if row.employee_id == employee.id and row.id != target_case.id
    )
    # A minute offset preserves the uniqueness constraint while making their
    # evidence windows overlap completely.
    other_case.scheduled_start_at = target_case.scheduled_start_at + timedelta(minutes=1)
    other_case.scheduled_end_at = target_case.scheduled_end_at
    evaluation = api_db.query(AttendanceEvaluation).filter_by(
        attendance_case_id=target_case.id, revision=1
    ).one()
    person = fixture.provider_people[employee.id]
    owned = add_punch(api_db, provider_person=person, occurred_at=local(DAY, time(8, 5)))
    unassigned = add_punch(api_db, provider_person=person, occurred_at=local(DAY, time(8, 6)))
    assigned_elsewhere = add_punch(api_db, provider_person=person, occurred_at=local(DAY, time(8, 7)))
    api_db.add_all(
        [
            AttendancePunchAssignment(
                punch_id=owned.id, attendance_case_id=target_case.id, algorithm_version="test"
            ),
            AttendancePunchAssignment(
                punch_id=assigned_elsewhere.id,
                attendance_case_id=other_case.id,
                algorithm_version="test",
            ),
            AttendanceEvaluationPunchSource(
                evaluation_id=evaluation.id, punch_id=owned.id, ordinal=1
            ),
            AttendanceEvaluationPunchSource(
                evaluation_id=evaluation.id, punch_id=unassigned.id, ordinal=2
            ),
        ]
    )
    api_db.commit()

    response = _client(api_db, fixture.admin).get(
        f"/api/v1/workforce/attendance/cases/{target_case.id}"
    )

    assert response.status_code == 200, response.text
    assert [row["occurred_at"] for row in response.json()["punches"]] == [
        "2026-08-24T04:05:00Z",
        "2026-08-24T04:06:00Z",
    ]


def test_case_keeps_legacy_created_audit_with_adjustment_reason_fallback(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    evaluation = api_db.query(AttendanceEvaluation).filter_by(
        attendance_case_id=case.id, revision=1
    ).one()
    adjustment = AttendanceAdjustment(
        attendance_case_id=case.id,
        base_evaluation_id=evaluation.id,
        reason="Legacy supervisor register",
        created_by_user_id=fixture.admin.id,
        created_at=datetime(2026, 8, 24, 12, 2),
    )
    api_db.add(adjustment)
    api_db.flush()
    api_db.add_all(
        [
            AuditLog(
                actor="legacy-creator",
                action="workforce.attendance_adjustment.created",
                entity_type="attendance_adjustment",
                entity_id=str(adjustment.id),
                payload=json.dumps({"after": {"case_id": case.id}}),
                ts=datetime(2026, 8, 24, 12, 2),
            ),
            AuditLog(
                actor="legacy-revoker",
                action="workforce.attendance_adjustment.revoked",
                entity_type="attendance_adjustment",
                entity_id=str(adjustment.id),
                payload=json.dumps({"after": {"reason": "Legacy revocation"}}),
                ts=datetime(2026, 8, 24, 12, 3),
            ),
        ]
    )
    api_db.commit()

    response = _client(api_db, fixture.admin).get(f"/api/v1/workforce/attendance/cases/{case.id}")

    assert response.status_code == 200, response.text
    audit = response.json()["adjustment_audit"]
    assert [row["action"] for row in audit] == ["created", "revoked"]
    assert [row["reason"] for row in audit] == [
        "Legacy supervisor register",
        "Legacy revocation",
    ]


def test_case_uses_persisted_evaluation_sources_after_mapping_changes(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    employee = fixture.employees[0]
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    first = api_db.query(AttendanceEvaluation).filter_by(
        attendance_case_id=case.id, revision=1
    ).one()
    punch = add_punch(
        api_db,
        provider_person=fixture.provider_people[employee.id],
        occurred_at=local(DAY, time(8, 9)),
        device_name="Historical Terminal",
    )
    second = AttendanceEvaluation(
        attendance_case_id=case.id,
        revision=2,
        provider_person_id=first.provider_person_id,
        presence_state="completed",
        reason_code="automatic_revision",
        algorithm_version="test-v2",
        input_fingerprint="case-source-revision-2",
        evaluated_at=datetime(2026, 8, 24, 12, 1),
    )
    api_db.add(second)
    api_db.flush()
    api_db.add_all(
        [
            AttendanceEvaluationPunchSource(
                evaluation_id=first.id, punch_id=punch.id, ordinal=1
            ),
            AttendanceEvaluationPunchSource(
                evaluation_id=second.id, punch_id=punch.id, ordinal=1
            ),
        ]
    )
    person = fixture.provider_people[employee.id]
    person.mapping_state = "unmapped"
    person.employee_id = None
    api_db.commit()

    response = _client(api_db, fixture.admin).get(f"/api/v1/workforce/attendance/cases/{case.id}")

    assert response.status_code == 200, response.text
    assert response.json()["punches"] == [
        {"occurred_at": "2026-08-24T04:09:00Z", "device_name": "Historical Terminal"}
    ]



def test_adjustment_requires_a_complete_effective_snapshot(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    client = _client(api_db, fixture.admin)
    etag = client.get(f"/api/v1/workforce/attendance/cases/{case.id}").headers["etag"]

    response = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
        headers={"If-Match": etag},
        json={"replacement_presence_state": "completed", "reason": "Incomplete correction"},
    )

    assert response.status_code == 422


def test_adjustment_full_snapshot_preserves_prior_values_and_persists_explicit_clears(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    client = _client(api_db, fixture.admin)
    initial = client.get(f"/api/v1/workforce/attendance/cases/{case.id}")

    first = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
        headers={"If-Match": initial.headers["etag"]},
        json=_adjustment_payload(
            initial.json()["effective"],
            reason="Late arrival verified",
            replacement_late_minutes=7,
        ),
    )
    assert first.status_code == 201, first.text
    after_first = client.get(f"/api/v1/workforce/attendance/cases/{case.id}")
    assert after_first.json()["effective"]["late_minutes"] == 7

    second = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
        headers={"If-Match": after_first.headers["etag"]},
        json=_adjustment_payload(
            after_first.json()["effective"],
            reason="Exit evidence unavailable",
            replacement_final_out_at=None,
        ),
    )
    assert second.status_code == 201, second.text
    effective = client.get(f"/api/v1/workforce/attendance/cases/{case.id}").json()["effective"]
    assert effective["late_minutes"] == 7
    assert effective["final_out_at"] is None


def test_active_full_snapshot_correction_overlays_every_attendance_projection_and_revocation_restores_automatic(api_db) -> None:
    fixture = build_attendance_day(
        api_db,
        operational_date=DAY,
        posts=[("Gate 1", 1)],
        punches={None: [time(5, 17)]},
    )
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    automatic = api_db.query(AttendanceEvaluation).filter_by(
        attendance_case_id=case.id, revision=1
    ).one()
    automatic.presence_state = "completed"
    automatic.first_in_at = datetime(2026, 8, 24, 1, 17)
    automatic.latest_in_at = datetime(2026, 8, 24, 1, 17)
    automatic.final_out_at = datetime(2026, 8, 24, 9, 0)
    automatic.late_minutes = 17
    automatic.early_exit_minutes = 0
    automatic.missing_checkout = True
    api_db.flush()
    scope = resolve_workforce_scope(api_db, fixture.admin)

    correction = workforce_admin_service.apply_adjustment(
        api_db,
        case_id=case.id,
        payload={
            "replacement_presence_state": "completed",
            "replacement_first_in_at": None,
            "replacement_latest_in_at": None,
            "replacement_final_out_at": None,
            "replacement_late_minutes": None,
            "replacement_early_exit_minutes": None,
            "replacement_missing_checkout": False,
            "reason": "Supervisor register clears unsupported timestamps",
        },
        if_match=workforce_admin_service.attendance_case_etag(api_db, case.id),
        actor=fixture.admin,
    )

    corrected_day = next(
        row
        for row in workforce_read_service.list_attendance_day(
            api_db, scope=scope, operational_date=DAY
        )
        if row["case_id"] == case.id
    )
    corrected_range = next(
        row
        for row in workforce_read_service.employee_attendance_range(
            api_db,
            scope=scope,
            employee_id=case.employee_id,
            from_date=DAY,
            to_date=DAY,
        )["days"]
        if row["shift_code"] == case.shift_code_snapshot
    )
    corrected_case = workforce_read_service.get_attendance_case(
        api_db, scope=scope, case_id=case.id
    )
    corrected_exceptions = workforce_read_service.list_exceptions(
        api_db, scope=scope, operational_date=DAY
    )

    assert corrected_day["late_minutes"] is None
    assert corrected_range["late_minutes"] is None
    assert all(row["case_id"] != case.id for row in corrected_exceptions)
    assert corrected_case["effective"] == {
        "id": automatic.id,
        "revision": automatic.revision,
        "presence_state": "completed",
        "reason_code": automatic.reason_code,
        "first_in_at": None,
        "latest_in_at": None,
        "final_out_at": None,
        "late_minutes": None,
        "early_exit_minutes": None,
        "missing_checkout": False,
        "evaluated_at": automatic.evaluated_at,
        "adjustment_id": correction.id,
    }

    workforce_admin_service.revoke_adjustment(
        api_db,
        case_id=case.id,
        adjustment_id=correction.id,
        reason="Automatic evidence was sufficient",
        if_match=workforce_admin_service.attendance_case_etag(api_db, case.id),
        actor=fixture.admin,
    )
    api_db.flush()

    restored_day = next(
        row
        for row in workforce_read_service.list_attendance_day(
            api_db, scope=scope, operational_date=DAY
        )
        if row["case_id"] == case.id
    )
    restored_range = next(
        row
        for row in workforce_read_service.employee_attendance_range(
            api_db,
            scope=scope,
            employee_id=case.employee_id,
            from_date=DAY,
            to_date=DAY,
        )["days"]
        if row["shift_code"] == case.shift_code_snapshot
    )
    restored_case = workforce_read_service.get_attendance_case(
        api_db, scope=scope, case_id=case.id
    )
    restored_exceptions = workforce_read_service.list_exceptions(
        api_db, scope=scope, operational_date=DAY
    )

    assert restored_day["late_minutes"] == 17
    assert restored_range["late_minutes"] == 17
    assert any(row["case_id"] == case.id for row in restored_exceptions)
    assert restored_case["effective"]["first_in_at"] == automatic.first_in_at
    assert restored_case["effective"]["latest_in_at"] == automatic.latest_in_at
    assert restored_case["effective"]["final_out_at"] == automatic.final_out_at
    assert restored_case["effective"]["late_minutes"] == 17
    assert restored_case["effective"]["early_exit_minutes"] == 0
    assert restored_case["effective"]["missing_checkout"] is True
    assert restored_case["effective"].get("adjustment_id") is None
def test_case_etag_serializes_adjustments_across_reload_and_rejects_stale_writes(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    client = _client(api_db, fixture.admin)

    case_response = client.get(f"/api/v1/workforce/attendance/cases/{case.id}")
    assert case_response.status_code == 200, case_response.text
    version_1 = case_response.headers["etag"]
    effective_1 = case_response.json()["effective"]

    missing = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
        json=_adjustment_payload(effective_1, reason="Missing version", replacement_presence_state="completed"),
    )
    assert missing.status_code == 409
    assert missing.json()["error"]["code"] == "ATTENDANCE_CASE_VERSION_CONFLICT"
    assert client.get(f"/api/v1/workforce/attendance/cases/{case.id}").headers["etag"] == version_1

    created = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
        headers={"If-Match": version_1},
        json=_adjustment_payload(effective_1, reason="Supervisor register", replacement_presence_state="completed"),
    )
    assert created.status_code == 201, created.text
    version_2 = created.headers["etag"]
    assert version_2 != version_1

    stale = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
        headers={"If-Match": version_1},
        json=_adjustment_payload(effective_1, reason="Stale review", replacement_presence_state="absent"),
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "ATTENDANCE_CASE_VERSION_CONFLICT"

    reloaded = client.get(f"/api/v1/workforce/attendance/cases/{case.id}")
    assert reloaded.status_code == 200, reloaded.text
    assert reloaded.headers["etag"] == version_2
    revoked = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments/{created.json()['id']}/revoke",
        headers={"If-Match": reloaded.headers["etag"]},
        json={"reason": "Correction entered against wrong person"},
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.headers["etag"] != reloaded.headers["etag"]


def test_case_etag_reveals_active_predecessor_after_revoking_superseder(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    client = _client(api_db, fixture.admin)
    case_response = client.get(f"/api/v1/workforce/attendance/cases/{case.id}")
    version_1 = case_response.headers["etag"]
    effective_1 = case_response.json()["effective"]

    first = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
        headers={"If-Match": version_1},
        json=_adjustment_payload(effective_1, reason="First register", replacement_presence_state="completed"),
    )
    assert first.status_code == 201, first.text
    first_effective = client.get(f"/api/v1/workforce/attendance/cases/{case.id}").json()["effective"]
    second = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
        headers={"If-Match": first.headers["etag"]},
        json=_adjustment_payload(first_effective, reason="Superseding register", replacement_presence_state="absent"),
    )
    assert second.status_code == 201, second.text
    version_3 = second.headers["etag"]

    revoked = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments/{second.json()['id']}/revoke",
        headers={"If-Match": version_3},
        json={"reason": "Second register was incorrect"},
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.headers["etag"] != version_3

    revealed = client.get(f"/api/v1/workforce/attendance/cases/{case.id}")
    assert revealed.status_code == 200, revealed.text
    assert revealed.headers["etag"] == revoked.headers["etag"]
    assert revealed.json()["effective"]["adjustment_id"] == first.json()["id"]

    stale = client.post(
        f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
        headers={"If-Match": version_3},
        json=_adjustment_payload(first_effective, reason="Stale second review", replacement_presence_state="completed"),
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "ATTENDANCE_CASE_VERSION_CONFLICT"


def test_case_snapshot_pairs_evidence_body_with_its_concurrency_version(api_db) -> None:
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(case for case in fixture.cases if case.shift_code_snapshot == "morning")
    first = workforce_admin_service.apply_adjustment(
        api_db,
        case_id=case.id,
        payload={"replacement_presence_state": "completed", "reason": "First register"},
        if_match=workforce_admin_service.attendance_case_etag(api_db, case.id),
        actor=fixture.admin,
    )
    snapshot = workforce_read_service.get_attendance_case_snapshot(
        api_db,
        scope=resolve_workforce_scope(api_db, fixture.admin),
        case_id=case.id,
    )

    workforce_admin_service.apply_adjustment(
        api_db,
        case_id=case.id,
        payload={"replacement_presence_state": "absent", "reason": "Later register"},
        if_match=snapshot.etag,
        actor=fixture.admin,
    )

    assert snapshot.body["effective"]["adjustment_id"] == first.id
    assert snapshot.etag != workforce_admin_service.attendance_case_etag(api_db, case.id)


def test_corrected_filter_lists_active_corrections_and_survives_revocation(api_db) -> None:
    """The queue's "corrected" section: reachable cases for undoing a mistake.

    A correction removes a case from the default exception queue the moment the
    effective state stops looking like an exception — correct, but it also
    closes the only door to the revoke button. ``corrected=true`` is the second
    door: every case carrying an active correction, with who/when/why attached.
    Revocation closes it again: the case returns to the plain exception queue.
    """
    fixture = build_attendance_day(api_db, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(c for c in fixture.cases if c.shift_code_snapshot == "morning")
    client = _client(api_db, fixture.admin)
    workforce_admin_service.apply_adjustment(
        api_db,
        case_id=case.id,
        payload=_adjustment_payload(
            {
                "presence_state": "absent",
                "first_in_at": None,
                "latest_in_at": None,
                "final_out_at": None,
                "late_minutes": None,
                "early_exit_minutes": None,
                "missing_checkout": False,
            },
            reason="Arrived on time, punch missed",
            replacement_presence_state="completed",
        ),
        if_match=workforce_admin_service.attendance_case_etag(api_db, case.id),
        actor=fixture.admin,
    )
    api_db.commit()

    corrected = client.get(
        f"/api/v1/workforce/attendance/exceptions?operational_date={DAY.isoformat()}"
        "&corrected=true&limit=50"
    )
    assert corrected.status_code == 200
    rows = [r for r in corrected.json()["items"] if r["case_id"] == case.id]
    assert len(rows) == 1
    assert rows[0]["presence_state"] == "completed"
    assert rows[0]["correction_reason"] == "Arrived on time, punch missed"
    assert rows[0]["corrected_by"] == fixture.admin.email
    assert rows[0]["corrected_at"] is not None

    # The default queue still excludes the now-completed case.
    default = client.get(
        f"/api/v1/workforce/attendance/exceptions?operational_date={DAY.isoformat()}&limit=50"
    )
    assert all(r["case_id"] != case.id for r in default.json()["items"])

    workforce_admin_service.revoke_adjustment(
        api_db,
        case_id=case.id,
        adjustment_id=workforce_admin_service.active_attendance_adjustments(api_db, [case.id])[case.id].id,
        reason="Duplicate register entry",
        if_match=workforce_admin_service.attendance_case_etag(api_db, case.id),
        actor=fixture.admin,
    )
    api_db.commit()

    after_revoke = client.get(
        f"/api/v1/workforce/attendance/exceptions?operational_date={DAY.isoformat()}"
        "&corrected=true&limit=50"
    )
    assert all(r["case_id"] != case.id for r in after_revoke.json()["items"])
    restored = client.get(
        f"/api/v1/workforce/attendance/exceptions?operational_date={DAY.isoformat()}&limit=50"
    )
    assert any(r["case_id"] == case.id for r in restored.json()["items"])
