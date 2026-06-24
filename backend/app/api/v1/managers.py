"""Managers endpoint — used by picker widgets in the frontend.

Routes:
  GET  /managers           — list all managers (enriched with linked user name)
  PATCH /managers/{id}     — link / unlink a login account (settings.edit)
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.manager import ManagerLinkUpdate, ManagerRead
from app.services import manager_service

router = APIRouter(prefix="/managers", tags=["managers"])


@router.get("", response_model=list[ManagerRead])
def list_managers(db: Annotated[Session, Depends(get_db)]) -> list[ManagerRead]:
    rows = manager_service.list_managers(db)
    out: list[ManagerRead] = []
    for r in rows:
        item = ManagerRead.model_validate(r)
        item.user_name = manager_service.manager_user_name(db, r)
        out.append(item)
    return out


@router.patch("/{manager_id}", response_model=ManagerRead)
def link_manager_account(
    manager_id: int,
    payload: ManagerLinkUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> ManagerRead:
    """Link or unlink a login account to a manager row.

    Requires ``settings.edit`` — admin-only by default.
    """
    row = manager_service.set_manager_user(db, manager_id, payload.user_id)
    item = ManagerRead.model_validate(row)
    item.user_name = manager_service.manager_user_name(db, row)
    return item
