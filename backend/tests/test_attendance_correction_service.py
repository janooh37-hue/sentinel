"""Attendance correction lifecycle through its public module interface."""

from __future__ import annotations

from datetime import date

import pytest

from app.api.errors import NotFoundError, ValidationFailedError
from app.db.workforce_models import (
    AttendanceAdjustment,
    AttendanceEvaluation,
    AttendanceEvaluationQueue,
)
from app.services import attendance_correction_service
from tests.factories.attendance import build_attendance_day

DAY = date(2026, 8, 24)


def _automatic_values(evaluation: AttendanceEvaluation) -> dict[str, object]:
    return {
        "presence_state": evaluation.presence_state,
        "first_in_at": evaluation.first_in_at,
        "latest_in_at": evaluation.latest_in_at,
        "final_out_at": evaluation.final_out_at,
        "late_minutes": evaluation.late_minutes,
        "early_exit_minutes": evaluation.early_exit_minutes,
        "missing_checkout": evaluation.missing_checkout,
        "reason_code": evaluation.reason_code,
    }


def _snapshot(evaluation: AttendanceEvaluation, *, reason: str) -> dict[str, object]:
    automatic = _automatic_values(evaluation)
    return {
        "replacement_presence_state": automatic["presence_state"],
        "replacement_first_in_at": automatic["first_in_at"],
        "replacement_latest_in_at": automatic["latest_in_at"],
        "replacement_final_out_at": automatic["final_out_at"],
        "replacement_late_minutes": automatic["late_minutes"],
        "replacement_early_exit_minutes": automatic["early_exit_minutes"],
        "replacement_missing_checkout": automatic["missing_checkout"],
        "reason": reason,
    }


def test_complete_correction_snapshot_overlays_without_changing_automatic_evaluation(
    db_session,
) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(row for row in fixture.cases if row.shift_code_snapshot == "morning")
    automatic = (
        db_session.query(AttendanceEvaluation)
        .filter_by(attendance_case_id=case.id, revision=1)
        .one()
    )
    original_presence = automatic.presence_state
    snapshot = _snapshot(automatic, reason="Supervisor register")
    snapshot["replacement_presence_state"] = "completed"

    correction = attendance_correction_service.correct(
        db_session,
        case_id=case.id,
        snapshot=snapshot,
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=fixture.admin,
    )

    effective = attendance_correction_service.overlay(_automatic_values(automatic), correction)
    assert effective["presence_state"] == "completed"
    assert automatic.presence_state == original_presence


def test_correction_rejects_an_incomplete_effective_snapshot(db_session) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(row for row in fixture.cases if row.shift_code_snapshot == "morning")

    with pytest.raises(ValidationFailedError) as invalid:
        attendance_correction_service.correct(
            db_session,
            case_id=case.id,
            snapshot={
                "replacement_presence_state": "completed",
                "reason": "Incomplete supervisor register",
            },
            if_match=attendance_correction_service.case_etag(db_session, case.id),
            actor=fixture.admin,
        )

    assert invalid.value.code == "ATTENDANCE_ADJUSTMENT_INVALID"


def test_missing_case_error_precedes_snapshot_validation(db_session) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])

    with pytest.raises(NotFoundError) as missing:
        attendance_correction_service.correct(
            db_session,
            case_id=999_999,
            snapshot={},
            if_match=None,
            actor=fixture.admin,
        )

    assert missing.value.code == "ATTENDANCE_CASE_NOT_FOUND"


def test_new_correction_supersedes_the_active_correction(db_session) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(row for row in fixture.cases if row.shift_code_snapshot == "morning")
    automatic = (
        db_session.query(AttendanceEvaluation)
        .filter_by(attendance_case_id=case.id, revision=1)
        .one()
    )
    first = attendance_correction_service.correct(
        db_session,
        case_id=case.id,
        snapshot=_snapshot(automatic, reason="First supervisor register"),
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=fixture.admin,
    )
    second_snapshot = _snapshot(automatic, reason="Later supervisor register")
    second_snapshot["replacement_presence_state"] = "absent"

    second = attendance_correction_service.correct(
        db_session,
        case_id=case.id,
        snapshot=second_snapshot,
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=fixture.admin,
    )

    rows = (
        db_session.query(AttendanceAdjustment)
        .filter_by(attendance_case_id=case.id)
        .order_by(AttendanceAdjustment.id)
        .all()
    )
    assert second.supersedes_adjustment_id == first.id
    assert attendance_correction_service.active_correction(rows).id == second.id
    assert attendance_correction_service.active_corrections(db_session, [case.id]) == {
        case.id: second
    }


def test_revoking_newest_correction_reveals_earlier_unrevoked_correction(
    db_session,
) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(row for row in fixture.cases if row.shift_code_snapshot == "morning")
    automatic = (
        db_session.query(AttendanceEvaluation)
        .filter_by(attendance_case_id=case.id, revision=1)
        .one()
    )
    first_snapshot = _snapshot(automatic, reason="First supervisor register")
    first_snapshot["replacement_presence_state"] = "completed"
    first = attendance_correction_service.correct(
        db_session,
        case_id=case.id,
        snapshot=first_snapshot,
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=fixture.admin,
    )
    second_snapshot = _snapshot(automatic, reason="Later supervisor register")
    second_snapshot["replacement_presence_state"] = "absent"
    second = attendance_correction_service.correct(
        db_session,
        case_id=case.id,
        snapshot=second_snapshot,
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=fixture.admin,
    )

    attendance_correction_service.revoke(
        db_session,
        case_id=case.id,
        adjustment_id=second.id,
        reason="Later register was incorrect",
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=fixture.admin,
    )

    active = attendance_correction_service.active_corrections(db_session, [case.id])[case.id]
    assert active.id == first.id
    assert (
        attendance_correction_service.overlay(_automatic_values(automatic), active)[
            "presence_state"
        ]
        == "completed"
    )


def test_correction_and_revocation_do_not_enqueue_automatic_reevaluation(
    db_session,
) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(row for row in fixture.cases if row.shift_code_snapshot == "morning")
    automatic = (
        db_session.query(AttendanceEvaluation)
        .filter_by(attendance_case_id=case.id, revision=1)
        .one()
    )
    queued_before = db_session.query(AttendanceEvaluationQueue).count()
    correction = attendance_correction_service.correct(
        db_session,
        case_id=case.id,
        snapshot=_snapshot(automatic, reason="Supervisor register"),
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=fixture.admin,
    )

    attendance_correction_service.revoke(
        db_session,
        case_id=case.id,
        adjustment_id=correction.id,
        reason="Automatic evidence restored",
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=fixture.admin,
    )

    assert db_session.query(AttendanceEvaluationQueue).count() == queued_before


def test_correction_leaves_the_commit_boundary_with_its_caller(db_session) -> None:
    fixture = build_attendance_day(db_session, operational_date=DAY, posts=[("Gate 1", 1)])
    case = next(row for row in fixture.cases if row.shift_code_snapshot == "morning")
    automatic = (
        db_session.query(AttendanceEvaluation)
        .filter_by(attendance_case_id=case.id, revision=1)
        .one()
    )
    correction = attendance_correction_service.correct(
        db_session,
        case_id=case.id,
        snapshot=_snapshot(automatic, reason="Supervisor register"),
        if_match=attendance_correction_service.case_etag(db_session, case.id),
        actor=fixture.admin,
    )
    correction_id = correction.id

    db_session.rollback()

    assert db_session.get(AttendanceAdjustment, correction_id) is None
