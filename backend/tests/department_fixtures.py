"""Org-tree department builders shared by department tests (rework R)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import Department, DepartmentException, DepartmentMember, Employee, User
from app.services import department_tree_service, settings_service


def employee(db: Session, employee_id: str, supervisor: str | None = None, **fields) -> Employee:
    """Add an employee under ``supervisor`` (flush only)."""
    row = Employee(
        id=employee_id,
        name_en=fields.pop("name_en", employee_id),
        supervisor_id=supervisor,
        **fields,
    )
    db.add(row)
    db.flush()
    return row


def link(db: Session, user: User, employee_id: str) -> User:
    user.employee_id = employee_id
    db.flush()
    return user


def department(
    db: Session,
    name_en: str,
    head_employee_id: str,
    *,
    name_ar: str | None = None,
    active: bool = True,
) -> Department:
    """Mark ``head_employee_id`` as a department head, recompute and commit."""
    row = Department(
        name_en=name_en,
        name_ar=name_ar or f"{name_en} ع",
        head_employee_id=head_employee_id,
        active=active,
    )
    db.add(row)
    db.flush()
    department_tree_service.recompute(db)
    db.commit()
    return row


def grant(db: Session, department_id: int, user: User, role: str) -> DepartmentMember:
    """Deputy or viewer grant (does not affect derivation)."""
    row = DepartmentMember(department_id=department_id, user_id=user.id, role=role)
    db.add(row)
    db.commit()
    return row


def exception(db: Session, employee_id: str, department_id: int | None) -> None:
    db.merge(DepartmentException(employee_id=employee_id, department_id=department_id))
    db.flush()
    department_tree_service.recompute(db)
    db.commit()


def recompute(db: Session) -> None:
    department_tree_service.recompute(db)
    db.commit()


def enable_scoping(db: Session) -> None:
    settings_service.set_audited_setting(
        db,
        "settings.department_scoping_enabled",
        True,
        actor="admin@test.ae",
        action="department_scoping.enabled",
        entity_type="settings",
        entity_id="department_scoping_enabled",
    )
    # Like department_service.set_scoping, turning the switch on syncs labels.
    recompute(db)
