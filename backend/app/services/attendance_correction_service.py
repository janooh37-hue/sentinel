"""Attendance correction lifecycle and read-time projection helpers."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import AuditLog, User
from app.db.workforce_models import (
    AttendanceAdjustment,
    AttendanceCase,
    AttendanceEvaluation,
)
from app.services.workforce_admin_service import etag_for, require_if_match

_SNAPSHOT_KEYS = frozenset(
    {
        "replacement_presence_state",
        "replacement_first_in_at",
        "replacement_latest_in_at",
        "replacement_final_out_at",
        "replacement_late_minutes",
        "replacement_early_exit_minutes",
        "replacement_missing_checkout",
        "reason",
    }
)


def _utc_naive(value: datetime) -> datetime:
    return (
        value.replace(tzinfo=None)
        if value.tzinfo is None
        else value.astimezone(UTC).replace(tzinfo=None)
    )


def _optional_utc_naive(values: Mapping[str, object], key: str) -> datetime | None:
    value = values.get(key)
    if value is None:
        return None
    if not isinstance(value, datetime):
        raise ValidationFailedError("ATTENDANCE_ADJUSTMENT_INVALID", f"{key} must be a datetime.")
    return _utc_naive(value)


def _latest_evaluation(db: Session, case_id: int) -> AttendanceEvaluation:
    row = db.scalar(
        select(AttendanceEvaluation)
        .where(AttendanceEvaluation.attendance_case_id == case_id)
        .order_by(AttendanceEvaluation.revision.desc())
    )
    if row is None:
        raise ConflictError(
            "ATTENDANCE_CASE_VERSION_CONFLICT",
            "Attendance case has no automatic evaluation.",
        )
    return row


def active_correction(
    rows: Sequence[AttendanceAdjustment],
) -> AttendanceAdjustment | None:
    """Return the newest unrevoked correction leaf from oldest-to-newest rows.

    A revoked superseder no longer hides its unrevoked predecessor.
    """
    unrevoked = [row for row in rows if row.revoked_at is None]
    superseded = {
        row.supersedes_adjustment_id
        for row in unrevoked
        if row.supersedes_adjustment_id is not None
    }
    return next((row for row in reversed(unrevoked) if row.id not in superseded), None)


def _active_correction(db: Session, case_id: int) -> AttendanceAdjustment | None:
    rows = list(
        db.scalars(
            select(AttendanceAdjustment)
            .where(AttendanceAdjustment.attendance_case_id == case_id)
            .order_by(AttendanceAdjustment.created_at, AttendanceAdjustment.id)
        )
    )
    return active_correction(rows)


def active_corrections(db: Session, case_ids: Iterable[int]) -> dict[int, AttendanceAdjustment]:
    """Batch the one unrevoked correction leaf for each attendance case."""
    ids = list(case_ids)
    if not ids:
        return {}
    rows_by_case: dict[int, list[AttendanceAdjustment]] = {}
    for row in db.scalars(
        select(AttendanceAdjustment)
        .where(AttendanceAdjustment.attendance_case_id.in_(ids))
        .order_by(
            AttendanceAdjustment.attendance_case_id,
            AttendanceAdjustment.created_at,
            AttendanceAdjustment.id,
        )
    ):
        rows_by_case.setdefault(row.attendance_case_id, []).append(row)
    return {
        case_id: active
        for case_id, rows in rows_by_case.items()
        if (active := active_correction(rows)) is not None
    }


def overlay(
    automatic: Mapping[str, Any], correction: AttendanceAdjustment | None
) -> dict[str, Any]:
    """Apply every field from an active full correction snapshot, including nulls."""
    values = dict(automatic)
    if correction is None:
        return values
    values.update(
        {
            "presence_state": correction.replacement_presence_state,
            "first_in_at": correction.replacement_first_in_at,
            "latest_in_at": correction.replacement_latest_in_at,
            "final_out_at": correction.replacement_final_out_at,
            "late_minutes": correction.replacement_late_minutes,
            "early_exit_minutes": correction.replacement_early_exit_minutes,
            "missing_checkout": correction.replacement_missing_checkout,
            "adjustment_id": correction.id,
        }
    )
    return values


def case_etag_for(
    *,
    case_id: int,
    latest: AttendanceEvaluation | None,
    active: AttendanceAdjustment | None,
) -> str:
    return etag_for(
        {
            "case_id": case_id,
            "automatic_evaluation_id": latest.id if latest else None,
            "automatic_revision": latest.revision if latest else None,
            "active_adjustment_id": active.id if active else None,
            "active_adjustment_revoked_at": active.revoked_at if active else None,
        }
    )


def case_etag(db: Session, case_id: int) -> str:
    return case_etag_for(
        case_id=case_id,
        latest=_latest_evaluation(db, case_id),
        active=_active_correction(db, case_id),
    )


def _audit_created(
    db: Session,
    *,
    actor: User,
    correction: AttendanceAdjustment,
    superseded_id: int | None,
) -> None:
    db.add(
        AuditLog(
            actor=actor.employee_id or actor.email,
            action="workforce.attendance_adjustment.created",
            entity_type="attendance_adjustment",
            entity_id=str(correction.id),
            payload=json.dumps(
                {
                    "before": {"superseded_adjustment_id": superseded_id},
                    "after": {
                        "case_id": correction.attendance_case_id,
                        "base_evaluation_id": correction.base_evaluation_id,
                        "reason": correction.reason,
                    },
                },
                default=str,
            ),
        )
    )


def _audit_revoked(
    db: Session,
    *,
    actor: User,
    correction: AttendanceAdjustment,
    reason: str,
) -> None:
    db.add(
        AuditLog(
            actor=actor.employee_id or actor.email,
            action="workforce.attendance_adjustment.revoked",
            entity_type="attendance_adjustment",
            entity_id=str(correction.id),
            payload=json.dumps(
                {
                    "before": {"revoked_at": None},
                    "after": {"revoked_at": correction.revoked_at, "reason": reason},
                },
                default=str,
            ),
        )
    )


def correct(
    db: Session,
    *,
    case_id: int,
    snapshot: Mapping[str, object],
    if_match: str | None,
    actor: User,
) -> AttendanceAdjustment:
    """Append a full correction snapshot without recalculating automatic attendance."""
    case = db.get(AttendanceCase, case_id)
    if case is None:
        raise NotFoundError("ATTENDANCE_CASE_NOT_FOUND", "Attendance case was not found.")
    current = _active_correction(db, case_id)
    latest = _latest_evaluation(db, case_id)
    require_if_match(
        if_match,
        case_etag(db, case_id),
        code="ATTENDANCE_CASE_VERSION_CONFLICT",
    )
    if set(snapshot) != _SNAPSHOT_KEYS:
        raise ValidationFailedError(
            "ATTENDANCE_ADJUSTMENT_INVALID",
            "Attendance correction must contain a complete effective snapshot.",
        )
    correction = AttendanceAdjustment(
        attendance_case_id=case_id,
        base_evaluation_id=latest.id,
        replacement_presence_state=snapshot.get("replacement_presence_state"),
        replacement_first_in_at=_optional_utc_naive(snapshot, "replacement_first_in_at"),
        replacement_latest_in_at=_optional_utc_naive(snapshot, "replacement_latest_in_at"),
        replacement_final_out_at=_optional_utc_naive(snapshot, "replacement_final_out_at"),
        replacement_late_minutes=snapshot.get("replacement_late_minutes"),
        replacement_early_exit_minutes=snapshot.get("replacement_early_exit_minutes"),
        replacement_missing_checkout=snapshot.get("replacement_missing_checkout"),
        reason=str(snapshot["reason"]).strip(),
        created_by_user_id=actor.id,
        supersedes_adjustment_id=current.id if current else None,
    )
    db.add(correction)
    db.flush()
    _audit_created(
        db,
        actor=actor,
        correction=correction,
        superseded_id=current.id if current else None,
    )
    return correction


def revoke(
    db: Session,
    *,
    case_id: int,
    adjustment_id: int,
    reason: str,
    if_match: str | None,
    actor: User,
    now: datetime | None = None,
) -> AttendanceAdjustment:
    """Revoke one correction without recalculating automatic attendance."""
    correction = db.get(AttendanceAdjustment, adjustment_id)
    if correction is None or correction.attendance_case_id != case_id:
        raise NotFoundError(
            "ATTENDANCE_ADJUSTMENT_NOT_FOUND",
            "Attendance adjustment was not found.",
        )
    require_if_match(
        if_match,
        case_etag(db, case_id),
        code="ATTENDANCE_CASE_VERSION_CONFLICT",
    )
    if correction.revoked_at is not None:
        raise ConflictError(
            "ATTENDANCE_CASE_VERSION_CONFLICT",
            "Attendance adjustment is already revoked.",
        )
    correction.revoked_at = _utc_naive(now or datetime.now(UTC))
    correction.revoked_by_user_id = actor.id
    _audit_revoked(db, actor=actor, correction=correction, reason=reason)
    return correction


__all__ = [
    "active_correction",
    "active_corrections",
    "case_etag",
    "case_etag_for",
    "correct",
    "overlay",
    "revoke",
]
