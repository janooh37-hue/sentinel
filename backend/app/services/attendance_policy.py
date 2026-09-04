"""Approved attendance policy resolution for materialized attendance cases."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select
from sqlalchemy.sql.elements import ColumnElement

from app.db.workforce_models import AttendanceCase, WorkAttendancePolicy, WorkShiftOccurrence


def _policy_statement(
    *,
    operational_date: date,
    shift_definition_id: int | ColumnElement[int] | None,
) -> Select[tuple[WorkAttendancePolicy]]:
    return (
        select(WorkAttendancePolicy)
        .where(
            WorkAttendancePolicy.approved_at.is_not(None),
            WorkAttendancePolicy.effective_from <= operational_date,
            or_(
                WorkAttendancePolicy.effective_to.is_(None),
                WorkAttendancePolicy.effective_to > operational_date,
            ),
            or_(
                WorkAttendancePolicy.shift_definition_id.is_(None),
                WorkAttendancePolicy.shift_definition_id == shift_definition_id,
            ),
        )
        .order_by(
            WorkAttendancePolicy.shift_definition_id.is_not(None).desc(),
            WorkAttendancePolicy.effective_from.desc(),
            WorkAttendancePolicy.id.desc(),
        )
    )


def policy_for(
    db: Session,
    *,
    operational_date: date,
    shift_definition_id: int | None,
) -> WorkAttendancePolicy | None:
    """Return the most-specific approved policy in force on an operational date."""
    return db.scalars(
        _policy_statement(
            operational_date=operational_date,
            shift_definition_id=shift_definition_id,
        )
    ).first()


def policy_for_case(
    db: Session,
    case: AttendanceCase,
    *,
    override_shift_definition_id: int | None = None,
) -> WorkAttendancePolicy | None:
    """Resolve policy from the case occurrence, then a caller-supplied fallback shift."""
    if case.shift_occurrence_id is None:
        return policy_for(
            db,
            operational_date=case.operational_date,
            shift_definition_id=override_shift_definition_id,
        )
    occurrence_shift_definition_id = (
        select(WorkShiftOccurrence.shift_definition_id)
        .where(WorkShiftOccurrence.id == case.shift_occurrence_id)
        .scalar_subquery()
    )
    shift_definition_id = func.coalesce(
        occurrence_shift_definition_id,
        override_shift_definition_id,
    )
    return db.scalars(
        _policy_statement(
            operational_date=case.operational_date,
            shift_definition_id=shift_definition_id,
        )
    ).first()


__all__ = ["policy_for", "policy_for_case"]
