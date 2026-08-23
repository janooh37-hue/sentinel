"""Dashboard endpoints — Phase 12.

Single endpoint:
  GET /dashboard/summary — aggregate snapshot for the home page.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.dashboard import DashboardSummary
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_summary(
    db: Annotated[Session, Depends(get_db)],
) -> DashboardSummary:
    return dashboard_service.get_summary(db)


__all__ = ["router"]
