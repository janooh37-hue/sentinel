"""Object routes hide people outside the caller's department visibility."""

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import NotFoundError
from app.db.models import Employee, Leave, User, Violation
from app.db.session import get_db
from app.services.department_scope_service import employee_in_scope, resolve_department_scope

Database = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def require_visible_employee(db: Session, user: User, employee_id: str) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None or not employee_in_scope(resolve_department_scope(db, user), employee):
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND", f"Employee {employee_id!r} does not exist", id=employee_id
        )
    return employee


def require_employee_in_scope(request: Request, db: Database, user: CurrentUser) -> None:
    employee_id = request.path_params.get("employee_id")
    if employee_id is not None and not resolve_department_scope(db, user).organization:
        require_visible_employee(db, user, employee_id)


def require_leave_in_scope(request: Request, db: Database, user: CurrentUser) -> None:
    leave_id = request.path_params.get("leave_id")
    scope = resolve_department_scope(db, user)
    if leave_id is None or scope.organization:
        return
    leave = db.get(Leave, leave_id)
    employee = db.get(Employee, leave.employee_id) if leave is not None else None
    if employee is None or not employee_in_scope(scope, employee):
        raise NotFoundError(
            "LEAVE_NOT_FOUND", f"Leave record {leave_id} does not exist", id=leave_id
        )


def require_violation_in_scope(request: Request, db: Database, user: CurrentUser) -> None:
    violation_id = request.path_params.get("violation_id")
    scope = resolve_department_scope(db, user)
    if violation_id is None or scope.organization:
        return
    violation = db.get(Violation, violation_id)
    employee = db.get(Employee, violation.employee_id) if violation is not None else None
    if employee is None or not employee_in_scope(scope, employee):
        raise NotFoundError(
            "VIOLATION_NOT_FOUND", f"Violation {violation_id} does not exist", id=violation_id
        )
