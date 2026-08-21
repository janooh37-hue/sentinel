"""Employee reporting hierarchy API."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.org_tree import OrgNode, OrgSupervisorUpdate
from app.services import org_tree_service as svc

router = APIRouter(prefix="/org-tree", tags=["org-tree"])


@router.get("/", response_model=list[OrgNode])
def list_nodes(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
) -> list[OrgNode]:
    return [OrgNode.model_validate(row) for row in svc.list_nodes(db)]


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
    return OrgNode.model_validate(row)
