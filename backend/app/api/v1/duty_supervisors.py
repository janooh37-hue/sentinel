from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.duty_supervisor import DutySupervisorCreate, DutySupervisorRead
from app.services import duty_supervisor_service as svc

router = APIRouter(prefix="/duty-supervisors", tags=["duty-supervisors"])


@router.get("/", response_model=list[DutySupervisorRead])
def list_mappings(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> list[DutySupervisorRead]:
    return [DutySupervisorRead.model_validate(m) for m in svc.list_mappings(db)]


@router.post("/", response_model=DutySupervisorRead, status_code=status.HTTP_201_CREATED)
def create_mapping(
    payload: DutySupervisorCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> DutySupervisorRead:
    row = svc.add_mapping(db, payload.duty_unit, payload.recipient_duty_post)
    return DutySupervisorRead.model_validate(row)


@router.delete("/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mapping(
    mapping_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> Response:
    svc.remove_mapping(db, mapping_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
