"""Workforce scope enforcement and scope-administration boundaries."""

from __future__ import annotations

import json
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.db.models import AuditLog, Employee, User, UserWorkforceScope
from app.schemas.workforce import WorkforceScopeWrite
from app.services.workforce_etag import etag_for, require_if_match
from app.services.workforce_scope_service import (
    WorkforceScope,
    WorkforceScopeEntry,
    intersect_workforce_scope,
    normalize_scope_entry,
    normalize_scope_value,
)

_EMPLOYEE_SCOPE_MESSAGE = "The employee is outside the assigned workforce scope."


def organization_scope() -> WorkforceScope:
    """Return the explicit organization grant used by trusted internal callers."""
    return WorkforceScope(entries=(WorkforceScopeEntry(scope_kind="organization"),))


def allows_hierarchy(
    scope: WorkforceScope,
    *,
    department: str | None,
    duty_unit: str | None,
    duty_post: str | None,
) -> bool:
    """Return whether scope permits a hierarchy target without an employee id."""
    target_department = normalize_scope_value(department)
    target_unit = normalize_scope_value(duty_unit)
    target_post = normalize_scope_value(duty_post)

    if scope.requested_department is not None and target_department != scope.requested_department:
        return False
    if scope.requested_duty_unit is not None and target_unit != scope.requested_duty_unit:
        return False
    if scope.requested_duty_post is not None and target_post != scope.requested_duty_post:
        return False

    for entry in scope.entries:
        if entry.scope_kind == "organization":
            return True
        if entry.scope_kind == "self":
            continue
        if entry.department is not None and entry.department != target_department:
            continue
        if entry.scope_kind == "department":
            return True
        if entry.duty_unit != target_unit:
            continue
        if entry.scope_kind == "duty_unit":
            return True
        if entry.scope_kind == "duty_post" and entry.duty_post == target_post:
            return True
    return False


def forbid_outside_scope(
    scope: WorkforceScope,
    *,
    employee_id: str,
    department: str | None,
    duty_unit: str | None,
    duty_post: str | None,
    message: str = _EMPLOYEE_SCOPE_MESSAGE,
) -> None:
    """Raise the established forbidden error unless explicit values are visible."""
    if scope.allows_employee(
        employee_id=employee_id,
        department=department,
        duty_unit=duty_unit,
        duty_post=duty_post,
    ):
        return
    raise AppError("FORBIDDEN", message, http_status=403)


def employee_in_scope(
    db: Session,
    *,
    scope: WorkforceScope,
    employee_id: str,
    message: str = _EMPLOYEE_SCOPE_MESSAGE,
) -> Employee:
    """Load a live employee and authorize its current hierarchy."""
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundError("WORKFORCE_EMPLOYEE_NOT_FOUND", "Employee was not found.")
    forbid_outside_scope(
        scope,
        employee_id=employee.id,
        department=employee.department,
        duty_unit=employee.duty_unit,
        duty_post=employee.duty_post,
        message=message,
    )
    return employee


def require_organization(scope: WorkforceScope, *, message: str) -> None:
    """Require the explicit organization grant for global workforce changes."""
    if not scope.is_organization:
        raise AppError("FORBIDDEN", message, http_status=403)


def assert_scope_filter(
    scope: WorkforceScope,
    *,
    department: str | None,
    duty_unit: str | None,
    duty_post: str | None,
) -> WorkforceScope:
    """Validate a request filter against scope, then return its intersection."""
    if any(
        value is not None for value in (department, duty_unit, duty_post)
    ) and not allows_hierarchy(
        scope,
        department=department,
        duty_unit=duty_unit,
        duty_post=duty_post,
    ):
        raise AppError(
            "FORBIDDEN",
            "Requested filter is outside workforce scope.",
            http_status=403,
        )
    return intersect_workforce_scope(
        scope,
        department=department,
        duty_unit=duty_unit,
        duty_post=duty_post,
    )


def intersect_coverage_scope(
    scope: WorkforceScope,
    *,
    department: str | None,
    duty_unit: str | None,
) -> WorkforceScope:
    """Allow a selected hierarchy ancestor without widening a narrower grant."""
    if department is None and duty_unit is None:
        return scope
    for entry in scope.entries:
        if entry.scope_kind == "organization":
            return intersect_workforce_scope(
                scope,
                department=department,
                duty_unit=duty_unit,
            )
        if entry.scope_kind == "self":
            continue
        if entry.department is not None and entry.department != department:
            continue
        if (
            duty_unit is not None
            and entry.scope_kind != "department"
            and entry.duty_unit != duty_unit
        ):
            continue
        return intersect_workforce_scope(
            scope,
            department=department,
            duty_unit=duty_unit,
        )
    raise AppError(
        "FORBIDDEN",
        "Requested filter is outside workforce scope.",
        http_status=403,
    )


def _scope_rows(db: Session, user_id: int) -> list[UserWorkforceScope]:
    return list(
        db.scalars(
            select(UserWorkforceScope)
            .where(UserWorkforceScope.user_id == user_id)
            .order_by(
                UserWorkforceScope.scope_kind,
                UserWorkforceScope.department,
                UserWorkforceScope.duty_unit,
                UserWorkforceScope.duty_post,
            )
        )
    )


def scope_payload(rows: Sequence[UserWorkforceScope]) -> list[dict[str, str | None]]:
    return [
        {
            "scope_kind": row.scope_kind,
            "department": row.department,
            "duty_unit": row.duty_unit,
            "duty_post": row.duty_post,
        }
        for row in rows
    ]


def user_scopes(
    db: Session,
    *,
    user_id: int,
) -> tuple[list[UserWorkforceScope], str]:
    """Return a target user's normalized persisted scope set and its ETag."""
    if db.get(User, user_id) is None:
        raise NotFoundError("USER_NOT_FOUND", "User was not found.")
    rows = _scope_rows(db, user_id)
    return rows, etag_for(scope_payload(rows))


def replace_user_scopes(
    db: Session,
    *,
    user_id: int,
    scopes: Sequence[WorkforceScopeWrite],
    if_match: str | None,
    actor: User,
) -> tuple[list[UserWorkforceScope], str]:
    """Stage one normalized scope-set replacement; the route owns the commit."""
    _, current_etag = user_scopes(db, user_id=user_id)
    require_if_match(if_match, current_etag)
    normalized = [
        normalize_scope_entry(
            scope_kind=scope.scope_kind,
            department=scope.department,
            duty_unit=scope.duty_unit,
            duty_post=scope.duty_post,
        )
        for scope in scopes
    ]
    if len(set(normalized)) != len(normalized):
        raise ValidationFailedError(
            "DUPLICATE_WORKFORCE_SCOPE",
            "Scope replacement contains a duplicate grant.",
        )

    db.execute(delete(UserWorkforceScope).where(UserWorkforceScope.user_id == user_id))
    for entry in normalized:
        db.add(
            UserWorkforceScope(
                user_id=user_id,
                scope_kind=entry.scope_kind,
                department=entry.department,
                duty_unit=entry.duty_unit,
                duty_post=entry.duty_post,
                created_by_user_id=actor.id,
            )
        )
    db.add(
        AuditLog(
            actor=actor.employee_id or actor.email,
            action="workforce.scope.replaced",
            entity_type="user_workforce_scope",
            entity_id=str(user_id),
            payload=json.dumps({"scope_count": len(normalized)}),
        )
    )
    db.flush()
    rows = _scope_rows(db, user_id)
    return rows, etag_for(scope_payload(rows))


__all__ = [
    "allows_hierarchy",
    "assert_scope_filter",
    "employee_in_scope",
    "forbid_outside_scope",
    "intersect_coverage_scope",
    "organization_scope",
    "replace_user_scopes",
    "require_organization",
    "scope_payload",
    "user_scopes",
]
