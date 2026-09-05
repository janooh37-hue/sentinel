"""Short, audited workforce administration transactions.

Network providers are intentionally absent.  Callers open no provider connection while
using these write functions, and own only the final commit boundary.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import AuditLog, Employee, User
from app.db.workforce_models import (
    AttendanceProviderPerson,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkShiftOccurrence,
    WorkShiftOverride,
)
from app.services.workforce_access_service import require_organization
from app.services.workforce_etag import etag_for, require_if_match, row_etag
from app.services.workforce_scope_service import WorkforceScope

_ORGANIZATION_SCHEDULE_MESSAGE = (
    "Organization workforce scope is required for crew and anchor changes."
)
_ORGANIZATION_WORKFORCE_MESSAGE = "Organization workforce scope is required for this change."


def _utc_naive(value: datetime) -> datetime:
    return (
        value.replace(tzinfo=None)
        if value.tzinfo is None
        else value.astimezone(UTC).replace(tzinfo=None)
    )


def _require_int(values: Mapping[str, object], key: str) -> int:
    """Narrow a validated payload value, failing loudly on an unexpected shape.

    Callers pass `model_dump()` output, so the value is already schema-checked;
    this keeps that guarantee visible to the type checker without a blind cast.
    """
    value = values[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationFailedError("WORKFORCE_POLICY_INVALID", f"{key} must be an integer.")
    return value


def _actor(user: User) -> str:
    return user.employee_id or user.email


def _audit(
    db: Session,
    *,
    user: User,
    action: str,
    entity_type: str,
    entity_id: int | str | None,
    before: object | None = None,
    after: object | None = None,
) -> None:
    db.add(
        AuditLog(
            actor=_actor(user),
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            payload=json.dumps({"before": before, "after": after}, default=str),
        )
    )


def _acquire_crew_write_lock(db: Session) -> None:
    """Use the schedule write lock because crews are schedule administration state."""

    from app.services.workforce_schedule_service import acquire_schedule_write_lock

    acquire_schedule_write_lock(db)


def _crew_is_referenced(db: Session, crew_id: int) -> bool:
    return any(
        db.scalar(select(model.id).where(model.crew_id == crew_id).limit(1)) is not None
        for model in (
            WorkCrewSchedule,
            WorkCrewMembership,
            WorkShiftOccurrence,
            WorkShiftOverride,
        )
    )


def crew_collection_etag(rows: Iterable[WorkCrew]) -> str:
    """Return the canonical ID-ordered version of the global crew collection."""
    return etag_for(
        [
            {
                "id": row.id,
                "updated_at": row.updated_at,
                "created_at": row.created_at,
            }
            for row in sorted(rows, key=lambda item: item.id)
        ]
    )


def create_crew(
    db: Session,
    *,
    scope: WorkforceScope,
    if_match: str | None,
    payload: Mapping[str, object],
    actor: User,
) -> WorkCrew:
    require_organization(scope, message=_ORGANIZATION_SCHEDULE_MESSAGE)
    _acquire_crew_write_lock(db)
    current = list(db.scalars(select(WorkCrew).order_by(WorkCrew.id)))
    require_if_match(if_match, crew_collection_etag(current))
    code = str(payload["code"]).strip()
    if db.scalar(select(WorkCrew).where(WorkCrew.code == code)) is not None:
        raise ConflictError("WORKFORCE_VERSION_CONFLICT", "Crew code already exists.")
    crew = WorkCrew(
        code=code,
        name_en=payload.get("name_en") or None,
        name_ar=payload.get("name_ar") or None,
        active=bool(payload.get("active", True)),
    )
    db.add(crew)
    db.flush()
    _audit(
        db,
        user=actor,
        action="workforce.crew.created",
        entity_type="work_crew",
        entity_id=crew.id,
        after={"code": crew.code, "active": crew.active},
    )
    return crew


def update_crew(
    db: Session,
    *,
    scope: WorkforceScope,
    crew_id: int,
    payload: Mapping[str, object],
    if_match: str | None,
    actor: User,
) -> WorkCrew:
    require_organization(scope, message=_ORGANIZATION_SCHEDULE_MESSAGE)
    _acquire_crew_write_lock(db)
    crew = db.get(WorkCrew, crew_id)
    if crew is None:
        raise NotFoundError("WORKFORCE_CREW_NOT_FOUND", "Crew was not found.")
    require_if_match(if_match, row_etag(crew))
    before = {
        "code": crew.code,
        "name_en": crew.name_en,
        "name_ar": crew.name_ar,
        "active": crew.active,
    }
    code = payload.get("code")
    if code is not None and str(code).strip() != crew.code and _crew_is_referenced(db, crew.id):
        raise ValidationFailedError(
            "WORKFORCE_CREW_CODE_IMMUTABLE",
            "Crew code cannot change after the crew is referenced.",
        )
    if code is not None and str(code).strip() != crew.code:
        duplicate = db.scalar(
            select(WorkCrew.id).where(
                WorkCrew.code == str(code).strip(),
                WorkCrew.id != crew.id,
            )
        )
        if duplicate is not None:
            raise ConflictError("WORKFORCE_VERSION_CONFLICT", "Crew code already exists.")
    for key in ("code", "name_en", "name_ar", "active"):
        if key in payload:
            value = payload[key]
            setattr(
                crew,
                key,
                str(value).strip()
                if key in {"code", "name_en", "name_ar"} and value is not None
                else value,
            )
    if not crew.name_en and not crew.name_ar:
        raise ValidationFailedError(
            "WORKFORCE_CREW_NAME_REQUIRED",
            "Crew must retain an English or Arabic name.",
        )
    db.flush()
    _audit(
        db,
        user=actor,
        action="workforce.crew.updated",
        entity_type="work_crew",
        entity_id=crew.id,
        before=before,
        after={
            "code": crew.code,
            "name_en": crew.name_en,
            "name_ar": crew.name_ar,
            "active": crew.active,
        },
    )
    return crew


def retire_crew(
    db: Session,
    *,
    scope: WorkforceScope,
    crew_id: int,
    if_match: str | None,
    actor: User,
) -> WorkCrew:
    """Retire a named crew without deleting its historical identity."""

    require_organization(scope, message=_ORGANIZATION_SCHEDULE_MESSAGE)
    _acquire_crew_write_lock(db)
    crew = db.get(WorkCrew, crew_id)
    if crew is None:
        raise NotFoundError("WORKFORCE_CREW_NOT_FOUND", "Crew was not found.")
    require_if_match(if_match, row_etag(crew))
    before = {"active": crew.active}
    crew.active = False
    db.flush()
    _audit(
        db,
        user=actor,
        action="workforce.crew.retired",
        entity_type="work_crew",
        entity_id=crew.id,
        before=before,
        after={"active": crew.active},
    )
    return crew


def create_attendance_policy(
    db: Session,
    *,
    scope: WorkforceScope,
    payload: Mapping[str, object],
    actor: User,
) -> WorkAttendancePolicy:
    require_organization(scope, message=_ORGANIZATION_WORKFORCE_MESSAGE)
    values = dict(payload)
    policy = WorkAttendancePolicy(
        shift_definition_id=values.get("shift_definition_id"),
        grace_minutes=_require_int(values, "grace_minutes"),
        absence_after_minutes=_require_int(values, "absence_after_minutes"),
        early_exit_grace_minutes=_require_int(values, "early_exit_grace_minutes"),
        match_before_minutes=_require_int(values, "match_before_minutes"),
        match_after_minutes=_require_int(values, "match_after_minutes"),
        require_checkout=bool(values["require_checkout"]),
        effective_from=values["effective_from"],
        effective_to=values.get("effective_to"),
        created_by_user_id=actor.id,
    )
    db.add(policy)
    db.flush()
    _audit(
        db,
        user=actor,
        action="workforce.attendance_policy.created",
        entity_type="work_attendance_policy",
        entity_id=policy.id,
        after={"effective_from": policy.effective_from, "effective_to": policy.effective_to},
    )
    return policy


def approve_attendance_policy(
    db: Session,
    *,
    scope: WorkforceScope,
    policy_id: int,
    if_match: str | None,
    actor: User,
    now: datetime | None = None,
) -> WorkAttendancePolicy:
    require_organization(scope, message=_ORGANIZATION_WORKFORCE_MESSAGE)
    policy = db.get(WorkAttendancePolicy, policy_id)
    if policy is None:
        raise NotFoundError("WORKFORCE_POLICY_NOT_FOUND", "Attendance policy was not found.")
    require_if_match(if_match, row_etag(policy))
    if policy.approved_at is not None:
        raise ConflictError("WORKFORCE_VERSION_CONFLICT", "Attendance policy is already approved.")
    policy.approved_by_user_id = actor.id
    policy.approved_at = _utc_naive(now or datetime.now(UTC))
    _audit(
        db,
        user=actor,
        action="workforce.attendance_policy.approved",
        entity_type="work_attendance_policy",
        entity_id=policy.id,
        before={"approved_at": None},
        after={"approved_at": policy.approved_at},
    )
    return policy


def update_provider_mapping(
    db: Session,
    *,
    scope: WorkforceScope,
    person_id: int,
    employee_id: str | None,
    mapping_state: str,
    if_match: str | None,
    actor: User,
    now: datetime | None = None,
) -> AttendanceProviderPerson:
    require_organization(scope, message=_ORGANIZATION_WORKFORCE_MESSAGE)
    row = db.get(AttendanceProviderPerson, person_id)
    if row is None:
        raise NotFoundError(
            "ATTENDANCE_PROVIDER_PERSON_NOT_FOUND", "Provider person was not found."
        )
    require_if_match(
        if_match,
        row_etag(row, extra={"mapping_state": row.mapping_state, "employee_id": row.employee_id}),
    )
    before = {"employee_id": row.employee_id, "mapping_state": row.mapping_state}
    if mapping_state == "verified":
        if not employee_id or db.get(Employee, employee_id) is None:
            raise ValueError("Verified mapping requires an existing employee")
        duplicate = db.scalar(
            select(AttendanceProviderPerson).where(
                AttendanceProviderPerson.employee_id == employee_id,
                AttendanceProviderPerson.mapping_state == "verified",
                AttendanceProviderPerson.active.is_(True),
                AttendanceProviderPerson.id != row.id,
            )
        )
        if duplicate is not None:
            raise ConflictError(
                "WORKFORCE_VERSION_CONFLICT", "Employee already has a verified provider mapping."
            )
        row.employee_id = employee_id
        row.verified_by_user_id = actor.id
        row.verified_at = _utc_naive(now or datetime.now(UTC))
    else:
        row.employee_id = None
        row.verified_by_user_id = None
        row.verified_at = None
    row.mapping_state = mapping_state
    _audit(
        db,
        user=actor,
        action="workforce.provider_mapping.updated",
        entity_type="attendance_provider_person",
        entity_id=row.id,
        before=before,
        after={"employee_id": row.employee_id, "mapping_state": row.mapping_state},
    )
    return row


__all__ = [
    "approve_attendance_policy",
    "create_attendance_policy",
    "create_crew",
    "crew_collection_etag",
    "etag_for",
    "require_if_match",
    "retire_crew",
    "row_etag",
    "update_crew",
    "update_provider_mapping",
]
