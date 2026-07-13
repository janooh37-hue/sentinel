"""Managers endpoint — used by picker widgets in the frontend.

Routes:
  GET   /managers       — list active managers (enriched with linked user name)
  POST  /managers       — create a manager row (settings.edit)
  PATCH /managers/{id}  — update any manager field incl. user link (settings.edit)
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import Manager, User
from app.db.session import get_db
from app.schemas.manager import ManagerCreate, ManagerRead, ManagerUpdate
from app.services import manager_service

router = APIRouter(prefix="/managers", tags=["managers"])


def _read(db: Session, row: Manager) -> ManagerRead:
    item = ManagerRead.model_validate(row)
    item.user_name = manager_service.manager_user_name(db, row)
    item.has_signature = manager_service.has_signature(row)
    return item


@router.get("", response_model=list[ManagerRead])
def list_managers(db: Annotated[Session, Depends(get_db)]) -> list[ManagerRead]:
    return [_read(db, r) for r in manager_service.list_managers(db)]


@router.post("", response_model=ManagerRead, status_code=status.HTTP_201_CREATED)
def create_manager(
    payload: ManagerCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> ManagerRead:
    """Create a new manager row. Requires ``settings.edit`` (admin-only)."""
    row = manager_service.create_manager(db, payload)
    return _read(db, row)


@router.patch("/{manager_id}", response_model=ManagerRead)
def update_manager(
    manager_id: int,
    payload: ManagerUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> ManagerRead:
    """Update any manager field (name, title, active, user link). settings.edit."""
    row = manager_service.update_manager(db, manager_id, payload)
    return _read(db, row)
