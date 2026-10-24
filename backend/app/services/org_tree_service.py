"""Employee reporting hierarchy reads and supervisor updates."""

from __future__ import annotations

import json
from datetime import date

from fastapi import HTTPException
from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    AuditLog,
    Employee,
    TimesheetDesignation,
    TimesheetRosterAssignment,
    User,
)
from app.services import department_tree_service
from app.services.department_scope_service import (
    DepartmentScope,
    employee_in_scope,
    employee_visibility_clause,
)


def _employee_designations() -> Select[Employee, TimesheetDesignation]:
    """One current roster designation per employee, effective at this month's start."""
    month_start = date.today().replace(day=1)
    latest = (
        select(
            TimesheetRosterAssignment.employee_id,
            func.max(TimesheetRosterAssignment.effective_from).label("effective_from"),
        )
        .where(TimesheetRosterAssignment.effective_from <= month_start)
        .group_by(TimesheetRosterAssignment.employee_id)
        .subquery()
    )
    return (
        select(Employee, TimesheetDesignation)
        .outerjoin(latest, latest.c.employee_id == Employee.id)
        .outerjoin(
            TimesheetRosterAssignment,
            and_(
                TimesheetRosterAssignment.employee_id == latest.c.employee_id,
                TimesheetRosterAssignment.effective_from == latest.c.effective_from,
            ),
        )
        .outerjoin(
            TimesheetDesignation,
            TimesheetDesignation.id == TimesheetRosterAssignment.designation_id,
        )
        .order_by(Employee.id)
    )


def list_nodes(
    db: Session, *, scope: DepartmentScope | None = None
) -> list[tuple[Employee, TimesheetDesignation | None]]:
    stmt = _employee_designations()
    visibility = employee_visibility_clause(scope)
    if visibility is not None:
        stmt = stmt.where(visibility)
    rows = db.execute(stmt)
    return [(employee, designation) for employee, designation in rows]


def get_current_designation(db: Session, employee_id: str) -> TimesheetDesignation | None:
    row = db.execute(_employee_designations().where(Employee.id == employee_id)).first()
    return row[1] if row is not None else None


def set_supervisor(
    db: Session,
    *,
    employee_id: str,
    supervisor_id: str | None,
    actor: User,
    scope: DepartmentScope | None = None,
) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None or (scope is not None and not employee_in_scope(scope, employee)):
        raise HTTPException(status_code=404, detail="Employee not found")

    if supervisor_id == employee_id:
        raise HTTPException(status_code=400, detail="An employee cannot supervise themselves")

    supervisor = db.get(Employee, supervisor_id) if supervisor_id is not None else None
    if supervisor_id is not None and (
        supervisor is None or (scope is not None and not employee_in_scope(scope, supervisor))
    ):
        raise HTTPException(status_code=404, detail="Supervisor not found")

    current = supervisor
    seen: set[str] = set()
    while current is not None and current.id not in seen:
        assert supervisor is not None
        if current.id == employee_id:
            raise HTTPException(
                status_code=409,
                detail=f"{supervisor.name_en} already reports to {employee.name_en}",
            )
        seen.add(current.id)
        current = (
            db.get(Employee, current.supervisor_id) if current.supervisor_id is not None else None
        )

    previous = employee.supervisor_id
    employee.supervisor_id = supervisor_id
    db.add(
        AuditLog(
            actor=actor.employee_id or actor.email,
            action="org_tree.supervisor.changed",
            entity_type="employee",
            entity_id=employee_id,
            payload=json.dumps({"before": previous, "after": supervisor_id}),
        )
    )
    # Membership follows supervisor links.
    department_tree_service.recompute(db)
    db.commit()
    db.refresh(employee)
    return employee
