"""Department administration, memberships and the audited scoping rollout."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import cast

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
from app.core.permissions import SERVICE_CAP_PREFIX
from app.core.roles import ADMIN_ROLE
from app.db.models import AuditLog, Department, DepartmentMember, DepartmentService, Employee, User
from app.schemas.department import (
    DepartmentAssignmentResult,
    DepartmentCreate,
    DepartmentMemberRead,
    DepartmentMembership,
    DepartmentPersonRead,
    DepartmentRead,
    DepartmentRole,
    DepartmentScopingDepartmentRead,
    DepartmentScopingRead,
    DepartmentScopingUserRead,
    DepartmentServiceOption,
    DepartmentUpdate,
    UnassignedEmployeeGroup,
    UserDepartmentRead,
)
from app.schemas.employee import WORKING_STATUSES
from app.services import capability_catalog_service, department_scope_service, settings_service


def require_department(db: Session, department_id: int) -> Department:
    row = db.get(Department, department_id)
    if row is None:
        raise NotFoundError("DEPARTMENT_NOT_FOUND", "Department not found.")
    return row


def require_active_department(db: Session, department_id: int) -> Department:
    row = db.get(Department, department_id)
    if row is None or not row.active:
        raise ValidationFailedError("DEPARTMENT_NOT_FOUND", "Choose an active department.")
    return row


def user_departments(db: Session, user_ids: list[int]) -> dict[int, list[UserDepartmentRead]]:
    result: dict[int, list[UserDepartmentRead]] = defaultdict(list)
    if not user_ids:
        return result
    rows = db.execute(
        select(DepartmentMember, Department)
        .join(Department, Department.id == DepartmentMember.department_id)
        .where(DepartmentMember.user_id.in_(user_ids))
        .order_by(DepartmentMember.user_id, DepartmentMember.id)
    )
    for member, department in rows:
        result[member.user_id].append(
            UserDepartmentRead(
                department_id=department.id,
                name_en=department.name_en,
                name_ar=department.name_ar,
                role=cast(DepartmentRole, member.role),
                is_primary=member.is_primary,
            )
        )
    return result


def default_membership(
    db: Session, user: User, department_id: int | None, actor: str | None = None
) -> None:
    if department_id is None:
        return
    require_active_department(db, department_id)
    db.execute(
        update(DepartmentMember).where(DepartmentMember.user_id == user.id).values(is_primary=False)
    )
    member = db.scalar(
        select(DepartmentMember).where(
            DepartmentMember.user_id == user.id,
            DepartmentMember.department_id == department_id,
        )
    )
    if member is None:
        db.add(
            DepartmentMember(
                department_id=department_id, user_id=user.id, role="member", is_primary=True
            )
        )
    else:
        member.role = "member"
        member.is_primary = True
    _audit_memberships(
        db, user, actor, [{"department_id": department_id, "role": "member", "is_primary": True}]
    )
    department_scope_service.invalidate_department_scope(db, user.id)


def _audit_memberships(
    db: Session, user: User, actor: str | None, memberships: list[dict[str, object]]
) -> None:
    # Reuse the user-management history's identity snapshots and audit entity.
    from app.services.auth_service import _audit

    _audit(
        db,
        actor,
        "department_memberships",
        user,
        {"memberships": json.dumps(memberships, ensure_ascii=False)},
    )


def _audit(db: Session, actor: str | None, action: str, row: Department, **extra: object) -> None:
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            entity_type="department",
            entity_id=str(row.id),
            payload=json.dumps(
                {
                    "name_en": row.name_en,
                    "name_ar": row.name_ar,
                    "parent_id": row.parent_id,
                    "active": row.active,
                    **extra,
                },
                ensure_ascii=False,
            ),
        )
    )


def list_departments(db: Session, department_id: int | None = None) -> list[DepartmentRead]:
    stmt = select(Department).order_by(Department.id)
    if department_id is not None:
        stmt = stmt.where(Department.id == department_id)
    departments = list(db.scalars(stmt))
    ids = [row.id for row in departments]
    if not ids:
        return []
    member_counts = {
        did: count
        for did, count in db.execute(
            select(DepartmentMember.department_id, func.count())
            .where(DepartmentMember.department_id.in_(ids))
            .group_by(DepartmentMember.department_id)
        )
    }
    employee_counts = {
        did: count
        for did, count in db.execute(
            select(Employee.department_id, func.count())
            .where(Employee.department_id.in_(ids))
            .group_by(Employee.department_id)
        )
    }
    services: dict[int, list[str]] = defaultdict(list)
    for did, service_id in db.execute(
        select(DepartmentService.department_id, DepartmentService.service_id)
        .where(DepartmentService.department_id.in_(ids))
        .order_by(DepartmentService.service_id)
    ):
        services[did].append(service_id)
    heads: dict[int, list[DepartmentPersonRead]] = defaultdict(list)
    for did, user_id, display_name, email, role, employee_name in db.execute(
        select(
            DepartmentMember.department_id,
            User.id,
            User.display_name,
            User.email,
            DepartmentMember.role,
            Employee.name_en,
        )
        .join(User, User.id == DepartmentMember.user_id)
        .outerjoin(Employee, Employee.id == User.employee_id)
        .where(
            DepartmentMember.department_id.in_(ids), DepartmentMember.role.in_(("head", "deputy"))
        )
        .order_by(DepartmentMember.id)
    ):
        heads[did].append(
            DepartmentPersonRead(
                user_id=user_id, display_name=display_name or employee_name or email, role=role
            )
        )
    return [
        DepartmentRead(
            id=row.id,
            name_en=row.name_en,
            name_ar=row.name_ar,
            parent_id=row.parent_id,
            active=row.active,
            member_count=member_counts.get(row.id, 0),
            employee_count=employee_counts.get(row.id, 0),
            service_ids=services[row.id],
            heads=heads[row.id],
        )
        for row in departments
    ]


def read_department(db: Session, department_id: int) -> DepartmentRead:
    require_department(db, department_id)
    return list_departments(db, department_id)[0]


def _validate_names(
    db: Session, *, name_en: str, name_ar: str, parent_id: int | None, exclude_id: int | None = None
) -> None:
    stmt = select(Department.id).where(
        Department.parent_id == parent_id,
        or_(Department.name_en == name_en, Department.name_ar == name_ar),
    )
    if exclude_id is not None:
        stmt = stmt.where(Department.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise ConflictError(
            "DEPARTMENT_NAME_TAKEN", "A department with this name already exists under that parent."
        )


def _save_department(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError(
            "DEPARTMENT_NAME_TAKEN", "A department with this name already exists under that parent."
        ) from None


def create_department(
    db: Session, payload: DepartmentCreate, *, actor: str | None
) -> DepartmentRead:
    if payload.parent_id is not None:
        require_active_department(db, payload.parent_id)
    _validate_names(
        db, name_en=payload.name_en, name_ar=payload.name_ar, parent_id=payload.parent_id
    )
    row = Department(**payload.model_dump())
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ConflictError(
            "DEPARTMENT_NAME_TAKEN", "A department with this name already exists under that parent."
        ) from None
    _audit(db, actor, "create_department", row)
    _save_department(db)
    department_scope_service.invalidate_all_department_scopes(db)
    return read_department(db, row.id)


def update_department(
    db: Session, department_id: int, payload: DepartmentUpdate, *, actor: str | None
) -> DepartmentRead:
    row = require_department(db, department_id)
    data = payload.model_dump(exclude_unset=True)
    parent_id = data.get("parent_id", row.parent_id)
    if "parent_id" in data and parent_id is not None:
        current: Department | None = require_active_department(db, parent_id)
        visited = {department_id}
        while current is not None:
            if current.id in visited:
                raise ValidationFailedError(
                    "DEPARTMENT_CYCLE", "A department cannot be its own ancestor."
                )
            visited.add(current.id)
            current = (
                db.get(Department, current.parent_id) if current.parent_id is not None else None
            )
    _validate_names(
        db,
        name_en=data.get("name_en", row.name_en),
        name_ar=data.get("name_ar", row.name_ar),
        parent_id=parent_id,
        exclude_id=row.id,
    )
    for key, value in data.items():
        setattr(row, key, value)
    _audit(db, actor, "update_department", row)
    _save_department(db)
    department_scope_service.invalidate_all_department_scopes(db)
    return read_department(db, row.id)


def delete_department(db: Session, department_id: int, *, actor: str | None) -> None:
    row = require_department(db, department_id)
    if (
        db.scalar(select(Department.id).where(Department.parent_id == department_id).limit(1))
        is not None
        or db.scalar(
            select(DepartmentMember.id)
            .where(DepartmentMember.department_id == department_id)
            .limit(1)
        )
        is not None
        or db.scalar(select(Employee.id).where(Employee.department_id == department_id).limit(1))
        is not None
    ):
        raise ConflictError(
            "DEPARTMENT_IN_USE",
            "Remove children, members and employee assignments before deleting this department.",
        )
    _audit(db, actor, "delete_department", row)
    db.delete(row)
    db.commit()


def list_members(db: Session, department_id: int) -> list[DepartmentMemberRead]:
    require_department(db, department_id)
    rows = db.execute(
        select(DepartmentMember, User, Employee.name_en)
        .join(User, User.id == DepartmentMember.user_id)
        .outerjoin(Employee, Employee.id == User.employee_id)
        .where(DepartmentMember.department_id == department_id)
        .order_by(DepartmentMember.id)
    )
    return [
        DepartmentMemberRead(
            user_id=user.id,
            display_name=user.display_name or name or user.email,
            email=user.email,
            role=cast(DepartmentRole, member.role),
            is_primary=member.is_primary,
        )
        for member, user, name in rows
    ]


def replace_memberships(
    db: Session, user_id: int, memberships: list[DepartmentMembership], *, actor: str | None
) -> list[UserDepartmentRead]:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("USER_NOT_FOUND", "User not found.")
    if memberships and sum(member.is_primary for member in memberships) != 1:
        raise ValidationFailedError(
            "DEPARTMENT_PRIMARY_REQUIRED", "Choose exactly one primary department."
        )
    ids = [member.department_id for member in memberships]
    if len(set(ids)) != len(ids):
        raise ValidationFailedError(
            "DEPARTMENT_MEMBERSHIP_DUPLICATE", "A user can belong to a department only once."
        )
    for department_id in ids:
        require_active_department(db, department_id)
    db.execute(delete(DepartmentMember).where(DepartmentMember.user_id == user_id))
    db.add_all(DepartmentMember(user_id=user_id, **member.model_dump()) for member in memberships)
    _audit_memberships(db, user, actor, [member.model_dump() for member in memberships])
    db.commit()
    department_scope_service.invalidate_department_scope(db, user_id)
    return user_departments(db, [user_id]).get(user_id, [])


def service_options(db: Session) -> list[DepartmentServiceOption]:
    options = []
    for service_id in (*SERVICE_IDS, OTHER_SERVICE_ID):
        entry = capability_catalog_service.get_catalog_entry(
            db, f"{SERVICE_CAP_PREFIX}{service_id}"
        )
        assert entry is not None
        options.append(
            DepartmentServiceOption(id=service_id, label_en=entry.label_en, label_ar=entry.label_ar)
        )
    return options


def replace_services(
    db: Session, department_id: int, service_ids: list[str], *, actor: str | None
) -> DepartmentRead:
    row = require_department(db, department_id)
    if set(service_ids) - {*SERVICE_IDS, OTHER_SERVICE_ID}:
        raise ValidationFailedError(
            "DEPARTMENT_SERVICE_UNKNOWN", "Choose services from the service catalog."
        )
    db.execute(delete(DepartmentService).where(DepartmentService.department_id == department_id))
    db.add_all(
        DepartmentService(department_id=department_id, service_id=service_id)
        for service_id in dict.fromkeys(service_ids)
    )
    _audit(db, actor, "department_services", row, service_ids=service_ids)
    db.commit()
    return read_department(db, department_id)


def unassigned_employees(db: Session) -> list[UnassignedEmployeeGroup]:
    groups: dict[tuple[str | None, str | None], list[str]] = defaultdict(list)
    for employee_id, duty_unit, legacy in db.execute(
        select(Employee.id, Employee.duty_unit, Employee.department)
        .where(Employee.department_id.is_(None), Employee.status.in_(WORKING_STATUSES))
        .order_by(Employee.duty_unit, Employee.department, Employee.id)
    ):
        groups[(duty_unit, legacy)].append(employee_id)
    return [
        UnassignedEmployeeGroup(
            duty_unit=unit, legacy_department=legacy, employee_ids=ids, count=len(ids)
        )
        for (unit, legacy), ids in groups.items()
    ]


def assign_employees(
    db: Session, employee_ids: list[str], department_id: int | None, *, actor: str | None
) -> DepartmentAssignmentResult:
    if department_id is not None:
        require_active_department(db, department_id)
    ids = list(dict.fromkeys(employee_ids))
    found = list(db.scalars(select(Employee.id).where(Employee.id.in_(ids))))
    if len(found) != len(ids):
        raise ValidationFailedError("EMPLOYEE_NOT_FOUND", "One or more employees were not found.")
    db.execute(update(Employee).where(Employee.id.in_(ids)).values(department_id=department_id))
    db.add(
        AuditLog(
            actor=actor,
            action="assign_department",
            entity_type="employee",
            entity_id=None,
            payload=json.dumps({"employee_ids": ids, "department_id": department_id}),
        )
    )
    db.commit()
    return DepartmentAssignmentResult(updated=len(found))


def read_scoping(db: Session) -> DepartmentScopingRead:
    users = db.scalars(
        select(User)
        .where(
            User.status == "active",
            User.role != ADMIN_ROLE,
            ~select(DepartmentMember.id).where(DepartmentMember.user_id == User.id).exists(),
        )
        .order_by(User.id)
    )
    departments = list(
        db.scalars(select(Department).where(Department.active.is_(True)).order_by(Department.id))
    )
    headed = set(
        db.scalars(
            select(DepartmentMember.department_id).where(
                DepartmentMember.role.in_(("head", "deputy"))
            )
        )
    )
    configured = set(db.scalars(select(DepartmentService.department_id)))

    def department_read(row: Department) -> DepartmentScopingDepartmentRead:
        return DepartmentScopingDepartmentRead(id=row.id, name_en=row.name_en, name_ar=row.name_ar)

    return DepartmentScopingRead(
        enabled=settings_service.get_department_scoping_enabled(db),
        users_without_department=[
            DepartmentScopingUserRead(
                user_id=user.id, display_name=user.display_name or user.email, email=user.email
            )
            for user in users
        ],
        departments_without_head=[
            department_read(row) for row in departments if row.id not in headed
        ],
        departments_without_services=[
            department_read(row) for row in departments if row.id not in configured
        ],
    )


def set_scoping(db: Session, enabled: bool, *, actor: str) -> DepartmentScopingRead:
    settings_service.set_audited_setting(
        db,
        "settings.department_scoping_enabled",
        enabled,
        actor=actor,
        action="department_scoping.enabled" if enabled else "department_scoping.disabled",
        entity_type="settings",
        entity_id="department_scoping_enabled",
    )
    department_scope_service.invalidate_all_department_scopes(db)
    return read_scoping(db)
