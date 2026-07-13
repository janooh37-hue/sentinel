from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.digest import (
    DigestPreview,
    DigestSendRequest,
    DigestSendResult,
    DigestSkipOut,
)
from app.services import digest_service as ds

router = APIRouter(prefix="/digests", tags=["digests"])


@router.get("/leave/preview", response_model=DigestPreview)
def preview_leave_digest(
    duty_unit: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> DigestPreview:
    month = date.today()
    pairs = ds.build_unit_digest(db, duty_unit, month)
    return DigestPreview(
        duty_unit=duty_unit,
        month=f"{month:%Y-%m}",
        count=len(pairs),
        sample_ar=ds.render_leave_digest(duty_unit, month, pairs, "ar"),
        sample_en=ds.render_leave_digest(duty_unit, month, pairs, "en"),
    )


@router.post("/leave/send", response_model=DigestSendResult)
def send_leave_digest(
    payload: DigestSendRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> DigestSendResult:
    month = date.today()
    if payload.duty_unit:
        res = ds.send_unit_digest(db, payload.duty_unit, month=month, sent_by=user.id)
    else:
        res = ds.send_all_digests(db, month=month, sent_by=user.id)
    return DigestSendResult(
        sent=res.sent,
        skips=[DigestSkipOut(duty_unit=s.duty_unit, reason=s.reason) for s in res.skips],
    )
