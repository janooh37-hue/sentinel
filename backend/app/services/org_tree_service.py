"""Employee reporting hierarchy reads and supervisor updates."""

from __future__ import annotations

import json
from datetime import date

from fastapi import HTTPException
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    AuditLog,
    Employee,
    TimesheetDesignation,
    TimesheetRosterAssignment,
    User,
)


def list_nodes(db: Session) -> list[tuple[Employee, TimesheetDesignation | None]]:
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
    rows = db.execute(
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
    return [(employee, designation) for employee, designation in rows]


def get_current_designation(db: Session, employee_id: str) -> TimesheetDesignation | None:
    month_start = date.today().replace(day=1)
    return db.scalar(
        select(TimesheetDesignation)
        .select_from(TimesheetRosterAssignment)
        .outerjoin(
            TimesheetDesignation,
            TimesheetDesignation.id == TimesheetRosterAssignment.designation_id,
        )
        .where(
            TimesheetRosterAssignment.employee_id == employee_id,
            TimesheetRosterAssignment.effective_from <= month_start,
        )
        .order_by(TimesheetRosterAssignment.effective_from.desc())
        .limit(1)
    )


def set_supervisor(
    db: Session,
    *,
    employee_id: str,
    supervisor_id: str | None,
    actor: User,
) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    if supervisor_id == employee_id:
        raise HTTPException(status_code=400, detail="An employee cannot supervise themselves")

    supervisor = db.get(Employee, supervisor_id) if supervisor_id is not None else None
    if supervisor_id is not None and supervisor is None:
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
    db.commit()
    db.refresh(employee)
    return employee
