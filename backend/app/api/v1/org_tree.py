"""Employee reporting hierarchy API."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import Employee, TimesheetDesignation, User
from app.db.session import get_db
from app.schemas.org_tree import OrgNode, OrgSupervisorUpdate
from app.services import org_tree_service as svc

router = APIRouter(prefix="/org-tree", tags=["org-tree"])


def _node(employee: Employee, designation: TimesheetDesignation | None = None) -> OrgNode:
    return OrgNode.model_validate(employee).model_copy(
        update={
            "designation_en": designation.name_en if designation else None,
            "designation_ar": designation.name_ar if designation else None,
            "rank_order": designation.rank_order if designation else None,
        }
    )


@router.get("/", response_model=list[OrgNode])
def list_nodes(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
) -> list[OrgNode]:
    return [_node(employee, designation) for employee, designation in svc.list_nodes(db)]


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
    )
    return _node(row, svc.get_current_designation(db, row.id))
