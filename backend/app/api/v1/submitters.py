"""Submitters endpoints — list, create, delete."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.submitter import SubmitterCreate, SubmitterRead
from app.services import submitter_service

router = APIRouter(prefix="/submitters", tags=["submitters"])


@router.get("", response_model=list[SubmitterRead])
def list_submitters(db: Annotated[Session, Depends(get_db)]) -> list[SubmitterRead]:
    rows = submitter_service.list_submitters(db)
    return [SubmitterRead.model_validate(r) for r in rows]


@router.post("", response_model=SubmitterRead, status_code=status.HTTP_201_CREATED)
def create_submitter(
    payload: SubmitterCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("submitters.manage"))],
) -> SubmitterRead:
    row = submitter_service.create_submitter(db, payload)
    return SubmitterRead.model_validate(row)


@router.delete("/{submitter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_submitter(
    submitter_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("submitters.manage"))],
) -> Response:
    submitter_service.delete_submitter(db, submitter_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
