"""Employees + Violations + Vault + Signature endpoints.

Bundled into one module because they form the Phase 03 vertical slice and
share the same employee scope. Splitting per-resource adds three files of
boilerplate without making anything easier to find.

The router prefix is ``/employees`` for employee-scoped routes; a sibling
router lives at ``/violations`` for the two ID-scoped violation routes
(PATCH/DELETE) since the route can resolve violations directly by id.
"""

from __future__ import annotations

import base64
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.api.errors import NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core import signature as signature_core
from app.core.vault_manager import Vault
from app.db.models import User, VaultFile
from app.db.session import get_db
from app.schemas import employee_detail as detail_schemas
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeListItem,
    EmployeeListResponse,
    EmployeeRead,
    EmployeeUpdate,
)
from app.schemas.leave import LeaveBalanceRead, LeaveRead
from app.schemas.vault_file import VaultEntry, VaultTree
from app.schemas.violation import ViolationCreate, ViolationRead, ViolationUpdate
from app.services import (
    employee_detail_service,
    employee_service,
    leave_service,
    photo_service,
    vault_service,
    violation_service,
)
from app.services.employee_service import LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT

router = APIRouter(prefix="/employees", tags=["employees"])
violations_router = APIRouter(prefix="/violations", tags=["violations"])


def _photo_fields(db: Session, employee_id: str) -> dict[str, object]:
    """has_photo + photo_version for a single employee read response."""
    version = photo_service.get_photo_version(db, employee_id)
    return {"has_photo": version is not None, "photo_version": version}


# --- Employees ---------------------------------------------------------------


@router.get("", response_model=EmployeeListResponse)
def list_employees(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
    q: str | None = None,
    employee_status: Annotated[str | None, Query(alias="status")] = None,
    department: str | None = None,
    duty_unit: str | None = None,
    limit: int = Query(LIST_DEFAULT_LIMIT, ge=1, le=LIST_MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> EmployeeListResponse:
    rows, total = employee_service.list_employees(
        db,
        q=q,
        status=employee_status,
        department=department,
        duty_unit=duty_unit,
        limit=limit,
        offset=offset,
    )
    # One query for the set of employees with a vault photo — avoids N+1.
    photo_ids = set(
        db.execute(
            select(VaultFile.employee_id)
            .where(VaultFile.kind == "photo")
            .distinct()
        ).scalars()
    )
    return EmployeeListResponse(
        items=[
            EmployeeListItem.model_validate(r).model_copy(
                update={"has_photo": r.id in photo_ids}
            )
            for r in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=EmployeeRead, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.edit"))],
) -> EmployeeRead:
    row = employee_service.create_employee(db, payload)
    return EmployeeRead.model_validate(row).model_copy(
        update=_photo_fields(db, row.id)
    )


@router.get("/{employee_id}", response_model=EmployeeRead)
def get_employee(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
) -> EmployeeRead:
    row = employee_service.get_employee(db, employee_id)
    return EmployeeRead.model_validate(row).model_copy(
        update=_photo_fields(db, row.id)
    )


@router.patch("/{employee_id}", response_model=EmployeeRead)
def update_employee(
    employee_id: str,
    payload: EmployeeUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.edit"))],
) -> EmployeeRead:
    row = employee_service.update_employee(db, employee_id, payload)
    return EmployeeRead.model_validate(row).model_copy(
        update=_photo_fields(db, row.id)
    )


# --- Employee detail (aggregate for the Employee Detail page) ----------------


@router.get(
    "/{employee_id}/detail", response_model=detail_schemas.EmployeeDetailRead
)
def get_employee_detail(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
) -> detail_schemas.EmployeeDetailRead:
    """Aggregate everything tied to an employee — for the Employee Detail page."""
    detail = employee_detail_service.get_employee_detail(db, employee_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    return detail


# --- Leaves (read-only list + balance) ---------------------------------------


@router.get("/{employee_id}/leaves", response_model=list[LeaveRead])
def list_employee_leaves(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
) -> list[LeaveRead]:
    rows = leave_service.list_for_employee(db, employee_id)
    return [LeaveRead.model_validate(r) for r in rows]


@router.get("/{employee_id}/leave-balance", response_model=LeaveBalanceRead)
def get_leave_balance(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
    as_of: date | None = None,
) -> LeaveBalanceRead:
    effective_date = as_of if as_of is not None else date.today()
    return leave_service.compute_balance(db, employee_id, as_of=effective_date)


# --- Violations --------------------------------------------------------------


@router.get("/{employee_id}/violations", response_model=list[ViolationRead])
def list_employee_violations(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("violations.view"))],
) -> list[ViolationRead]:
    rows = violation_service.list_for_employee(db, employee_id)
    return [ViolationRead.model_validate(r) for r in rows]


@router.post(
    "/{employee_id}/violations",
    response_model=ViolationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_employee_violation(
    employee_id: str,
    payload: ViolationCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("violations.manage"))],
) -> ViolationRead:
    row = violation_service.create(db, employee_id, payload)
    return ViolationRead.model_validate(row)


@violations_router.patch("/{violation_id}", response_model=ViolationRead)
def update_violation(
    violation_id: int,
    payload: ViolationUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("violations.manage"))],
) -> ViolationRead:
    return ViolationRead.model_validate(
        violation_service.update(db, violation_id, payload)
    )


@violations_router.delete(
    "/{violation_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_violation(
    violation_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("violations.manage"))],
) -> Response:
    violation_service.delete(db, violation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Vault -------------------------------------------------------------------


@router.get("/{employee_id}/vault", response_model=VaultTree)
def get_employee_vault(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
) -> VaultTree:
    # 404 fast if the employee row is gone — avoids producing a tree for an
    # orphaned vault directory that the importer happened to leave behind.
    employee_service.get_employee(db, employee_id)
    return vault_service.list_tree(employee_id)


@router.post(
    "/{employee_id}/vault/upload",
    response_model=VaultEntry,
    status_code=status.HTTP_201_CREATED,
)
async def upload_to_vault(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.edit"))],
    kind: Annotated[str, Form()],
    upload: Annotated[UploadFile, File(alias="file")],
) -> VaultEntry:
    employee_service.get_employee(db, employee_id)
    data = await upload.read()
    return vault_service.save_upload(
        employee_id, kind, upload.filename or "upload", data
    )


@router.delete(
    "/{employee_id}/vault/{kind}/{filename:path}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_vault_file(
    employee_id: str,
    kind: str,
    filename: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.edit"))],
) -> Response:
    employee_service.get_employee(db, employee_id)
    vault_service.delete_file(db, employee_id, kind, filename)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{employee_id}/vault/{kind}/{filename:path}/preview",
)
def vault_preview(
    employee_id: str,
    kind: str,
    filename: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
) -> FileResponse:
    employee_service.get_employee(db, employee_id)
    path = vault_service.preview_image_for(employee_id, kind, filename)
    media = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(str(path), media_type=media)


@router.get(
    "/{employee_id}/vault/{kind}/{filename:path}/download",
    response_model=None,
)
def vault_download(
    employee_id: str,
    kind: str,
    filename: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> FileResponse | Response:
    employee_service.get_employee(db, employee_id)
    path = vault_service.resolve_file(employee_id, kind, filename)
    if encoding == "base64":
        # Base64 text/plain so Internet Download Manager / the browser's PDF
        # handler never intercept the bytes — pdf.js decodes them. Mirrors
        # ledger.py's attachment route.
        return Response(
            content=base64.b64encode(path.read_bytes()),
            media_type="text/plain",
            headers={"X-Content-Type-Options": "nosniff"},
        )
    return FileResponse(str(path), filename=path.name)


# --- Signature ---------------------------------------------------------------


def _signature_path_for(employee_id: str) -> Path:
    """Resolve the employee's signature path with vault containment.

    Defense-in-depth (mirrors the photo route's guard): the id comes from a DB
    primary-key lookup, but nothing constrains seeded ids from carrying path
    separators — never dereference a path that escapes the vault root.
    """
    vault_root = get_settings().vault_dir.resolve()
    path = signature_core.vault_path(
        Vault(get_settings().vault_dir), employee_id
    ).resolve()
    if vault_root not in path.parents:
        raise HTTPException(status_code=400, detail="invalid signature path")
    return path


@router.post(
    "/{employee_id}/signature",
    status_code=status.HTTP_201_CREATED,
)
async def upload_signature(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.edit"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> dict[str, str]:
    employee_service.get_employee(db, employee_id)
    data = await upload.read()
    try:
        data = signature_core.normalize_to_png(data)
        path = signature_core.save(
            data, employee_id, Vault(get_settings().vault_dir)
        )
    except signature_core.SignatureError as exc:
        raise ValidationFailedError(
            "SIGNATURE_INVALID", str(exc), employee_id=employee_id
        ) from exc
    return {"path": str(path), "filename": path.name}


@router.get("/{employee_id}/signature")
def get_employee_signature(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """Saved signature for ``employee_id`` — raw PNG, or base64 ``text/plain``
    with ``?encoding=base64`` (IDM workaround, mirrors ``/signatures/me``).
    ``X-Signature-Updated`` carries the file mtime (ISO) for the UI info line."""
    employee_service.get_employee(db, employee_id)
    path = _signature_path_for(employee_id)
    if not path.is_file():
        raise NotFoundError(
            "SIGNATURE_NOT_FOUND",
            "No signature on file for this employee.",
            employee_id=employee_id,
        )
    updated = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC).isoformat()
    data = path.read_bytes()
    if encoding == "base64":
        return Response(
            content=base64.b64encode(data),
            media_type="text/plain",
            headers={
                "X-Content-Type-Options": "nosniff",
                "X-Signature-Updated": updated,
            },
        )
    return Response(
        content=data,
        media_type="image/png",
        headers={"X-Signature-Updated": updated},
    )


@router.delete(
    "/{employee_id}/signature", status_code=status.HTTP_204_NO_CONTENT
)
def delete_employee_signature(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.edit"))],
) -> Response:
    """Remove the employee's saved signature. Idempotent."""
    employee_service.get_employee(db, employee_id)
    _signature_path_for(employee_id).unlink(missing_ok=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Photo (convenience: stream the first vault photo) ----------------------


@router.post("/{employee_id}/photo", status_code=status.HTTP_201_CREATED)
async def upload_employee_photo(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.edit"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> dict[str, object]:
    """Replace the employee's avatar photo (one per employee)."""
    employee_service.get_employee(db, employee_id)
    data = await upload.read()
    row = photo_service.save_photo(
        db, employee_id, upload.filename or "photo.png", data
    )
    return {
        "filename": row.filename,
        "size_bytes": row.size_bytes,
        "photo_version": str(row.id),
    }


@router.delete(
    "/{employee_id}/photo", status_code=status.HTTP_204_NO_CONTENT
)
def delete_employee_photo(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.edit"))],
) -> Response:
    """Remove the employee's photo. Idempotent."""
    employee_service.get_employee(db, employee_id)
    photo_service.delete_photo(db, employee_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{employee_id}/photo", response_class=FileResponse)
def get_employee_photo(
    employee_id: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
) -> FileResponse:
    """Stream the first vault photo for the employee.

    Used by the AccountMenu + LockOverlay to render the linked user's photo
    without needing to know the filename. Cached privately for 60 seconds.
    """
    row = db.execute(
        select(VaultFile)
        .where(VaultFile.employee_id == employee_id, VaultFile.kind == "photo")
        .order_by(VaultFile.created_at.asc())
        .limit(1)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="no photo on file")
    # Resolve via the stored vault-relative path (row.path) to avoid
    # _ensure_kind raising 422 — "photo" is not in VAULT_KINDS (those are
    # document-folder kinds); the path is already safe from when it was written.
    vault_root = get_settings().vault_dir.resolve()
    abs_path = (vault_root / row.path).resolve()
    if vault_root not in abs_path.parents:
        raise HTTPException(status_code=400, detail="invalid photo path")
    if not abs_path.is_file():
        raise HTTPException(status_code=404, detail="photo file missing on disk")
    return FileResponse(
        str(abs_path),
        filename=row.filename,
        headers={"Cache-Control": "private, max-age=60"},
    )


__all__ = ["router", "violations_router"]
