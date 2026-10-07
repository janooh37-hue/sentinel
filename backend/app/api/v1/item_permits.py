"""Item-permit (إدخال مواد) register endpoints. Reuses the ``permits.*``
capabilities — an item permit is a second register beside security permits."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.item_permit import (
    ItemPermitCreate,
    ItemPermitListResponse,
    ItemPermitRead,
    ItemPermitUpdate,
)
from app.services import item_permit_service

router = APIRouter(prefix="/item-permits", tags=["item-permits"])


@router.get("", response_model=ItemPermitListResponse)
def list_item_permits(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.view"))],
    q: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> ItemPermitListResponse:
    rows, total = item_permit_service.list_item_permits(db, q=q, limit=limit, offset=offset)
    return ItemPermitListResponse(
        items=[item_permit_service.to_read(r, db=db) for r in rows], total=total, limit=limit
    )


@router.post("", response_model=ItemPermitRead, status_code=status.HTTP_201_CREATED)
def create_item_permit(
    payload: ItemPermitCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.create"))],
) -> ItemPermitRead:
    row = item_permit_service.create_item_permit(db, payload, actor=user.email)
    return item_permit_service.to_read(row, db=db)


@router.get("/{permit_id}", response_model=ItemPermitRead)
def get_item_permit(
    permit_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.view"))],
) -> ItemPermitRead:
    return item_permit_service.to_read(item_permit_service.get_item_permit(db, permit_id), db=db)


@router.patch("/{permit_id}", response_model=ItemPermitRead)
def update_item_permit(
    permit_id: int,
    payload: ItemPermitUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.edit"))],
) -> ItemPermitRead:
    row = item_permit_service.update_item_permit(db, permit_id, payload, actor=user.email)
    return item_permit_service.to_read(row, db=db)


@router.post("/{permit_id}/submit-approval", response_model=ItemPermitRead)
def submit_item_permit_approval(
    permit_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.edit"))],
) -> ItemPermitRead:
    """Send the permit's 1/5 letter into the book approval chain."""
    row = item_permit_service.submit_item_permit_book(db, permit_id, actor=user.email)
    return item_permit_service.to_read(row, db=db)


@router.delete("/{permit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item_permit(
    permit_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.delete"))],
) -> Response:
    item_permit_service.soft_delete_item_permit(db, permit_id, actor=user.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
