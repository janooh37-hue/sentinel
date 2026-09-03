"""Fleet vehicle, fine, accident, maintenance, and file endpoints."""

from __future__ import annotations

from datetime import date as date_t
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api._responses import maybe_base64
from app.api.deps import require_capability
from app.db.models import User, VehicleFile
from app.db.session import get_db
from app.schemas.vehicle import (
    EvgConfirmRequest,
    EvgConfirmResult,
    EvgPreviewRequest,
    EvgPreviewResponse,
    FinesLetterRequest,
    LetterResult,
    LicenseRenewCreate,
    NotifyDaysUpdate,
    VehicleAccidentCreate,
    VehicleAccidentRead,
    VehicleAccidentStatusUpdate,
    VehicleCreate,
    VehicleFileRead,
    VehicleFineCreate,
    VehicleFineRead,
    VehicleFineUpdate,
    VehicleListItem,
    VehicleMaintenanceCreate,
    VehicleMaintenanceRead,
    VehicleRead,
    VehicleSiteCreate,
    VehicleSiteRead,
    VehicleSiteUpdate,
    VehiclesSummary,
    VehicleUpdate,
)
from app.services import (
    settings_service,
    vehicle_evg_service,
    vehicle_letter_service,
    vehicle_service,
)

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


def _file_response(row: VehicleFile, path: Path, encoding: str | None) -> Response:
    raw = path.read_bytes()
    if (encoded := maybe_base64(raw, encoding)) is not None:
        return encoded
    disposition = "inline" if row.media_type.startswith("image/") else "attachment"
    return Response(
        content=raw,
        media_type=row.media_type,
        headers={
            "Content-Disposition": (f'{disposition}; filename="{row.original_name}"'),
            "X-Content-Type-Options": "nosniff",
        },
    )


# Static paths must remain above /{vehicle_id}; otherwise FastAPI treats words
# such as "summary" and "fines" as integer vehicle ids and returns a 422.
@router.get("/summary", response_model=VehiclesSummary)
def vehicles_summary(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.view"))],
) -> VehiclesSummary:
    return vehicle_service.summary(db)


@router.put("/notify-days", response_model=VehiclesSummary)
def update_notify_days(
    payload: NotifyDaysUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehiclesSummary:
    settings_service.set_vehicle_notify_days(db, payload.days)
    return vehicle_service.summary(db)


@router.get("/sites", response_model=list[VehicleSiteRead])
def list_vehicle_sites(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.view"))],
) -> list[VehicleSiteRead]:
    return [vehicle_service.site_read(row) for row in vehicle_service.list_sites(db)]


@router.post(
    "/sites",
    response_model=VehicleSiteRead,
    status_code=status.HTTP_201_CREATED,
)
def create_vehicle_site(
    payload: VehicleSiteCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehicleSiteRead:
    return vehicle_service.site_read(vehicle_service.create_site(db, payload, actor=user.email))


@router.patch("/sites/{site_id}", response_model=VehicleSiteRead)
def update_vehicle_site(
    site_id: int,
    payload: VehicleSiteUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehicleSiteRead:
    return vehicle_service.site_read(
        vehicle_service.update_site(db, site_id, payload, actor=user.email)
    )


@router.get("/fines", response_model=list[VehicleFineRead])
def list_vehicle_fines(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.view"))],
    site_id: int | None = None,
    date_from: date_t | None = None,
    date_to: date_t | None = None,
) -> list[VehicleFineRead]:
    rows = vehicle_service.list_fines(db, site_id=site_id, date_from=date_from, date_to=date_to)
    return [vehicle_service.fine_read(row) for row in rows]


@router.post("/fines/evg/preview", response_model=EvgPreviewResponse)
def preview_evg_fines(
    payload: EvgPreviewRequest,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> EvgPreviewResponse:
    return vehicle_evg_service.preview(
        db,
        traffic_codes=payload.traffic_codes,
    )


@router.post("/fines/evg/confirm", response_model=EvgConfirmResult)
def confirm_evg_fines(
    payload: EvgConfirmRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> EvgConfirmResult:
    return vehicle_evg_service.confirm(db, payload.rows, user=user)


@router.get("/accidents", response_model=list[VehicleAccidentRead])
def list_vehicle_accidents(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.view"))],
) -> list[VehicleAccidentRead]:
    return [vehicle_service.accident_read(row) for row in vehicle_service.list_accidents(db)]


@router.post(
    "/accidents",
    response_model=VehicleAccidentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_vehicle_accident(
    payload: VehicleAccidentCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehicleAccidentRead:
    row = vehicle_service.create_accident(db, payload, actor=user.email)
    return vehicle_service.accident_read(row)


@router.get("/maintenance", response_model=list[VehicleMaintenanceRead])
def list_vehicle_maintenance(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.view"))],
) -> list[VehicleMaintenanceRead]:
    notify_days = settings_service.get_vehicle_notify_days(db)
    today = date_t.today()
    return [
        vehicle_service.maintenance_read(row, today=today, notify_days=notify_days)
        for row in vehicle_service.list_maintenance(db)
    ]


@router.post(
    "/maintenance",
    response_model=VehicleMaintenanceRead,
    status_code=status.HTTP_201_CREATED,
)
def create_vehicle_maintenance(
    payload: VehicleMaintenanceCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehicleMaintenanceRead:
    row = vehicle_service.create_maintenance(db, payload, actor=user.email)
    return vehicle_service.maintenance_read(
        row,
        today=date_t.today(),
        notify_days=settings_service.get_vehicle_notify_days(db),
    )


@router.get("", response_model=list[VehicleListItem])
def list_vehicles(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.view"))],
    q: str | None = None,
    site_id: int | None = None,
    expiry: Annotated[
        str,
        Query(pattern=r"^(?:all|attention|valid|due|expired)$"),
    ] = "all",
) -> list[VehicleListItem]:
    today = date_t.today()
    notify_days = settings_service.get_vehicle_notify_days(db)
    rows = vehicle_service.list_vehicles(
        db,
        q=q,
        site_id=site_id,
        expiry=expiry,
        today=today,
        notify_days=notify_days,
    )
    return [vehicle_service.to_list_item(row, today=today, notify_days=notify_days) for row in rows]


@router.post("", response_model=VehicleRead, status_code=status.HTTP_201_CREATED)
def create_vehicle(
    payload: VehicleCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehicleRead:
    row = vehicle_service.create_vehicle(db, payload, actor=user.email)
    return vehicle_service.to_read(row)


@router.get("/{vehicle_id}", response_model=VehicleRead)
def get_vehicle(
    vehicle_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.view"))],
) -> VehicleRead:
    return vehicle_service.to_read(vehicle_service.get_vehicle(db, vehicle_id))


@router.patch("/{vehicle_id}", response_model=VehicleRead)
def update_vehicle(
    vehicle_id: int,
    payload: VehicleUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehicleRead:
    row = vehicle_service.update_vehicle(db, vehicle_id, payload, actor=user.email)
    return vehicle_service.to_read(row)


@router.post("/{vehicle_id}/renew", response_model=VehicleRead)
def renew_vehicle_license(
    vehicle_id: int,
    payload: LicenseRenewCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehicleRead:
    row = vehicle_service.renew_license(db, vehicle_id, payload, actor=user.email)
    return vehicle_service.to_read(row)


@router.post("/{vehicle_id}/files", response_model=VehicleFileRead)
async def upload_vehicle_file(
    vehicle_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.edit"))],
    kind: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    label_ar: Annotated[str | None, Form()] = None,
    label_en: Annotated[str | None, Form()] = None,
) -> VehicleFileRead:
    data = await file.read(vehicle_service.MAX_FILE_BYTES + 1)
    row = vehicle_service.store_file(
        db,
        vehicle_id,
        kind=kind,
        filename=file.filename or "vehicle-file",
        data=data,
        media_type=file.content_type or "application/octet-stream",
        label_ar=label_ar,
        label_en=label_en,
    )
    return VehicleFileRead.model_validate(row).model_copy(
        update={"url": f"/api/v1/vehicles/{vehicle_id}/files/{row.id}"}
    )


@router.get("/{vehicle_id}/files/{file_id}")
def get_vehicle_file(
    vehicle_id: int,
    file_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("vehicles.view"))],
    encoding: str | None = None,
) -> Response:
    row, path = vehicle_service.resolve_file(db, vehicle_id, file_id)
    return _file_response(row, path, encoding)


@router.delete(
    "/{vehicle_id}/files/{file_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_vehicle_file(
    vehicle_id: int,
    file_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.delete"))],
) -> Response:
    vehicle_service.delete_file(db, vehicle_id, file_id, actor=user.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{vehicle_id}/fines",
    response_model=VehicleRead,
    status_code=status.HTTP_201_CREATED,
)
def add_vehicle_fine(
    vehicle_id: int,
    payload: VehicleFineCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehicleRead:
    row = vehicle_service.add_fine(
        db,
        vehicle_id,
        payload,
        actor=user.email,
        created_by_user_id=user.id,
    )
    return vehicle_service.to_read(row)


@router.post("/{vehicle_id}/fines/letter", response_model=LetterResult)
def generate_vehicle_fines_letter(
    vehicle_id: int,
    payload: FinesLetterRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> LetterResult:
    return vehicle_letter_service.generate_fines_letter(
        db,
        vehicle_id,
        fine_ids=payload.fine_ids,
        hide_names=payload.hide_names,
        user=user,
    )


@router.patch("/{vehicle_id}/fines/{fine_id}", response_model=VehicleRead)
def update_vehicle_fine(
    vehicle_id: int,
    fine_id: int,
    payload: VehicleFineUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehicleRead:
    row = vehicle_service.update_fine(db, vehicle_id, fine_id, payload, actor=user.email)
    return vehicle_service.to_read(row)


@router.delete("/{vehicle_id}/fines/{fine_id}", response_model=VehicleRead)
def delete_vehicle_fine(
    vehicle_id: int,
    fine_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.delete"))],
) -> VehicleRead:
    row = vehicle_service.delete_fine(db, vehicle_id, fine_id, actor=user.email)
    return vehicle_service.to_read(row)


@router.post(
    "/{vehicle_id}/accidents/{accident_id}/letter",
    response_model=LetterResult,
)
def generate_vehicle_accident_letter(
    vehicle_id: int,
    accident_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> LetterResult:
    return vehicle_letter_service.generate_accident_letter(
        db,
        vehicle_id,
        accident_id,
        user=user,
    )


@router.patch(
    "/{vehicle_id}/accidents/{accident_id}",
    response_model=VehicleAccidentRead,
)
def update_vehicle_accident_status(
    vehicle_id: int,
    accident_id: int,
    payload: VehicleAccidentStatusUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.edit"))],
) -> VehicleAccidentRead:
    row = vehicle_service.set_accident_status(
        db,
        vehicle_id,
        accident_id,
        payload.status,
        actor=user.email,
    )
    return vehicle_service.accident_read(row)


@router.delete(
    "/{vehicle_id}/accidents/{accident_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_vehicle_accident(
    vehicle_id: int,
    accident_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.delete"))],
) -> Response:
    vehicle_service.delete_accident(db, vehicle_id, accident_id, actor=user.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{vehicle_id}/maintenance/{maintenance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_vehicle_maintenance(
    vehicle_id: int,
    maintenance_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("vehicles.delete"))],
) -> Response:
    vehicle_service.delete_maintenance(db, vehicle_id, maintenance_id, actor=user.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
