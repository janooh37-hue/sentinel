"""Bounded, FK-safe retention for workforce evidence and derived decisions."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditLog
from app.db.workforce_models import (
    AttendanceAdjustment,
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationPunchSource,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendancePunchAssignment,
    DutyAssignmentEvent,
)
from app.schemas.workforce import WorkforceConfiguration

DEFAULT_BATCH_SIZE = 100
MAX_BATCH_SIZE = 1_000


def _as_db_utc(value: datetime) -> datetime:
    if value.tzinfo is not None:
        value = value.astimezone(UTC)
    return value.replace(tzinfo=None)


def _cutoff(now: datetime, days: int) -> datetime:
    return _as_db_utc(now - timedelta(days=days))


@dataclass(frozen=True)
class WorkforceRetentionResult:
    deleted_cases: int = 0
    deleted_punches: int = 0
    deleted_provider_people: int = 0
    deleted_duty_events: int = 0
    deleted_audits: int = 0

    def counts(self) -> dict[str, int]:
        return {
            "attendance_cases": self.deleted_cases,
            "punches": self.deleted_punches,
            "provider_people": self.deleted_provider_people,
            "duty_events": self.deleted_duty_events,
            "audits": self.deleted_audits,
        }


def _purge_expired_case_units(db: Session, *, cutoff: datetime, batch_size: int) -> int:
    """Delete complete case units child-first, preserving no partial evidence."""
    case_ids = list(
        db.scalars(
            select(AttendanceCase.id)
            .where(AttendanceCase.scheduled_end_at < cutoff)
            .order_by(AttendanceCase.scheduled_end_at, AttendanceCase.id)
            .limit(batch_size)
        )
    )
    if not case_ids:
        return 0
    # Current allocation and corrections point at the case/evaluation and
    # therefore go first.  Evaluation relationships delete source rows before
    # their parent; deleting those rows manually would double-schedule them.
    assignments = db.scalars(
        select(AttendancePunchAssignment).where(AttendancePunchAssignment.attendance_case_id.in_(case_ids))
    ).all()
    adjustments = db.scalars(
        select(AttendanceAdjustment).where(AttendanceAdjustment.attendance_case_id.in_(case_ids))
    ).all()
    evaluations = db.scalars(
        select(AttendanceEvaluation).where(AttendanceEvaluation.attendance_case_id.in_(case_ids))
    ).all()
    for row in [*assignments, *adjustments, *evaluations]:
        db.delete(row)
    cases = db.scalars(select(AttendanceCase).where(AttendanceCase.id.in_(case_ids))).all()
    for attendance_case in cases:
        db.delete(attendance_case)
    db.flush()
    return len(case_ids)


def _purge_unreferenced_punches(db: Session, *, cutoff: datetime, batch_size: int) -> int:
    """Remove only raw punches no retained evidence or current allocation uses."""
    candidates = db.scalars(
        select(AttendancePunch)
        .where(AttendancePunch.occurred_at < cutoff)
        .order_by(AttendancePunch.occurred_at, AttendancePunch.id)
        .limit(batch_size)
    ).all()
    deleted = 0
    for punch in candidates:
        evidence = db.scalar(
            select(AttendanceEvaluationPunchSource.evaluation_id)
            .where(AttendanceEvaluationPunchSource.punch_id == punch.id)
            .limit(1)
        )
        assignment = db.get(AttendancePunchAssignment, punch.id)
        if evidence is not None or assignment is not None:
            continue
        db.delete(punch)
        deleted += 1
    if deleted:
        db.flush()
    return deleted


def _purge_unmapped_provider_people(db: Session, *, cutoff: datetime, batch_size: int) -> int:
    """Retain inactive mappings until both their mapping and punches are gone."""
    candidates = db.scalars(
        select(AttendanceProviderPerson)
        .where(
            AttendanceProviderPerson.active.is_(False),
            AttendanceProviderPerson.last_seen_at < cutoff,
            AttendanceProviderPerson.employee_id.is_(None),
        )
        .order_by(AttendanceProviderPerson.last_seen_at, AttendanceProviderPerson.id)
        .limit(batch_size)
    ).all()
    deleted = 0
    for person in candidates:
        punch = db.scalar(
            select(AttendancePunch.id)
            .where(AttendancePunch.provider_person_id == person.id)
            .limit(1)
        )
        if punch is not None:
            continue
        db.delete(person)
        deleted += 1
    if deleted:
        db.flush()
    return deleted


def _purge_unreferenced_duty_events(db: Session, *, cutoff: datetime, batch_size: int) -> int:
    candidates = db.scalars(
        select(DutyAssignmentEvent)
        .where(DutyAssignmentEvent.effective_at < cutoff)
        .order_by(DutyAssignmentEvent.effective_at, DutyAssignmentEvent.id)
        .limit(batch_size)
    ).all()
    deleted = 0
    for event in candidates:
        referenced_case = db.scalar(
            select(AttendanceCase.id)
            .where(AttendanceCase.duty_assignment_event_id == event.id)
            .limit(1)
        )
        if referenced_case is not None:
            continue
        db.delete(event)
        deleted += 1
    if deleted:
        db.flush()
    return deleted


def _purge_expired_audits(db: Session, *, cutoff: datetime, batch_size: int) -> int:
    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.ts < cutoff)
        .order_by(AuditLog.ts, AuditLog.id)
        .limit(batch_size)
    ).all()
    for row in rows:
        db.delete(row)
    if rows:
        db.flush()
    return len(rows)


def purge_expired_workforce_data(
    db: Session,
    *,
    configuration: WorkforceConfiguration,
    now: datetime,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> WorkforceRetentionResult:
    """Purge one bounded, ordered retention batch and record only aggregate audit data.

    Configuration validation establishes the evidence-retention ordering before
    this function runs.  The service does not catch deletion errors: a failed
    transaction must remain visible rather than silently reporting a partial
    purge as successful.
    """
    if not 1 <= batch_size <= MAX_BATCH_SIZE:
        raise ValueError(f"batch_size must be between 1 and {MAX_BATCH_SIZE}")
    cutoffs = {
        "attendance": _cutoff(now, configuration.attendance_retention_days),
        "punch": _cutoff(now, configuration.punch_retention_days),
        "provider_person": _cutoff(now, configuration.provider_person_retention_days),
        "duty_event": _cutoff(now, configuration.duty_event_retention_days),
        "audit": _cutoff(now, configuration.audit_retention_days),
    }
    deleted_cases = _purge_expired_case_units(
        db, cutoff=cutoffs["attendance"], batch_size=batch_size
    )
    # Evidence links disappear only with their expired case unit.  A retained
    # evaluation link or current allocation blocks a raw source deletion.
    deleted_punches = _purge_unreferenced_punches(
        db, cutoff=cutoffs["punch"], batch_size=batch_size
    )
    deleted_provider_people = _purge_unmapped_provider_people(
        db, cutoff=cutoffs["provider_person"], batch_size=batch_size
    )
    deleted_duty_events = _purge_unreferenced_duty_events(
        db, cutoff=cutoffs["duty_event"], batch_size=batch_size
    )
    deleted_audits = _purge_expired_audits(db, cutoff=cutoffs["audit"], batch_size=batch_size)
    result = WorkforceRetentionResult(
        deleted_cases=deleted_cases,
        deleted_punches=deleted_punches,
        deleted_provider_people=deleted_provider_people,
        deleted_duty_events=deleted_duty_events,
        deleted_audits=deleted_audits,
    )
    db.add(
        AuditLog(
            actor=None,
            action="workforce.retention.purged",
            entity_type="workforce_retention",
            entity_id=None,
            payload=json.dumps(
                {
                    "cutoffs": {name: value.isoformat() for name, value in cutoffs.items()},
                    "counts": result.counts(),
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
            ts=_as_db_utc(now),
        )
    )
    db.flush()
    return result


__all__ = ["WorkforceRetentionResult", "purge_expired_workforce_data"]
