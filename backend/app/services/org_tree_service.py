"""Employee reporting hierarchy reads and supervisor updates."""

from __future__ import annotations

import json

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditLog, Employee, User


def list_nodes(db: Session) -> list[Employee]:
    return list(db.scalars(select(Employee).order_by(Employee.id)))


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
        if current.id == employee_id:
            raise HTTPException(
                status_code=409,
                detail=f"{supervisor.name_en} already reports to {employee.name_en}",
            )
        seen.add(current.id)
        current = (
            db.get(Employee, current.supervisor_id)
            if current.supervisor_id is not None
            else None
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
