"""Settings endpoints — GET /settings, PATCH /settings."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.settings import AppSettingsRead, AppSettingsUpdate
from app.services import settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=AppSettingsRead)
def read_settings(db: Annotated[Session, Depends(get_db)]) -> AppSettingsRead:
    return settings_service.get_settings(db)


@router.patch("", response_model=AppSettingsRead)
def patch_settings(
    payload: AppSettingsUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> AppSettingsRead:
    return settings_service.update_settings(db, payload)
