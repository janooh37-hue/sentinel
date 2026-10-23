"""Derive department membership from the org tree (rework R).

A department is its head employee plus everyone under them. ``recompute`` is the
only writer of ``employees.department_id`` and ``departments.parent_id``; call it
after every write that can change the result (supervisor links, employee inserts,
department create/update/delete and exception changes).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.db.models import Department, DepartmentException, Employee

_UNSET = object()


def _resolver(
    supervisors: dict[str, str | None],
    heads: dict[str, int],
    exceptions: dict[str, int | None],
) -> dict[str, int | None]:
    """passdown(e) for every employee; nodes on a supervisor cycle resolve to None."""
    resolved: dict[str, int | None] = {}

    def anchor(employee_id: str) -> object:
        if employee_id in heads:
            return heads[employee_id]
        if employee_id in exceptions:
            return exceptions[employee_id]
        return _UNSET

    for start in supervisors:
        path: list[str] = []
        on_path: set[str] = set()
        node: str | None = start
        value: int | None = None
        while node is not None:
            if node in resolved:
                value = resolved[node]
                break
            if node in on_path:
                # Dirty data: everything still on this walk resolves to None.
                value = None
                break
            found = anchor(node)
            path.append(node)
            on_path.add(node)
            if found is not _UNSET:
                value = found  # type: ignore[assignment]
                # The anchor itself resolves to its own value; walkers below inherit it.
                break
            parent = supervisors.get(node)
            node = parent if parent in supervisors else None
        for item in path:
            resolved[item] = value
    return resolved


def derive(db: Session) -> tuple[dict[str, int | None], dict[int, int | None]]:
    """Return (employee -> department, department -> parent) from current rows."""
    supervisors = dict(db.execute(select(Employee.id, Employee.supervisor_id)).tuples().all())
    departments = list(
        db.execute(select(Department.id, Department.head_employee_id, Department.active))
    )
    active = {did for did, _, is_active in departments if is_active}
    heads = {head: did for did, head, is_active in departments if is_active}
    exceptions: dict[str, int | None] = {}
    for employee_id, department_id in db.execute(
        select(DepartmentException.employee_id, DepartmentException.department_id)
    ):
        # An exception to an inactive department falls through like an inactive head.
        if department_id is None or department_id in active:
            exceptions[employee_id] = department_id
    membership = _resolver(supervisors, heads, exceptions)
    parents: dict[int, int | None] = {}
    for did, head, _ in departments:
        supervisor = supervisors.get(head)
        parent = membership.get(supervisor) if supervisor is not None else None
        parents[did] = parent if parent != did else None
    # Break derived department cycles (possible only with a cyclic supervisor chain).
    for did in list(parents):
        seen: list[int] = []
        current: int | None = did
        while current is not None and current not in seen:
            seen.append(current)
            current = parents.get(current)
        if current is not None:
            cycle_start = seen.index(current)
            for item in seen[cycle_start:]:
                parents[item] = None
    return membership, parents


def tree_only_membership(db: Session) -> dict[str, int | None]:
    """What the org tree alone gives each employee, ignoring every exception."""
    supervisors = dict(db.execute(select(Employee.id, Employee.supervisor_id)).tuples().all())
    heads = dict(
        db.execute(
            select(Department.head_employee_id, Department.id).where(Department.active.is_(True))
        )
        .tuples()
        .all()
    )
    return _resolver(supervisors, heads, {})


def recompute(db: Session) -> int:
    """Materialize derived departments and parents; return the changed row count."""
    from app.services import department_scope_service

    db.flush()  # Sessions run with autoflush=False; derive from pending edits too.
    membership, parents = derive(db)
    names = dict(db.execute(select(Department.id, Department.name_ar)).tuples().all())
    changed = 0
    for employee_id, current, label in db.execute(
        select(Employee.id, Employee.department_id, Employee.department)
    ).all():
        target = membership.get(employee_id)
        values: dict[str, object] = {}
        if target != current:
            values["department_id"] = target
        if target is not None:
            if label != names[target]:
                values["department"] = names[target]
        elif current is not None and label is not None and label == names.get(current):
            values["department"] = None
        if values:
            # Through the ORM so callers' loaded Employee objects stay current.
            row = db.get(Employee, employee_id)
            assert row is not None
            for key, value in values.items():
                setattr(row, key, value)
            if "department_id" in values:
                changed += 1
    # Few rows: assign through the ORM so identity-mapped objects stay current.
    for department in db.scalars(select(Department)):
        if parents.get(department.id) != department.parent_id:
            department.parent_id = parents.get(department.id)
            changed += 1
    db.flush()
    department_scope_service.invalidate_all_department_scopes(db)
    return changed


def reject_head_exception(db: Session, employee_id: str) -> None:
    """Call after flushing the change: an active head cannot also carry an exception."""
    has_exception = (
        db.scalar(
            select(DepartmentException.employee_id).where(
                DepartmentException.employee_id == employee_id
            )
        )
        is not None
    )
    heads_active = (
        db.scalar(
            select(Department.id).where(
                Department.head_employee_id == employee_id, Department.active.is_(True)
            )
        )
        is not None
    )
    if has_exception and heads_active:
        db.rollback()
        raise ValidationFailedError(
            "DEPARTMENT_HEAD_EXCEPTION",
            "A department head cannot have a department exception; clear it first.",
        )
