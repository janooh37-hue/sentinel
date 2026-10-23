"""People and Records visibility; capabilities still gate each action."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import SQLColumnExpression, false, func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.core.roles import ADMIN_ROLE
from app.db.models import Book, Department, DepartmentMember, Employee, User
from app.services import perm_service, settings_service


@dataclass(frozen=True)
class DepartmentScope:
    organization: bool
    department_ids: frozenset[int]
    own_employee_id: str | None
    kind: Literal["organization", "department", "self"]


def descendant_department_ids(db: Session, roots: frozenset[int]) -> frozenset[int]:
    if not roots:
        return frozenset()
    tree = select(Department.id).where(Department.id.in_(roots)).cte(recursive=True)
    tree = tree.union(select(Department.id).join(tree, Department.parent_id == tree.c.id))
    return frozenset(db.scalars(select(tree.c.id)))


def resolve_department_scope(
    db: Session, user: User, *, capabilities: set[str] | None = None
) -> DepartmentScope:
    cached: DepartmentScope | None = getattr(user, "_department_scope_cache", None)
    if cached is not None:
        return cached
    organization = (
        not settings_service.get_department_scoping_enabled(db)
        or user.role == ADMIN_ROLE
        or (
            "departments.all" in capabilities
            if capabilities is not None
            else perm_service.has_capability(db, user, "departments.all")
        )
    )
    ids: frozenset[int] = frozenset()
    if not organization:
        memberships = list(
            db.execute(
                select(DepartmentMember.department_id, DepartmentMember.role).where(
                    DepartmentMember.user_id == user.id
                )
            )
        )
        ids = frozenset(department_id for department_id, _ in memberships)
        heads = frozenset(
            department_id for department_id, role in memberships if role in ("head", "deputy")
        )
        ids |= descendant_department_ids(db, heads)
    scope = DepartmentScope(
        organization,
        ids,
        user.employee_id,
        "organization" if organization else "department" if ids else "self",
    )
    user._department_scope_cache = scope
    return scope


def invalidate_department_scope(db: Session, user_id: int) -> None:
    user = db.get(User, user_id)
    if user is not None:
        user._department_scope_cache = None
        user._effective_caps_cache = None


def invalidate_all_department_scopes(db: Session) -> None:
    for mapped in db.identity_map.values():
        if isinstance(mapped, User):
            invalidate_department_scope(db, mapped.id)


def narrow_department_scope(
    db: Session, scope: DepartmentScope, department_id: int | None
) -> DepartmentScope:
    if department_id is None:
        return scope
    requested = descendant_department_ids(db, frozenset({department_id}))
    ids = requested if scope.organization else requested & scope.department_ids
    own = db.get(Employee, scope.own_employee_id) if scope.own_employee_id else None
    own_id = own.id if own is not None and own.department_id in ids else None
    return DepartmentScope(False, ids, own_id, scope.kind)


def employee_visibility_clause(scope: DepartmentScope | None) -> ColumnElement[bool] | None:
    if scope is None or scope.organization:
        return None
    clause = Employee.department_id.in_(scope.department_ids)
    return or_(clause, Employee.id == scope.own_employee_id) if scope.own_employee_id else clause


def employee_fk_visible(
    scope: DepartmentScope | None, column: SQLColumnExpression[str]
) -> ColumnElement[bool] | None:
    clause = employee_visibility_clause(scope)
    return None if clause is None else column.in_(select(Employee.id).where(clause))


def employee_in_scope(scope: DepartmentScope, employee: Employee) -> bool:
    return (
        scope.organization
        or employee.department_id in scope.department_ids
        or (scope.own_employee_id is not None and employee.id == scope.own_employee_id)
    )


def book_department_clause(scope: DepartmentScope, user: User) -> ColumnElement[bool] | None:
    """The department gate only narrows ADR 0006; assignments remain revision-scoped."""
    if scope.organization:
        return None
    from app.services import book_service

    # A two-valued predicate also stays safe when document gates negate it.
    return func.coalesce(
        or_(
            Book.created_by_user_id == user.id,
            Book.submitted_by_user_id == user.id,
            Book.department_id.in_(scope.department_ids),
            book_service.active_recipient_clause(user.id),
            book_service.assignment_access_clause(user.id),
        ),
        false(),
    )


def book_in_scope(db: Session, user: User, book: Book) -> bool:
    """Object mirror of book_department_clause, including retained revision grants."""
    from app.services import book_service

    scope = resolve_department_scope(db, user)
    return (
        scope.organization
        or book.created_by_user_id == user.id
        or book.submitted_by_user_id == user.id
        or book.department_id in scope.department_ids
        or book_service.is_active_recipient(db, user.id, book.id)
        or db.scalar(
            select(Book.id).where(
                Book.id == book.id, book_service.assignment_access_clause(user.id)
            )
        )
        is not None
    )
