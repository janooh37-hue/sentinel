"""Submitter service — list, create, delete."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError
from app.db.models import Employee, Submitter
from app.schemas.submitter import SubmitterCreate


def list_submitters(db: Session) -> list[Submitter]:
    """Return all submitters sorted by name."""
    rows = db.execute(select(Submitter).order_by(Submitter.name)).scalars().all()
    return list(rows)


def create_submitter(db: Session, payload: SubmitterCreate) -> Submitter:
    """Create a submitter, validating employee FK and uniqueness."""
    if payload.employee_id is not None:
        emp = db.get(Employee, payload.employee_id)
        if emp is None:
            raise NotFoundError(
                "EMPLOYEE_NOT_FOUND",
                f"Employee '{payload.employee_id}' does not exist",
            )
        existing = db.execute(
            select(Submitter).where(Submitter.employee_id == payload.employee_id)
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError(
                "SUBMITTER_EXISTS",
                f"A submitter for employee '{payload.employee_id}' already exists",
            )
    row = Submitter(
        employee_id=payload.employee_id,
        name=payload.name,
        stored_sig_path=payload.stored_sig_path,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_submitter(db: Session, submitter_id: int) -> None:
    """Hard-delete a submitter row."""
    row = db.get(Submitter, submitter_id)
    if row is None:
        raise NotFoundError("SUBMITTER_NOT_FOUND", f"Submitter {submitter_id} not found")
    db.delete(row)
    db.commit()


def ensure_for_employee(db: Session, employee_id: str) -> Submitter:
    """Return the existing Submitter for ``employee_id`` or create one.

    Idempotent. The created row borrows the employee's ``name_en`` and has
    no ``stored_sig_path`` — the operator fills that in later from the
    Submitter management dialog.
    """
    existing = db.execute(
        select(Submitter).where(Submitter.employee_id == employee_id)
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id} does not exist",
            employee_id=employee_id,
        )

    row = Submitter(
        employee_id=employee_id,
        name=employee.name_en,
        stored_sig_path=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
