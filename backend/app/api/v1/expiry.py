from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import Employee
from app.db.session import get_db
from app.schemas.expiry import ExpiryItemOut, ExpirySummaryOut
from app.services.expiry_service import ExpiryItem, compute_expiry

router = APIRouter(prefix="/expiry", tags=["expiry"])


def _items(db: Session, within: int, doc_type: str) -> list[ExpiryItem]:
    employees = list(db.execute(select(Employee)).scalars())
    return compute_expiry(employees, today=date.today(), within=within, doc_type=doc_type)  # type: ignore[arg-type]


@router.get("", response_model=list[ExpiryItemOut])
def list_expiry(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[object, Depends(require_capability("employees.view"))],
    within: int = Query(90, ge=0, le=3650),
    type: Literal["all", "uae_id", "passport"] = "all",
) -> list[ExpiryItemOut]:
    return [
        ExpiryItemOut(
            employee_id=i.employee_id,
            name_en=i.name_en,
            name_ar=i.name_ar,
            doc_type=i.doc_type,
            expiry_date=i.expiry_date.isoformat(),
            days_remaining=i.days_remaining,
            bucket=i.bucket,
        )
        for i in _items(db, within, type)
    ]


@router.get("/summary", response_model=ExpirySummaryOut)
def expiry_summary(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[object, Depends(require_capability("employees.view"))],
) -> ExpirySummaryOut:
    items = _items(db, 30, "all")
    expired = sum(1 for i in items if i.bucket == "expired")
    critical = sum(1 for i in items if i.bucket == "critical")
    return ExpirySummaryOut(expired=expired, critical=critical, urgent=expired + critical)
