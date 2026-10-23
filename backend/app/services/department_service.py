"""Department administration on the org tree, exceptions and the scoping rollout."""

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
from app.core.roles import ADMIN_ROLE, INMATE_REPORTER_ROLE
from app.db.models import (
    AuditLog,
    Book,
    BookDepartmentSend,
    BookFolderShare,
    Department,
    DepartmentException,
    DepartmentMember,
    DepartmentService,
    Employee,
    User,
)
from app.schemas.department import (
    DepartmentCandidateUserRead,
    DepartmentCreate,
    DepartmentExceptionRead,
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
from app.services import (
    capability_catalog_service,
    department_scope_service,
    department_tree_service,
    settings_service,
)

_NAME_TAKEN = "A department with this name already exists."


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


def head_user_ids(db: Session, department_ids: list[int]) -> dict[int, int]:
    """The reachable account linked to each department's head employee."""
    result: dict[int, int] = {}
    for did, user_id in db.execute(
        select(Department.id, User.id)
        .join(User, User.employee_id == Department.head_employee_id)
        .where(
            Department.id.in_(department_ids),
            User.status == "active",
            User.role != INMATE_REPORTER_ROLE,
        )
        .order_by(User.id)
    ):
        result.setdefault(did, user_id)
    return result


def user_departments(db: Session, user_ids: list[int]) -> dict[int, list[UserDepartmentRead]]:
    """Each user's departments, strongest role first: head, deputy, viewer, member."""
    result: dict[int, list[UserDepartmentRead]] = defaultdict(list)
    if not user_ids:
        return result
    rows: list[tuple[int, int, str]] = []
    rows.extend(
        (user_id, did, "head")
        for user_id, did in db.execute(
            select(User.id, Department.id)
            .join(Department, Department.head_employee_id == User.employee_id)
            .where(User.id.in_(user_ids), Department.active.is_(True))
        )
    )
    rows.extend(
        (user_id, did, role)
        for user_id, did, role in db.execute(
            select(DepartmentMember.user_id, DepartmentMember.department_id, DepartmentMember.role)
            .where(DepartmentMember.user_id.in_(user_ids))
            .order_by(DepartmentMember.id)
        )
    )
    rows.extend(
        (user_id, did, "member")
        for user_id, did in db.execute(
            select(User.id, Employee.department_id)
            .join(Employee, Employee.id == User.employee_id)
            .where(User.id.in_(user_ids), Employee.department_id.is_not(None))
        )
        if did is not None
    )
    departments = {
        row.id: row
        for row in db.scalars(select(Department).where(Department.id.in_({r[1] for r in rows})))
    }
    order = {"head": 0, "deputy": 1, "viewer": 2, "member": 3}
    seen: set[tuple[int, int]] = set()
    for user_id, did, role in sorted(rows, key=lambda r: (r[0], order[r[2]])):
        if (user_id, did) in seen:
            continue
        seen.add((user_id, did))
        department = departments[did]
        result[user_id].append(
            UserDepartmentRead(
                department_id=did,
                name_en=department.name_en,
                name_ar=department.name_ar,
                role=cast(DepartmentRole, role),
            )
        )
    return result


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
                    "head_employee_id": row.head_employee_id,
                    "active": row.active,
                    **extra,
                },
                ensure_ascii=False,
            ),
        )
    )


def list_departments(db: Session, department_id: int | None = None) -> list[DepartmentRead]:
    stmt = select(Department, Employee).join(Employee, Employee.id == Department.head_employee_id)
    if department_id is not None:
        stmt = stmt.where(Department.id == department_id)
    departments = list(db.execute(stmt.order_by(Department.id)).tuples())
    ids = [row.id for row, _ in departments]
    if not ids:
        return []
    employee_counts = dict(
        db.execute(
            select(Employee.department_id, func.count())
            .where(Employee.department_id.in_(ids))
            .group_by(Employee.department_id)
        )
        .tuples()
        .all()
    )
    exception_counts = dict(
        db.execute(
            select(DepartmentException.department_id, func.count())
            .where(DepartmentException.department_id.in_(ids))
            .group_by(DepartmentException.department_id)
        )
        .tuples()
        .all()
    )
    services: dict[int, list[str]] = defaultdict(list)
    for did, service_id in db.execute(
        select(DepartmentService.department_id, DepartmentService.service_id)
        .where(DepartmentService.department_id.in_(ids))
        .order_by(DepartmentService.service_id)
    ):
        services[did].append(service_id)
    people: dict[tuple[int, str], list[DepartmentPersonRead]] = defaultdict(list)
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
        .where(DepartmentMember.department_id.in_(ids))
        .order_by(DepartmentMember.id)
    ):
        people[(did, role)].append(
            DepartmentPersonRead(
                user_id=user_id, display_name=display_name or employee_name or email, role=role
            )
        )
    heads = head_user_ids(db, ids)
    return [
        DepartmentRead(
            id=row.id,
            name_en=row.name_en,
            name_ar=row.name_ar,
            head_employee_id=row.head_employee_id,
            head_name_en=head.name_en,
            head_name_ar=head.name_ar,
            head_user_id=heads.get(row.id),
            parent_id=row.parent_id,
            active=row.active,
            employee_count=employee_counts.get(row.id, 0),
            deputies=people[(row.id, "deputy")],
            viewers=people[(row.id, "viewer")],
            service_ids=services[row.id],
            exception_count=exception_counts.get(row.id, 0),
        )
        for row, head in departments
    ]


def read_department(db: Session, department_id: int) -> DepartmentRead:
    require_department(db, department_id)
    return list_departments(db, department_id)[0]


def _validate_names(
    db: Session, *, name_en: str, name_ar: str, exclude_id: int | None = None
) -> None:
    stmt = select(Department.id).where(
        or_(Department.name_en == name_en, Department.name_ar == name_ar)
    )
    if exclude_id is not None:
        stmt = stmt.where(Department.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise ConflictError("DEPARTMENT_NAME_TAKEN", _NAME_TAKEN)


def _validate_head(db: Session, employee_id: str, *, exclude_id: int | None = None) -> None:
    if db.get(Employee, employee_id) is None:
        raise NotFoundError("EMPLOYEE_NOT_FOUND", "Employee not found.")
    stmt = select(Department.id).where(Department.head_employee_id == employee_id)
    if exclude_id is not None:
        stmt = stmt.where(Department.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise ConflictError(
            "DEPARTMENT_HEAD_TAKEN", "This employee already heads another department."
        )


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ConflictError("DEPARTMENT_NAME_TAKEN", _NAME_TAKEN) from None


def create_department(
    db: Session, payload: DepartmentCreate, *, actor: str | None
) -> DepartmentRead:
    _validate_names(db, name_en=payload.name_en, name_ar=payload.name_ar)
    _validate_head(db, payload.head_employee_id)
    row = Department(**payload.model_dump())
    db.add(row)
    _flush(db)
    department_tree_service.reject_head_exception(db, row.head_employee_id)
    department_tree_service.recompute(db)
    _audit(db, actor, "create_department", row)
    db.commit()
    return read_department(db, row.id)


def update_department(
    db: Session, department_id: int, payload: DepartmentUpdate, *, actor: str | None
) -> DepartmentRead:
    row = require_department(db, department_id)
    data = payload.model_dump(exclude_unset=True)
    _validate_names(
        db,
        name_en=data.get("name_en", row.name_en),
        name_ar=data.get("name_ar", row.name_ar),
        exclude_id=row.id,
    )
    if "head_employee_id" in data:
        _validate_head(db, data["head_employee_id"], exclude_id=row.id)
    previous_name = row.name_ar
    for key, value in data.items():
        setattr(row, key, value)
    _flush(db)
    department_tree_service.reject_head_exception(db, row.head_employee_id)
    # Re-labels members on rename; a rename+deactivate still clears the old label.
    department_tree_service.recompute(db, previous_names={row.id: previous_name})
    _audit(db, actor, "update_department", row)
    db.commit()
    return read_department(db, row.id)


def delete_department(db: Session, department_id: int, *, actor: str | None) -> None:
    row = require_department(db, department_id)
    for model, column in (
        (Book, Book.department_id),
        (BookDepartmentSend, BookDepartmentSend.department_id),
        (BookFolderShare, BookFolderShare.department_id),
    ):
        if db.scalar(select(model.id).where(column == department_id).limit(1)) is not None:
            raise ConflictError(
                "DEPARTMENT_IN_USE",
                "Records, department sends or folder shares reference this department; "
                "deactivate it instead.",
            )
    _audit(db, actor, "delete_department", row)
    previous_name = row.name_ar
    # Explicit cascade: SQLite FK enforcement may be off on this connection.
    for grant_model, grant_column in (
        (DepartmentMember, DepartmentMember.department_id),
        (DepartmentService, DepartmentService.department_id),
        (DepartmentException, DepartmentException.department_id),
    ):
        db.execute(delete(grant_model).where(grant_column == department_id))
    db.execute(
        update(Department).where(Department.parent_id == department_id).values(parent_id=None)
    )
    db.delete(row)
    db.flush()
    department_tree_service.recompute(db, previous_names={department_id: previous_name})
    db.commit()


def replace_people(
    db: Session,
    department_id: int,
    deputy_user_ids: list[int],
    viewer_user_ids: list[int],
    *,
    actor: str | None,
) -> DepartmentRead:
    row = require_department(db, department_id)
    deputies = list(dict.fromkeys(deputy_user_ids))
    viewers = list(dict.fromkeys(viewer_user_ids))
    if set(deputies) & set(viewers):
        raise ValidationFailedError(
            "DEPARTMENT_PEOPLE_OVERLAP", "A user cannot be both a deputy and a viewer."
        )
    wanted = [*deputies, *viewers]
    found = set(db.scalars(select(User.id).where(User.id.in_(wanted))))
    if found != set(wanted):
        raise NotFoundError("USER_NOT_FOUND", "User not found.")
    previous = set(
        db.scalars(
            select(DepartmentMember.user_id).where(DepartmentMember.department_id == department_id)
        )
    )
    db.execute(delete(DepartmentMember).where(DepartmentMember.department_id == department_id))
    db.add_all(
        [
            *(
                DepartmentMember(department_id=department_id, user_id=u, role="deputy")
                for u in deputies
            ),
            *(
                DepartmentMember(department_id=department_id, user_id=u, role="viewer")
                for u in viewers
            ),
        ]
    )
    _audit(db, actor, "department_people", row, deputy_user_ids=deputies, viewer_user_ids=viewers)
    db.commit()
    for user_id in previous | set(wanted):
        department_scope_service.invalidate_department_scope(db, user_id)
    return read_department(db, department_id)


def candidate_users(db: Session) -> list[DepartmentCandidateUserRead]:
    """Active, non-inmate-reporter accounts for the deputy and viewer pickers."""
    rows = [
        DepartmentCandidateUserRead(
            user_id=user.id,
            display_name=user.display_name or name or user.email,
            email=user.email,
            employee_id=user.employee_id,
        )
        for user, name in db.execute(
            select(User, Employee.name_en)
            .outerjoin(Employee, Employee.id == User.employee_id)
            .where(User.status == "active", User.role != INMATE_REPORTER_ROLE)
        ).tuples()
    ]
    return sorted(rows, key=lambda row: (row.display_name.casefold(), row.user_id))


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
    department_scope_service.invalidate_all_department_scopes(db)
    return read_department(db, department_id)


def list_exceptions(db: Session) -> list[DepartmentExceptionRead]:
    tree = department_tree_service.tree_only_membership(db)
    return [
        DepartmentExceptionRead(
            employee_id=row.employee_id,
            name_en=employee.name_en,
            name_ar=employee.name_ar,
            department_id=row.department_id,
            tree_department_id=tree.get(row.employee_id),
            created_by=row.created_by,
            created_at=row.created_at,
        )
        for row, employee in db.execute(
            select(DepartmentException, Employee)
            .join(Employee, Employee.id == DepartmentException.employee_id)
            .order_by(Employee.name_en, Employee.id)
        ).tuples()
    ]


def _read_exception(db: Session, employee_id: str) -> DepartmentExceptionRead:
    return next(row for row in list_exceptions(db) if row.employee_id == employee_id)


def put_exception(
    db: Session, employee_id: str, department_id: int | None, *, actor: str | None
) -> DepartmentExceptionRead:
    if db.get(Employee, employee_id) is None:
        raise NotFoundError("EMPLOYEE_NOT_FOUND", "Employee not found.")
    if department_id is not None:
        require_active_department(db, department_id)
    row = db.get(DepartmentException, employee_id)
    if row is None:
        row = DepartmentException(employee_id=employee_id, created_by=actor)
        db.add(row)
    row.department_id = department_id
    db.flush()
    department_tree_service.reject_head_exception(db, employee_id)
    department_tree_service.recompute(db)
    db.add(
        AuditLog(
            actor=actor,
            action="department_exception.set",
            entity_type="employee",
            entity_id=employee_id,
            payload=json.dumps({"department_id": department_id}),
        )
    )
    db.commit()
    return _read_exception(db, employee_id)


def delete_exception(db: Session, employee_id: str, *, actor: str | None) -> None:
    row = db.get(DepartmentException, employee_id)
    if row is None:
        raise NotFoundError("DEPARTMENT_EXCEPTION_NOT_FOUND", "No exception for this employee.")
    db.delete(row)
    db.flush()
    department_tree_service.recompute(db)
    db.add(
        AuditLog(
            actor=actor,
            action="department_exception.cleared",
            entity_type="employee",
            entity_id=employee_id,
            payload=json.dumps({"department_id": row.department_id}),
        )
    )
    db.commit()


def unassigned_employees(db: Session) -> list[UnassignedEmployeeGroup]:
    """Working employees outside every department, grouped by their tree root."""
    everyone = {
        row.id: row
        for row in db.execute(
            select(
                Employee.id,
                Employee.name_en,
                Employee.name_ar,
                Employee.supervisor_id,
                Employee.duty_unit,
            )
        )
    }

    def root(employee_id: str) -> str:
        seen = {employee_id}
        current = employee_id
        while (parent := everyone[current].supervisor_id) in everyone and parent not in seen:
            seen.add(parent)
            current = parent
        return current

    groups: dict[str, list[str]] = defaultdict(list)
    for employee_id in db.scalars(
        select(Employee.id)
        .where(Employee.department_id.is_(None), Employee.status.in_(WORKING_STATUSES))
        .order_by(Employee.id)
    ):
        groups[root(employee_id)].append(employee_id)
    return sorted(
        (
            UnassignedEmployeeGroup(
                top_employee_id=top,
                top_name_en=everyone[top].name_en,
                top_name_ar=everyone[top].name_ar,
                duty_unit=everyone[top].duty_unit,
                count=len(ids),
                employee_ids=ids,
            )
            for top, ids in groups.items()
        ),
        key=lambda group: (-group.count, group.top_employee_id),
    )


def read_scoping(db: Session) -> DepartmentScopingRead:
    pairs = department_scope_service.user_department_pairs().subquery()
    users = db.scalars(
        select(User)
        .where(
            User.status == "active",
            User.role != ADMIN_ROLE,
            ~select(pairs.c.department_id).where(pairs.c.user_id == User.id).exists(),
        )
        .order_by(User.id)
    )
    departments = list(
        db.scalars(select(Department).where(Department.active.is_(True)).order_by(Department.id))
    )
    ids = [row.id for row in departments]
    receivers = set(head_user_ids(db, ids)) | set(
        db.scalars(
            select(DepartmentMember.department_id)
            .join(User, User.id == DepartmentMember.user_id)
            .where(
                DepartmentMember.role == "deputy",
                User.status == "active",
                User.role != INMATE_REPORTER_ROLE,
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
        departments_without_receiver=[
            department_read(row) for row in departments if row.id not in receivers
        ],
        departments_without_services=[
            department_read(row) for row in departments if row.id not in configured
        ],
    )


def set_scoping(db: Session, enabled: bool, *, actor: str) -> DepartmentScopingRead:
    records_backfilled = 0
    if enabled:
        creator_department = (
            select(Employee.department_id)
            .join(User, User.employee_id == Employee.id)
            .where(User.id == Book.created_by_user_id)
            .scalar_subquery()
        )
        # The stamp and switch commit together; creators outside departments stay NULL.
        result = db.connection().execute(
            update(Book)
            .where(Book.department_id.is_(None), creator_department.is_not(None))
            .values(department_id=creator_department)
        )
        records_backfilled = result.rowcount
        db.expire_all()
    settings_service.set_audited_setting(
        db,
        "settings.department_scoping_enabled",
        enabled,
        actor=actor,
        action="department_scoping.enabled" if enabled else "department_scoping.disabled",
        entity_type="settings",
        entity_id="department_scoping_enabled",
        audit_extra={"records_backfilled": records_backfilled},
    )
    department_scope_service.invalidate_all_department_scopes(db)
    return read_scoping(db).model_copy(update={"records_backfilled": records_backfilled})
