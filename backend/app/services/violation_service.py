"""Violation CRUD — owned exclusively by the Employees tab.

v3.5.4 surfaced Violations as an inner tab under Employees (line 3127) rather
than as its own top-level tab, so the API mirrors that: list/create scope to
``/employees/{id}/violations``, while update/delete operate on the violation
ID directly because the employee context isn't required for those.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.db.models import Employee, Violation
from app.schemas.violation import ViolationCreate, ViolationUpdate


def _get_employee_or_404(db: Session, employee_id: str) -> Employee:
    row = db.get(Employee, employee_id)
    if row is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id!r} does not exist",
            id=employee_id,
        )
    return row


def list_for_employee(db: Session, employee_id: str) -> list[Violation]:
    _get_employee_or_404(db, employee_id)
    stmt = (
        select(Violation)
        .where(Violation.employee_id == employee_id)
        .order_by(Violation.date.desc(), Violation.id.desc())
    )
    return list(db.execute(stmt).scalars().all())


def get(db: Session, violation_id: int) -> Violation:
    row = db.get(Violation, violation_id)
    if row is None:
        raise NotFoundError(
            "VIOLATION_NOT_FOUND",
            f"Violation {violation_id} does not exist",
            id=violation_id,
        )
    return row


def create(
    db: Session, employee_id: str, payload: ViolationCreate
) -> Violation:
    _get_employee_or_404(db, employee_id)
    data = payload.model_dump()
    # Route-supplied employee_id always wins over body field — the body's
    # employee_id is kept for symmetry with bulk-create use cases later.
    data["employee_id"] = employee_id
    row = Violation(**data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update(db: Session, violation_id: int, payload: ViolationUpdate) -> Violation:
    row = get(db, violation_id)
    data: dict[str, Any] = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


def delete(db: Session, violation_id: int) -> None:
    row = get(db, violation_id)
    db.delete(row)
    db.commit()


__all__ = ["create", "delete", "get", "list_for_employee", "update"]
