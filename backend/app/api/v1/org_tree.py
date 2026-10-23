"""Employee reporting hierarchy API."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import Department, Employee, TimesheetDesignation, User
from app.db.session import get_db
from app.schemas.org_tree import OrgNode, OrgSupervisorUpdate
from app.services import org_tree_service as svc
from app.services.department_scope_service import narrow_department_scope, resolve_department_scope

router = APIRouter(prefix="/org-tree", tags=["org-tree"])


def _headed(db: Session) -> dict[str, int]:
    return dict(db.execute(select(Department.head_employee_id, Department.id)).tuples().all())


def _node(
    employee: Employee, designation: TimesheetDesignation | None, headed: dict[str, int]
) -> OrgNode:
    return OrgNode.model_validate(employee).model_copy(
        update={
            "designation_en": designation.name_en if designation else None,
            "designation_ar": designation.name_ar if designation else None,
            "rank_order": designation.rank_order if designation else None,
            "head_of_department_id": headed.get(employee.id),
        }
    )


@router.get("/", response_model=list[OrgNode])
def list_nodes(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
    department_id: int | None = None,
) -> list[OrgNode]:
    scope = narrow_department_scope(db, resolve_department_scope(db, _user), department_id)
    headed = _headed(db)
    return [
        _node(employee, designation, headed)
        for employee, designation in svc.list_nodes(db, scope=scope)
    ]


@router.patch("/{employee_id}/supervisor", response_model=OrgNode)
def set_supervisor(
    employee_id: str,
    payload: OrgSupervisorUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("employees.edit"))],
) -> OrgNode:
    row = svc.set_supervisor(
        db,
        employee_id=employee_id,
        supervisor_id=payload.supervisor_id,
        actor=user,
        scope=resolve_department_scope(db, user),
    )
    return _node(row, svc.get_current_designation(db, row.id), _headed(db))
