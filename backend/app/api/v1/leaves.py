"""Leave History endpoints — Phase 06.

Routes:
  GET    /leaves                        — paginated list with filters
  GET    /leaves/{leave_id}             — detail
  PATCH  /leaves/{leave_id}             — update status / notes
  DELETE /leaves/{leave_id}             — soft-delete (returns 204)

The balance endpoint lives on the employees router:
  GET    /employees/{employee_id}/leave-balance?as_of=YYYY-MM-DD
"""

from __future__ import annotations

import mimetypes
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api._responses import maybe_base64
from app.api.deps import require_capability
from app.db.models import Leave, User
from app.db.session import get_db
from app.schemas.leave import (
    LeaveCreate,
    LeaveListItem,
    LeaveListResponse,
    LeaveRead,
    LeaveReturnRequest,
    LeaveUpdate,
)
from app.services import leave_service

router = APIRouter(prefix="/leaves", tags=["leaves"])

LIST_DEFAULT_LIMIT = 50
# 500 matches the books/ledger/employees list caps; the desktop Annual Report
# view fetches one limit=500 page and derives its figures client-side.
LIST_MAX_LIMIT = 500


def _with_employee_name[T: (LeaveListItem, LeaveRead)](item: T, row: Leave) -> T:
    """Stamp the joined employee's bilingual name onto a leave schema."""
    emp = row.employee
    return item.model_copy(
        update={
            "employee_name_en": emp.name_en if emp else None,
            "employee_name_ar": emp.name_ar if emp else None,
        }
    )


@router.get("", response_model=LeaveListResponse)
def list_leaves(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("leaves.view"))],
    employee_id: str | None = None,
    leave_status: Annotated[str | None, Query(alias="status")] = None,
    leave_type: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    q: str | None = None,
    include_deleted: bool = False,
    limit: int = Query(LIST_DEFAULT_LIMIT, ge=1, le=LIST_MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> LeaveListResponse:
    rows, total = leave_service.list_leaves(
        db,
        employee_id=employee_id,
        status=leave_status,
        leave_type=leave_type,
        from_date=from_date,
        to_date=to_date,
        q=q,
        include_deleted=include_deleted,
        limit=limit,
        offset=offset,
    )
    return LeaveListResponse(
        items=[
            _with_employee_name(
                LeaveListItem.model_validate(r).model_copy(
                    update={"has_certificate": bool(r.certificate_path)}
                ),
                r,
            )
            for r in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=LeaveRead, status_code=status.HTTP_201_CREATED)
def create_leave(
    payload: LeaveCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("leaves.edit"))],
) -> LeaveRead:
    """Manual record creation — National Service only (other kinds are born
    from form generation)."""
    row = leave_service.create_leave(db, payload, actor=_user.email)
    return _with_employee_name(LeaveRead.model_validate(row), row)


@router.get("/{leave_id}", response_model=LeaveRead)
def get_leave(
    leave_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("leaves.view"))],
) -> LeaveRead:
    row = leave_service.get_leave(db, leave_id)
    return _with_employee_name(LeaveRead.model_validate(row), row)


@router.patch("/{leave_id}", response_model=LeaveRead)
def update_leave(
    leave_id: int,
    payload: LeaveUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("leaves.edit"))],
) -> LeaveRead:
    row = leave_service.update_leave(db, leave_id, payload, actor=_user.email)
    return _with_employee_name(LeaveRead.model_validate(row), row)


@router.post("/{leave_id}/certificate", response_model=LeaveRead)
async def upload_leave_certificate(
    leave_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("leaves.edit"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> LeaveRead:
    data = await upload.read()
    row = leave_service.add_certificate(
        db, leave_id, upload.filename or "certificate", data, actor=_user.email
    )
    return _with_employee_name(LeaveRead.model_validate(row), row)


@router.post("/{leave_id}/return", response_model=LeaveRead)
def file_leave_return(
    leave_id: int,
    payload: LeaveReturnRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("leaves.edit"))],
) -> LeaveRead:
    """File the Duty Resumption (return) form and complete the leave."""
    row = leave_service.file_return(
        db,
        leave_id,
        resumption_date=payload.resumption_date,
        delay_reason=payload.delay_reason,
        manager_id=payload.manager_id,
        actor=user.email,
        current_user=user,
    )
    return _with_employee_name(LeaveRead.model_validate(row), row)


@router.get("/{leave_id}/certificate")
def download_leave_certificate(
    leave_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("leaves.view"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    path = leave_service.get_certificate_file(db, leave_id)
    raw = path.read_bytes()
    # IDM-safe: text/plain + base64 (same trick as document download).
    if (b64 := maybe_base64(raw, encoding)) is not None:
        return b64
    media = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return Response(
        content=raw,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="{path.name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{leave_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_leave(
    leave_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("leaves.edit"))],
) -> Response:
    leave_service.soft_delete_leave(db, leave_id, actor=_user.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
