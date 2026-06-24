"""Employee read/write helpers used by the routes.

Keeps two responsibilities in one place because they're inseparable:

1. Translating between SQLAlchemy rows and Pydantic schemas.
2. Re-running the ``status``/``end_date`` invariant on PATCH after merging
   the partial payload against the current row — the schema can't do this
   because it doesn't see the existing values.

Pagination uses ``limit``/``offset`` (not cursors) because the working set
is small (272 employees in live data) and the React side already wants a
``total`` count for the list header.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import Employee
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeUpdate,
    validate_status_end_date,
)

LIST_MAX_LIMIT = 500
LIST_DEFAULT_LIMIT = 100


def list_employees(
    db: Session,
    *,
    q: str | None = None,
    status: str | None = None,
    department: str | None = None,
    duty_unit: str | None = None,
    limit: int = LIST_DEFAULT_LIMIT,
    offset: int = 0,
) -> tuple[list[Employee], int]:
    """Filtered + paginated list. Returns ``(rows, total_count)``."""
    limit = max(1, min(limit, LIST_MAX_LIMIT))
    offset = max(0, offset)

    stmt = select(Employee)
    count_stmt = select(func.count()).select_from(Employee)

    if q:
        needle = f"%{q.strip()}%"
        clause = or_(
            Employee.id.ilike(needle),
            Employee.name_en.ilike(needle),
            Employee.name_ar.ilike(needle),
        )
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)
    if status:
        stmt = stmt.where(Employee.status == status)
        count_stmt = count_stmt.where(Employee.status == status)
    if department:
        stmt = stmt.where(Employee.department == department)
        count_stmt = count_stmt.where(Employee.department == department)
    if duty_unit:
        stmt = stmt.where(Employee.duty_unit == duty_unit)
        count_stmt = count_stmt.where(Employee.duty_unit == duty_unit)

    stmt = stmt.order_by(Employee.name_en).limit(limit).offset(offset)

    rows = list(db.execute(stmt).scalars().all())
    total = int(db.execute(count_stmt).scalar_one())
    return rows, total


def get_employee(db: Session, employee_id: str) -> Employee:
    row = db.get(Employee, employee_id)
    if row is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id!r} does not exist",
            id=employee_id,
        )
    return row


def create_employee(db: Session, payload: EmployeeCreate) -> Employee:
    existing = db.get(Employee, payload.id)
    if existing is not None:
        raise ConflictError(
            "EMPLOYEE_EXISTS",
            f"Employee {payload.id!r} already exists",
            id=payload.id,
        )
    row = Employee(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_employee(
    db: Session, employee_id: str, payload: EmployeeUpdate
) -> Employee:
    row = get_employee(db, employee_id)
    data: dict[str, Any] = payload.model_dump(exclude_unset=True)

    # Merge the patch over the current row to evaluate the invariant.
    merged_status = data.get("status", row.status)
    merged_end = data.get("end_date", row.end_date)
    try:
        validate_status_end_date(merged_status, merged_end)
    except ValueError as exc:
        raise ValidationFailedError(
            "EMPLOYEE_INVALID_STATUS_END_DATE",
            str(exc),
            status=merged_status,
            end_date=str(merged_end) if merged_end else None,
        ) from exc

    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


__all__ = [
    "LIST_DEFAULT_LIMIT",
    "LIST_MAX_LIMIT",
    "create_employee",
    "get_employee",
    "list_employees",
    "update_employee",
]
