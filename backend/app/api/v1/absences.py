"""Global absence register endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.absence import AbsenceRegisterRead, AbsenceRegisterRowRead
from app.services import absence_service
from app.services.department_scope_service import narrow_department_scope, resolve_department_scope

router = APIRouter(prefix="/absences", tags=["absences"])


@router.get("/episodes", response_model=AbsenceRegisterRead)
def list_absence_register(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("leaves.view"))],
    department_id: int | None = None,
) -> AbsenceRegisterRead:
    """Every employee's absence rows, newest first — the Services register."""
    scope = narrow_department_scope(db, resolve_department_scope(db, _user), department_id)
    rows = [
        AbsenceRegisterRowRead(
            employee_id=employee.id,
            employee_name_en=employee.name_en,
            employee_name_ar=employee.name_ar,
            duty_post=employee.duty_post,
            duty_unit=employee.duty_unit,
            start_date=episode.start,
            end_date=episode.end,
            days=episode.day_count,
            notes=episode.notes,
        )
        for employee, episode in absence_service.list_register(db, scope=scope)
    ]
    return AbsenceRegisterRead(rows=rows)
