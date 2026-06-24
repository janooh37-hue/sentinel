"""Duty-location internal-transfer endpoint.

``POST /api/v1/duty/transfer`` — move employee(s) to a destination unit/post and
mint a General Book transfer letter. Gated on ``documents.generate`` (the action
produces a document).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.duty import DutyTransferRequest, DutyTransferResult
from app.services import duty_service

router = APIRouter(prefix="/duty", tags=["duty"])


@router.post("/transfer", response_model=DutyTransferResult)
def transfer(
    payload: DutyTransferRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.generate"))],
) -> DutyTransferResult:
    return duty_service.transfer(
        db,
        employee_ids=payload.employee_ids,
        to_unit=payload.to_unit,
        to_post=payload.to_post,
        effective_date=payload.effective_date,
        reason=payload.reason,
        current_user=user,
    )
