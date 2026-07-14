"""Smart-folder endpoints — per-user saved subject filters (Phase 3 / E2).

All routes are prefixed ``/ledger/smart-folders`` and wired into ``main.py``
under ``/api/v1`` **before** the ledger router so the static paths win over the
``/ledger/{entry_id}`` catch-all.

Endpoints (all scoped to the current user):
  GET    /ledger/smart-folders              — the caller's active folders
  GET    /ledger/smart-folders/suggestions  — top subject clusters (≥5)
  POST   /ledger/smart-folders              — create (confirmed)
  POST   /ledger/smart-folders/dismiss      — per-user dismissal (204)
  PATCH  /ledger/smart-folders/{id}         — rename
  DELETE /ledger/smart-folders/{id}         — soft-delete (204)
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.smart_folder import (
    SmartFolderCreate,
    SmartFolderDismiss,
    SmartFolderRead,
    SmartFolderSuggestion,
    SmartFolderUpdate,
)
from app.services import smart_folder_service

router = APIRouter(prefix="/ledger/smart-folders", tags=["ledger"])


def _to_read(db: Session, folder: object, user_id: int) -> SmartFolderRead:
    from app.db.models import SmartFolder

    assert isinstance(folder, SmartFolder)
    return SmartFolderRead(
        id=folder.id,
        name_en=folder.name_en,
        name_ar=folder.name_ar,
        count=smart_folder_service.count_for(db, folder=folder, user_id=user_id),
    )


@router.get("", response_model=list[SmartFolderRead])
def list_smart_folders(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
) -> list[SmartFolderRead]:
    folders = smart_folder_service.list_for(db, current_user.id)
    return [_to_read(db, f, current_user.id) for f in folders]


@router.get("/suggestions", response_model=list[SmartFolderSuggestion])
def list_suggestions(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.view"))],
) -> list[SmartFolderSuggestion]:
    return [
        SmartFolderSuggestion(
            cluster_key=s.cluster_key,
            name_suggestion=s.name_suggestion,
            count=s.count,
            correspondent_count=s.correspondent_count,
            sample_subjects=s.sample_subjects,
        )
        for s in smart_folder_service.suggest(db, user_id=current_user.id)
    ]


@router.post("", response_model=SmartFolderRead, status_code=status.HTTP_201_CREATED)
def create_smart_folder(
    payload: SmartFolderCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> SmartFolderRead:
    folder = smart_folder_service.create(db, user_id=current_user.id, payload=payload)
    return _to_read(db, folder, current_user.id)


@router.post("/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_suggestion(
    payload: SmartFolderDismiss,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> Response:
    smart_folder_service.dismiss(
        db, user_id=current_user.id, cluster_key=payload.cluster_key
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{folder_id}", response_model=SmartFolderRead)
def rename_smart_folder(
    folder_id: int,
    payload: SmartFolderUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> SmartFolderRead:
    folder = smart_folder_service.rename(
        db, folder_id=folder_id, user_id=current_user.id, payload=payload
    )
    return _to_read(db, folder, current_user.id)


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_smart_folder(
    folder_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_capability("ledger.edit"))],
) -> Response:
    smart_folder_service.soft_delete(
        db, folder_id=folder_id, user_id=current_user.id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
