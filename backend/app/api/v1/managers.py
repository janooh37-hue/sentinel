"""Managers endpoint — used by picker widgets in the frontend.

Routes:
  GET    /managers                — list active managers (enriched with linked user name)
  POST   /managers                — create a manager row (settings.edit)
  PATCH  /managers/{id}           — update any manager field incl. user link (settings.edit)
  POST   /managers/{id}/signature — upload PNG signature (settings.edit)
  GET    /managers/{id}/signature — serve PNG or base64 (settings.edit)
  DELETE /managers/{id}/signature — remove signature (settings.edit)
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api._responses import maybe_base64
from app.api.deps import require_capability
from app.api.errors import NotFoundError, ValidationFailedError
from app.core import signature as signature_core
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


@router.post("/{manager_id}/signature", status_code=status.HTTP_201_CREATED)
async def upload_manager_signature(
    manager_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> dict[str, str]:
    data = await upload.read()
    try:
        path = manager_service.save_manager_signature(db, manager_id, data)
    except signature_core.SignatureError as exc:
        raise ValidationFailedError("SIGNATURE_INVALID", str(exc), manager_id=manager_id) from exc
    return {"path": str(path), "filename": path.name}


@router.get("/{manager_id}/signature")
def get_manager_signature(
    manager_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    manager_service._get_or_404(db, manager_id)
    path = manager_service.manager_signature_path(manager_id)
    if not path.is_file():
        raise NotFoundError("SIGNATURE_NOT_FOUND", "No signature on file.", manager_id=manager_id)
    updated = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC).isoformat()
    data = path.read_bytes()
    if (
        b64 := maybe_base64(data, encoding, extra_headers={"X-Signature-Updated": updated})
    ) is not None:
        return b64
    return Response(content=data, media_type="image/png", headers={"X-Signature-Updated": updated})


@router.delete("/{manager_id}/signature", status_code=status.HTTP_204_NO_CONTENT)
def delete_manager_signature(
    manager_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> Response:
    manager_service.delete_manager_signature(db, manager_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
