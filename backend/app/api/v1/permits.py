"""Security-permit register endpoints — greenfield feature (2026-07).

Routes (all under ``/api/v1``):
  GET    /permits                       — paginated list with filters
  GET    /permits/summary               — dashboard-tile counts
  GET    /permits/export                — CSV of the (filtered) register
  POST   /permits                       — issue a permit
  GET    /permits/{id}                  — detail (with people)
  PATCH  /permits/{id}                  — edit header fields
  POST   /permits/{id}/renew            — extend the window
  POST   /permits/{id}/revoke           — revoke early
  DELETE /permits/{id}                  — soft-delete (204)
  POST   /permits/{id}/people           — add a person
  DELETE /permits/{id}/people/{pid}     — remove a person (soft)
  GET    /permits/{id}/visits           — list gate crossings
  POST   /permits/{id}/visits           — record a gate crossing (scanner hook)

Naming note: unrelated to ``/permissions`` (RBAC). Capability gates use the
``permits.*`` domain. Global auth is applied at mount time in main.py.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api._responses import maybe_base64
from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.permit import (
    PermitCreate,
    PermitListResponse,
    PermitPersonCreate,
    PermitRead,
    PermitRenew,
    PermitRevoke,
    PermitSummary,
    PermitUpdate,
    PermitVehicleCreate,
    PermitVisitCreate,
    PermitVisitRead,
)
from app.services import permit_service

router = APIRouter(prefix="/permits", tags=["permits"])

LIST_DEFAULT_LIMIT = 50
LIST_MAX_LIMIT = 500


def _file_response(path: Path, encoding: str | None) -> Response:
    """IDM-safe file download shared by every permit attachment endpoint."""
    raw = path.read_bytes()
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


@router.get("", response_model=PermitListResponse)
def list_permits(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.view"))],
    state: Annotated[str | None, Query()] = None,
    zone: str | None = None,
    company: str | None = None,
    q: str | None = None,
    include_deleted: bool = False,
    limit: int = Query(LIST_DEFAULT_LIMIT, ge=1, le=LIST_MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> PermitListResponse:
    rows, total = permit_service.list_permits(
        db,
        state=state,
        zone=zone,
        company=company,
        q=q,
        include_deleted=include_deleted,
        limit=limit,
        offset=offset,
    )
    return PermitListResponse(
        items=[permit_service.to_list_item(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/summary", response_model=PermitSummary)
def permit_summary(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.view"))],
) -> PermitSummary:
    return PermitSummary(**permit_service.summary(db))


@router.get("/export")
def export_permits(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.view"))],
    state: str | None = None,
    zone: str | None = None,
    company: str | None = None,
    q: str | None = None,
    ids: Annotated[str | None, Query(description="Comma-separated permit ids to export")] = None,
) -> Response:
    id_list = (
        [int(x) for x in ids.split(",") if x.strip().isdigit()] if ids else None
    )
    csv_text = permit_service.export_csv(
        db, state=state, zone=zone, company=company, q=q, ids=id_list
    )
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="permits.csv"'},
    )


@router.post("", response_model=PermitRead, status_code=status.HTTP_201_CREATED)
def create_permit(
    payload: PermitCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitRead:
    row = permit_service.create_permit(db, payload, actor=user.email)
    return permit_service.to_read(row)


@router.get("/{permit_id}", response_model=PermitRead)
def get_permit(
    permit_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.view"))],
) -> PermitRead:
    row = permit_service.get_permit(db, permit_id)
    return permit_service.to_read(row)


@router.patch("/{permit_id}", response_model=PermitRead)
def update_permit(
    permit_id: int,
    payload: PermitUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitRead:
    row = permit_service.update_permit(db, permit_id, payload, actor=user.email)
    return permit_service.to_read(row)


@router.post("/{permit_id}/renew", response_model=PermitRead)
def renew_permit(
    permit_id: int,
    payload: PermitRenew,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitRead:
    row = permit_service.renew_permit(
        db, permit_id, new_end_date=payload.new_end_date, reason=payload.reason,
        actor=user.email,
    )
    return permit_service.to_read(row)


@router.post("/{permit_id}/revoke", response_model=PermitRead)
def revoke_permit(
    permit_id: int,
    payload: PermitRevoke,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitRead:
    row = permit_service.revoke_permit(db, permit_id, reason=payload.reason, actor=user.email)
    return permit_service.to_read(row)


@router.delete("/{permit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_permit(
    permit_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> Response:
    permit_service.soft_delete_permit(db, permit_id, actor=user.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{permit_id}/people", response_model=PermitRead, status_code=status.HTTP_201_CREATED)
def add_person(
    permit_id: int,
    payload: PermitPersonCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitRead:
    row = permit_service.add_person(db, permit_id, payload, actor=user.email)
    return permit_service.to_read(row)


@router.delete("/{permit_id}/people/{person_id}", response_model=PermitRead)
def remove_person(
    permit_id: int,
    person_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitRead:
    row = permit_service.remove_person(db, permit_id, person_id, actor=user.email)
    return permit_service.to_read(row)


@router.post("/{permit_id}/people/{person_id}/document", response_model=PermitRead)
async def upload_person_document(
    permit_id: int,
    person_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> PermitRead:
    data = await upload.read()
    row = permit_service.attach_person_document(
        db, permit_id, person_id, upload.filename or "uae-id", data, actor=user.email
    )
    return permit_service.to_read(row)


@router.get("/{permit_id}/people/{person_id}/document")
def download_person_document(
    permit_id: int,
    person_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.view"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    return _file_response(
        permit_service.get_person_document_file(db, permit_id, person_id), encoding
    )


@router.post("/{permit_id}/vehicles", response_model=PermitRead, status_code=status.HTTP_201_CREATED)
def add_vehicle(
    permit_id: int,
    payload: PermitVehicleCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitRead:
    row = permit_service.add_vehicle(db, permit_id, payload, actor=user.email)
    return permit_service.to_read(row)


@router.delete("/{permit_id}/vehicles/{vehicle_id}", response_model=PermitRead)
def remove_vehicle(
    permit_id: int,
    vehicle_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitRead:
    row = permit_service.remove_vehicle(db, permit_id, vehicle_id, actor=user.email)
    return permit_service.to_read(row)


@router.post("/{permit_id}/vehicles/{vehicle_id}/document", response_model=PermitRead)
async def upload_vehicle_document(
    permit_id: int,
    vehicle_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> PermitRead:
    data = await upload.read()
    row = permit_service.attach_vehicle_document(
        db, permit_id, vehicle_id, upload.filename or "licence", data, actor=user.email
    )
    return permit_service.to_read(row)


@router.get("/{permit_id}/vehicles/{vehicle_id}/document")
def download_vehicle_document(
    permit_id: int,
    vehicle_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.view"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    return _file_response(
        permit_service.get_vehicle_document_file(db, permit_id, vehicle_id), encoding
    )


@router.post("/{permit_id}/document", response_model=PermitRead)
async def upload_permit_document(
    permit_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> PermitRead:
    data = await upload.read()
    row = permit_service.attach_document(
        db, permit_id, upload.filename or "permit", data, actor=user.email
    )
    return permit_service.to_read(row)


@router.get("/{permit_id}/document")
def download_permit_document(
    permit_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.view"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    return _file_response(permit_service.get_document_file(db, permit_id), encoding)


@router.delete("/{permit_id}/document", response_model=PermitRead)
def remove_permit_document(
    permit_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitRead:
    row = permit_service.remove_document(db, permit_id, actor=user.email)
    return permit_service.to_read(row)


@router.get("/{permit_id}/visits", response_model=list[PermitVisitRead])
def list_visits(
    permit_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("permits.view"))],
    limit: int = Query(100, ge=1, le=500),
) -> list[PermitVisitRead]:
    rows = permit_service.list_visits(db, permit_id, limit=limit)
    return [PermitVisitRead.model_validate(r) for r in rows]


@router.post(
    "/{permit_id}/visits",
    response_model=PermitVisitRead,
    status_code=status.HTTP_201_CREATED,
)
def record_visit(
    permit_id: int,
    payload: PermitVisitCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitVisitRead:
    row = permit_service.record_visit(db, permit_id, payload, actor=user.email)
    return PermitVisitRead.model_validate(row)


__all__ = ["router"]
