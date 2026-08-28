"""Authenticated dashboard summary and per-user layout endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.dashboard import DashboardLayout, DashboardSummary
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/layout", response_model=DashboardLayout | None)
def get_layout(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DashboardLayout | None:
    return dashboard_service.get_user_layout(db, current_user.id)


@router.put("/layout", response_model=DashboardLayout)
def update_layout(
    layout: DashboardLayout,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DashboardLayout:
    return dashboard_service.set_user_layout(db, current_user.id, layout)


@router.get("/summary", response_model=DashboardSummary)
def get_summary(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DashboardSummary:
    return dashboard_service.get_summary(
        db,
        user=current_user,
        owner_user_id=current_user.id,
    )


__all__ = ["router"]
