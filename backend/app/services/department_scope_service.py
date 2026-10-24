"""People and Records visibility; capabilities still gate each action.

Departments follow the org tree (rework R). A user sees the departments they head
or deputise (with derived sub-departments), departments they view, and always
their own supervisor-tree branch.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import Select, SQLColumnExpression, false, func, or_, select, union
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.core.roles import ADMIN_ROLE
from app.db.models import Book, Department, DepartmentMember, Employee, User
from app.services import perm_service, settings_service

ScopeKind = Literal["organization", "department", "branch", "self"]


@dataclass(frozen=True)
class DepartmentScope:
    organization: bool
    department_ids: frozenset[int]
    # The user's own employee plus every supervisor-tree descendant.
    employee_ids: frozenset[str]
    kind: ScopeKind


def descendant_department_ids(db: Session, roots: frozenset[int]) -> frozenset[int]:
    if not roots:
        return frozenset()
    tree = select(Department.id).where(Department.id.in_(roots)).cte(recursive=True)
    tree = tree.union(select(Department.id).join(tree, Department.parent_id == tree.c.id))
    return frozenset(db.scalars(select(tree.c.id)))


def branch_employee_ids(db: Session, employee_id: str | None) -> frozenset[str]:
    """``employee_id`` plus everyone below them in the supervisor tree."""
    if employee_id is None:
        return frozenset()
    tree = select(Employee.id).where(Employee.id == employee_id).cte(recursive=True)
    # UNION (not UNION ALL) also terminates on a dirty supervisor cycle.
    tree = tree.union(select(Employee.id).join(tree, Employee.supervisor_id == tree.c.id))
    return frozenset(db.scalars(select(tree.c.id)))


def user_department_pairs() -> Select[tuple[int, int]]:
    """SQL form of ``user_department_ids``: (user_id, department_id) rows."""
    return select(
        union(
            select(User.id.label("user_id"), Employee.department_id.label("department_id"))
            .join(Employee, Employee.id == User.employee_id)
            .where(Employee.department_id.is_not(None)),
            select(User.id, Department.id)
            .join(Department, Department.head_employee_id == User.employee_id)
            .where(Department.active.is_(True)),
            select(DepartmentMember.user_id, DepartmentMember.department_id),
        ).subquery()
    )


def user_department_ids_select(user_id: int) -> Select[tuple[int]]:
    pairs = user_department_pairs().subquery()
    return select(pairs.c.department_id).where(pairs.c.user_id == user_id)


def user_department_ids(db: Session, user: User) -> frozenset[int]:
    """Departments a user belongs to: derived, headed, deputy and viewer."""
    return frozenset(db.scalars(user_department_ids_select(user.id)))


def resolve_department_scope(
    db: Session,
    user: User,
    *,
    capabilities: set[str] | None = None,
    assume_enabled: bool = False,
) -> DepartmentScope:
    """The user's scope, memoized on the user for the live switch.

    ``assume_enabled=True`` computes the scope as if access limits were on, for
    explaining the configured outcome; it never reads or writes the cache.
    """
    if assume_enabled:
        return _compute_scope(db, user, capabilities, enabled=True)
    cached: DepartmentScope | None = getattr(user, "_department_scope_cache", None)
    if cached is not None:
        return cached
    scope = _compute_scope(
        db, user, capabilities, enabled=settings_service.get_department_scoping_enabled(db)
    )
    user._department_scope_cache = scope
    return scope


def _has_organization_capability(
    db: Session, user: User, capabilities: set[str] | None = None
) -> bool:
    return (
        "departments.all" in capabilities
        if capabilities is not None
        else perm_service.has_capability(db, user, "departments.all")
    )


def _compute_scope(
    db: Session, user: User, capabilities: set[str] | None, *, enabled: bool
) -> DepartmentScope:
    organization = (
        not enabled
        or user.role == ADMIN_ROLE
        or _has_organization_capability(db, user, capabilities)
    )
    if organization:
        return DepartmentScope(True, frozenset(), frozenset(), "organization")
    grants = list(
        db.execute(
            select(DepartmentMember.department_id, DepartmentMember.role).where(
                DepartmentMember.user_id == user.id
            )
        )
    )
    headed = (
        frozenset(
            db.scalars(
                select(Department.id).where(
                    Department.head_employee_id == user.employee_id,
                    Department.active.is_(True),
                )
            )
        )
        if user.employee_id
        else frozenset()
    )
    leading = headed | {did for did, role in grants if role == "deputy"}
    ids = descendant_department_ids(db, frozenset(leading)) | {
        did for did, role in grants if role == "viewer"
    }
    employees = branch_employee_ids(db, user.employee_id)
    kind: ScopeKind = "department" if ids else "branch" if len(employees) > 1 else "self"
    return DepartmentScope(False, frozenset(ids), employees, kind)


def invalidate_department_scope(db: Session, user_id: int) -> None:
    user = db.get(User, user_id)
    if user is not None:
        user._department_scope_cache = None
        user._effective_caps_cache = None


def invalidate_all_department_scopes(db: Session) -> None:
    for mapped in db.identity_map.values():
        if isinstance(mapped, User):
            mapped._department_scope_cache = None
            mapped._effective_caps_cache = None


def narrow_department_scope(
    db: Session, scope: DepartmentScope, department_id: int | None
) -> DepartmentScope:
    if department_id is None:
        return scope
    requested = descendant_department_ids(db, frozenset({department_id}))
    ids = requested if scope.organization else requested & scope.department_ids
    employees = (
        frozenset(
            db.scalars(
                select(Employee.id).where(
                    Employee.id.in_(scope.employee_ids), Employee.department_id.in_(requested)
                )
            )
        )
        if scope.employee_ids
        else frozenset()
    )
    return DepartmentScope(False, ids, employees, scope.kind)


def employee_visibility_clause(scope: DepartmentScope | None) -> ColumnElement[bool] | None:
    if scope is None or scope.organization:
        return None
    return or_(
        Employee.department_id.in_(scope.department_ids), Employee.id.in_(scope.employee_ids)
    )


def employee_fk_visible(
    scope: DepartmentScope | None, column: SQLColumnExpression[str]
) -> ColumnElement[bool] | None:
    clause = employee_visibility_clause(scope)
    return None if clause is None else column.in_(select(Employee.id).where(clause))


def employee_in_scope(scope: DepartmentScope, employee: Employee) -> bool:
    return (
        scope.organization
        or employee.department_id in scope.department_ids
        or employee.id in scope.employee_ids
    )


def _branch_creators(scope: DepartmentScope) -> Select[int]:
    return select(User.id).where(User.employee_id.in_(scope.employee_ids))


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
            Book.created_by_user_id.in_(_branch_creators(scope)),
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
        or (
            book.created_by_user_id is not None
            and db.scalar(select(User.employee_id).where(User.id == book.created_by_user_id))
            in scope.employee_ids
        )
        or book_service.is_active_recipient(db, user.id, book.id)
        or db.scalar(
            select(Book.id).where(
                Book.id == book.id, book_service.assignment_access_clause(user.id)
            )
        )
        is not None
    )
