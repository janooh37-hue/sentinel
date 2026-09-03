"""Fleet vehicle CRUD, files, derived status, and audit writes."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session, selectinload

from app.api.errors import NotFoundError, ValidationFailedError
from app.config import get_settings
from app.db.models import (
    AuditLog,
    Employee,
    Vehicle,
    VehicleAccident,
    VehicleFile,
    VehicleFine,
    VehicleLicenseRenewal,
    VehicleMaintenance,
    VehicleSite,
)
from app.schemas.vehicle import (
    LicenseRenewalRead,
    LicenseRenewCreate,
    VehicleAccidentCreate,
    VehicleAccidentRead,
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
from app.services import settings_service

log = logging.getLogger(__name__)

MAX_FILE_BYTES = 25 * 1024 * 1024
_ALLOWED_EXTENSIONS = frozenset({".pdf", ".png", ".jpg", ".jpeg", ".webp"})
_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp"})
_IMAGE_KINDS = frozenset({"photo", "gallery", "accident"})
_FILE_KINDS = frozenset({"photo", "license", "gallery", "accident", "receipt"})
_ALLOWED_MEDIA_BY_EXTENSION: dict[str, frozenset[str]] = {
    ".pdf": frozenset({"application/pdf"}),
    ".png": frozenset({"image/png"}),
    ".jpg": frozenset({"image/jpeg", "image/jpg"}),
    ".jpeg": frozenset({"image/jpeg", "image/jpg"}),
    ".webp": frozenset({"image/webp"}),
}
_UNSAFE_CHARS = re.compile('[\\\\/:*?"<>|\x00-\x1f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]')


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def expiry_status(expiry: date, *, today: date, notify_days: int) -> str:
    days = (expiry - today).days
    if days < 0:
        return "expired"
    if days <= notify_days:
        return "due"
    return "valid"


def due_state(next_due: date | None, *, today: date, notify_days: int) -> str | None:
    if next_due is None:
        return None
    days = (next_due - today).days
    if days < 0:
        return "overdue"
    if days <= notify_days:
        return "due"
    return "scheduled"


def plate_label(row: Vehicle) -> str:
    if row.plate_code:
        return f"{row.plate_code} \\ {row.plate_number}"
    return row.plate_number


def _file_url(vehicle_id: int, file_id: int) -> str:
    return f"/api/v1/vehicles/{vehicle_id}/files/{file_id}"


def _notify_window(row: Vehicle, notify_days: int | None) -> int:
    if notify_days is not None:
        return notify_days
    db = object_session(row)
    if db is None:
        raise RuntimeError("A notify_days value is required for a detached vehicle")
    return settings_service.get_vehicle_notify_days(db)


def _file_read(row: VehicleFile) -> VehicleFileRead:
    return VehicleFileRead.model_validate(row).model_copy(
        update={"url": _file_url(row.vehicle_id, row.id)}
    )


def _vehicle_file(row: Vehicle, file_id: int | None) -> VehicleFile | None:
    if file_id is None:
        return None
    return next((item for item in row.files if item.id == file_id), None)


def fine_read(row: VehicleFine, *, vehicle: Vehicle | None = None) -> VehicleFineRead:
    owner = vehicle or row.vehicle
    employee = row.employee
    return VehicleFineRead.model_validate(row).model_copy(
        update={
            "employee_name_ar": employee.name_ar if employee is not None else None,
            "employee_name_en": employee.name_en if employee is not None else None,
            "vehicle_plate_label": plate_label(owner),
            "vehicle_type_ar": owner.type_ar,
            "vehicle_type_en": owner.type_en,
            "vehicle_site_id": owner.site_id,
        }
    )


def accident_read(row: VehicleAccident, *, vehicle: Vehicle | None = None) -> VehicleAccidentRead:
    owner = vehicle or row.vehicle
    employee = row.employee
    files = {item.id: item for item in owner.files}
    photos = [_file_read(files[file_id]) for file_id in row.photo_file_ids if file_id in files]
    return VehicleAccidentRead.model_validate(row).model_copy(
        update={
            "employee_name_ar": employee.name_ar if employee is not None else None,
            "employee_name_en": employee.name_en if employee is not None else None,
            "photos": photos,
            "vehicle_plate_label": plate_label(owner),
            "vehicle_type_ar": owner.type_ar,
            "vehicle_type_en": owner.type_en,
            "vehicle_vin": owner.vin,
            "vehicle_site_id": owner.site_id,
        }
    )


def maintenance_read(
    row: VehicleMaintenance,
    *,
    vehicle: Vehicle | None = None,
    today: date | None = None,
    notify_days: int | None = None,
) -> VehicleMaintenanceRead:
    owner = vehicle or row.vehicle
    current_day = today or date.today()
    window = _notify_window(owner, notify_days)
    receipt = _vehicle_file(owner, row.receipt_file_id)
    return VehicleMaintenanceRead.model_validate(row).model_copy(
        update={
            "due_state": due_state(row.next_due, today=current_day, notify_days=window),
            "receipt_url": (_file_url(owner.id, receipt.id) if receipt is not None else None),
            "vehicle_plate_label": plate_label(owner),
            "vehicle_type_ar": owner.type_ar,
            "vehicle_type_en": owner.type_en,
        }
    )


def _renewal_read(row: VehicleLicenseRenewal, *, vehicle: Vehicle) -> LicenseRenewalRead:
    scan = _vehicle_file(vehicle, row.scan_file_id)
    return LicenseRenewalRead.model_validate(row).model_copy(
        update={"scan_url": _file_url(vehicle.id, scan.id) if scan is not None else None}
    )


def to_list_item(
    row: Vehicle,
    *,
    today: date | None = None,
    notify_days: int | None = None,
) -> VehicleListItem:
    current_day = today or date.today()
    window = _notify_window(row, notify_days)
    photo = _vehicle_file(row, row.photo_file_id)
    return VehicleListItem.model_validate(row).model_copy(
        update={
            "plate_label": plate_label(row),
            "expiry_status": expiry_status(
                row.license_expiry, today=current_day, notify_days=window
            ),
            "days_to_expiry": (row.license_expiry - current_day).days,
            "fines_count": len(row.fines),
            "fines_amount": sum(item.amount for item in row.fines),
            "black_points": sum(item.black_points for item in row.fines),
            "photo_url": _file_url(row.id, photo.id) if photo is not None else None,
        }
    )


def to_read(
    row: Vehicle,
    *,
    today: date | None = None,
    notify_days: int | None = None,
) -> VehicleRead:
    current_day = today or date.today()
    window = _notify_window(row, notify_days)
    item = to_list_item(row, today=current_day, notify_days=window)
    license_file = _vehicle_file(row, row.license_file_id)
    result = VehicleRead.model_validate(
        {
            **item.model_dump(),
            "contract_note_ar": row.contract_note_ar,
            "contract_note_en": row.contract_note_en,
        }
    )
    return result.model_copy(
        update={
            "license_url": (
                _file_url(row.id, license_file.id) if license_file is not None else None
            ),
            "fines": [
                fine_read(fine, vehicle=row)
                for fine in sorted(row.fines, key=lambda item: (item.date, item.id), reverse=True)
            ],
            "renewals": [
                _renewal_read(renewal, vehicle=row)
                for renewal in sorted(
                    row.renewals,
                    key=lambda item: (item.renewed_on, item.id),
                    reverse=True,
                )
            ],
            "accidents": [
                accident_read(accident, vehicle=row)
                for accident in sorted(
                    row.accidents,
                    key=lambda item: (item.date, item.id),
                    reverse=True,
                )
            ],
            "maintenance": [
                maintenance_read(
                    maintenance,
                    vehicle=row,
                    today=current_day,
                    notify_days=window,
                )
                for maintenance in sorted(
                    row.maintenance,
                    key=lambda item: (item.date, item.id),
                    reverse=True,
                )
            ],
            "photos": [
                _file_read(file_row)
                for file_row in sorted(
                    (item for item in row.files if item.kind == "gallery"),
                    key=lambda item: (item.created_at, item.id),
                    reverse=True,
                )
            ],
        }
    )


def site_read(row: VehicleSite) -> VehicleSiteRead:
    return VehicleSiteRead.model_validate(row).model_copy(
        update={"vehicle_count": len(row.vehicles)}
    )


def _list_options() -> tuple[Any, ...]:
    return (
        selectinload(Vehicle.site),
        selectinload(Vehicle.files),
        selectinload(Vehicle.fines).selectinload(VehicleFine.employee),
    )


def _detail_options() -> tuple[Any, ...]:
    return (
        *_list_options(),
        selectinload(Vehicle.renewals),
        selectinload(Vehicle.accidents).selectinload(VehicleAccident.employee),
        selectinload(Vehicle.maintenance),
    )


def list_vehicles(
    db: Session,
    *,
    q: str | None = None,
    site_id: int | None = None,
    expiry: str = "all",
    today: date | None = None,
    notify_days: int | None = None,
) -> list[Vehicle]:
    if expiry not in {"all", "attention", "valid", "due", "expired"}:
        raise ValidationFailedError(
            "VEHICLE_BAD_EXPIRY",
            f"Unknown vehicle expiry filter: {expiry}",
            expiry=expiry,
        )
    stmt = select(Vehicle).options(*_list_options()).execution_options(populate_existing=True)
    if site_id is not None:
        stmt = stmt.where(Vehicle.site_id == site_id)
    rows = list(
        db.execute(
            stmt.order_by(
                Vehicle.site_id.asc(),
                Vehicle.plate_number.asc(),
                Vehicle.id.asc(),
            )
        )
        .scalars()
        .unique()
        .all()
    )
    if q and (needle := q.strip().casefold()):
        rows = [
            row
            for row in rows
            if needle
            in " ".join(
                value
                for value in (
                    plate_label(row),
                    row.plate_code,
                    row.plate_number,
                    row.traffic_code,
                    row.vin,
                    row.type_ar,
                    row.type_en,
                    row.class_ar,
                    row.class_en,
                    row.site.name_ar,
                    row.site.name_en,
                )
                if value
            ).casefold()
        ]
    if expiry != "all":
        current_day = today or date.today()
        window = (
            notify_days if notify_days is not None else settings_service.get_vehicle_notify_days(db)
        )
        filtered_rows: list[Vehicle] = []
        for row in rows:
            state = expiry_status(row.license_expiry, today=current_day, notify_days=window)
            if state == expiry or (expiry == "attention" and state != "valid"):
                filtered_rows.append(row)
        rows = filtered_rows
    return rows


def get_vehicle(db: Session, vehicle_id: int) -> Vehicle:
    row = (
        db.execute(
            select(Vehicle)
            .options(*_detail_options())
            .execution_options(populate_existing=True)
            .where(Vehicle.id == vehicle_id)
        )
        .scalars()
        .unique()
        .one_or_none()
    )
    if row is None:
        raise NotFoundError(
            "VEHICLE_NOT_FOUND",
            f"Vehicle {vehicle_id} does not exist",
            id=vehicle_id,
        )
    return row


def _get_site(db: Session, site_id: int) -> VehicleSite:
    row = db.get(VehicleSite, site_id)
    if row is None:
        raise NotFoundError(
            "VEHICLE_SITE_NOT_FOUND",
            f"Vehicle site {site_id} does not exist",
            id=site_id,
        )
    return row


def _plate_exists(
    db: Session,
    *,
    plate_code: str | None,
    plate_number: str,
    excluding_vehicle_id: int | None = None,
) -> bool:
    code_clause = (
        Vehicle.plate_code.is_(None) if plate_code is None else Vehicle.plate_code == plate_code
    )
    stmt = select(Vehicle.id).where(code_clause, Vehicle.plate_number == plate_number)
    if excluding_vehicle_id is not None:
        stmt = stmt.where(Vehicle.id != excluding_vehicle_id)
    return db.execute(stmt.limit(1)).scalar_one_or_none() is not None


def _raise_plate_exists(plate_code: str | None, plate_number: str) -> None:
    raise ValidationFailedError(
        "PLATE_EXISTS",
        "A vehicle with this plate already exists.",
        plate_code=plate_code,
        plate_number=plate_number,
    )


def _validate_employee(db: Session, employee_id: str | None) -> None:
    if employee_id is not None and db.get(Employee, employee_id) is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id} does not exist",
            employee_id=employee_id,
        )


def _owned_file(
    db: Session,
    vehicle_id: int,
    file_id: int,
    *,
    kind: str | None = None,
) -> VehicleFile:
    row = db.execute(
        select(VehicleFile).where(VehicleFile.id == file_id, VehicleFile.vehicle_id == vehicle_id)
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "VEHICLE_FILE_NOT_FOUND",
            f"File {file_id} does not belong to vehicle {vehicle_id}",
            vehicle_id=vehicle_id,
            file_id=file_id,
        )
    if kind is not None and row.kind != kind:
        raise ValidationFailedError(
            "VEHICLE_FILE_KIND_MISMATCH",
            f"File {file_id} is not a {kind} file.",
            file_id=file_id,
            expected_kind=kind,
            actual_kind=row.kind,
        )
    return row


def create_vehicle(db: Session, payload: VehicleCreate, *, actor: str | None = None) -> Vehicle:
    if _plate_exists(db, plate_code=payload.plate_code, plate_number=payload.plate_number):
        _raise_plate_exists(payload.plate_code, payload.plate_number)

    if payload.new_site is not None:
        site = VehicleSite(
            name_ar=payload.new_site.name_ar,
            name_en=payload.new_site.name_en,
            active=True,
        )
        db.add(site)
        db.flush()
    else:
        assert payload.site_id is not None
        site = _get_site(db, payload.site_id)
        if not site.active:
            raise ValidationFailedError(
                "VEHICLE_SITE_INACTIVE",
                "New vehicles cannot be assigned to an archived site.",
                site_id=site.id,
            )

    row = Vehicle(
        plate_code=payload.plate_code,
        plate_number=payload.plate_number,
        traffic_code=payload.traffic_code,
        type_ar=payload.type_ar,
        type_en=payload.type_en,
        class_ar=payload.class_ar,
        class_en=payload.class_en,
        vin=payload.vin,
        site_id=site.id,
        contract_note_ar=payload.contract_note_ar,
        contract_note_en=payload.contract_note_en,
        license_start=payload.license_start,
        license_expiry=payload.license_expiry,
    )
    db.add(row)
    try:
        db.flush()
        if payload.photo_file_id is not None:
            _owned_file(db, row.id, payload.photo_file_id, kind="photo")
            row.photo_file_id = payload.photo_file_id
        if payload.license_file_id is not None:
            _owned_file(db, row.id, payload.license_file_id, kind="license")
            row.license_file_id = payload.license_file_id
        db.commit()
    except IntegrityError:
        db.rollback()
        _raise_plate_exists(payload.plate_code, payload.plate_number)
    except Exception:
        db.rollback()
        raise
    db.refresh(row)
    if payload.new_site is not None:
        _audit(
            db,
            "site.created",
            site.id,
            actor,
            {"name_ar": site.name_ar, "name_en": site.name_en},
            entity_type="vehicle_site",
        )
    _audit(
        db,
        "vehicle.created",
        row.id,
        actor,
        {
            "plate_code": row.plate_code,
            "plate_number": row.plate_number,
            "site_id": row.site_id,
        },
    )
    return get_vehicle(db, row.id)


def update_vehicle(
    db: Session,
    vehicle_id: int,
    payload: VehicleUpdate,
    *,
    actor: str | None = None,
) -> Vehicle:
    row = get_vehicle(db, vehicle_id)
    data = payload.model_dump(exclude_unset=True)
    audit_payload = payload.model_dump(mode="json", exclude_unset=True)
    required_fields = {
        "plate_number",
        "traffic_code",
        "type_ar",
        "type_en",
        "class_ar",
        "class_en",
        "license_start",
        "license_expiry",
    }
    cleared_required = next(
        (field for field in required_fields if field in data and data[field] is None),
        None,
    )
    if cleared_required is not None:
        raise ValidationFailedError(
            "VEHICLE_REQUIRED_FIELD",
            f"{cleared_required} cannot be null.",
            field=cleared_required,
        )

    if "site_id" in data:
        if data["site_id"] is None:
            raise ValidationFailedError("VEHICLE_SITE_REQUIRED", "A vehicle must belong to a site.")
        site = _get_site(db, data["site_id"])
        if site.id != row.site_id and not site.active:
            raise ValidationFailedError(
                "VEHICLE_SITE_INACTIVE",
                "Vehicles cannot be moved to an archived site.",
                site_id=site.id,
            )

    next_start = data.get("license_start", row.license_start)
    next_expiry = data.get("license_expiry", row.license_expiry)
    if next_expiry <= next_start:
        raise ValidationFailedError(
            "VEHICLE_BAD_LICENSE_DATES",
            "license_expiry must be after license_start.",
        )

    next_code = data.get("plate_code", row.plate_code)
    next_number = data.get("plate_number", row.plate_number)
    if _plate_exists(
        db,
        plate_code=next_code,
        plate_number=next_number,
        excluding_vehicle_id=row.id,
    ):
        _raise_plate_exists(next_code, next_number)

    if "photo_file_id" in data and data["photo_file_id"] is not None:
        _owned_file(db, row.id, data["photo_file_id"], kind="photo")
    if "license_file_id" in data and data["license_file_id"] is not None:
        _owned_file(db, row.id, data["license_file_id"], kind="license")

    for field, value in data.items():
        setattr(row, field, value)
    if "license_start" in data or "license_expiry" in data:
        row.expiry_reminder_sent_for = None
    row.updated_at = _utcnow()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if _plate_exists(
            db,
            plate_code=next_code,
            plate_number=next_number,
            excluding_vehicle_id=row.id,
        ):
            _raise_plate_exists(next_code, next_number)
        raise
    _audit(db, "vehicle.updated", row.id, actor, audit_payload)
    return get_vehicle(db, row.id)


def list_sites(db: Session) -> list[VehicleSite]:
    return list(
        db.execute(
            select(VehicleSite)
            .options(selectinload(VehicleSite.vehicles))
            .execution_options(populate_existing=True)
            .order_by(
                VehicleSite.active.desc(),
                VehicleSite.name_en.asc(),
                VehicleSite.id.asc(),
            )
        )
        .scalars()
        .unique()
        .all()
    )


def create_site(
    db: Session, payload: VehicleSiteCreate, *, actor: str | None = None
) -> VehicleSite:
    row = VehicleSite(name_ar=payload.name_ar, name_en=payload.name_en, active=True)
    db.add(row)
    db.commit()
    db.refresh(row)
    _audit(
        db,
        "site.created",
        row.id,
        actor,
        {"name_ar": row.name_ar, "name_en": row.name_en},
        entity_type="vehicle_site",
    )
    return db.execute(
        select(VehicleSite)
        .options(selectinload(VehicleSite.vehicles))
        .execution_options(populate_existing=True)
        .where(VehicleSite.id == row.id)
    ).scalar_one()


def update_site(
    db: Session,
    site_id: int,
    payload: VehicleSiteUpdate,
    *,
    actor: str | None = None,
) -> VehicleSite:
    row = _get_site(db, site_id)
    data = payload.model_dump(exclude_unset=True)
    for field in ("name_ar", "name_en"):
        if field in data and data[field] is None:
            raise ValidationFailedError(
                "VEHICLE_SITE_NAME_REQUIRED",
                f"{field} cannot be null.",
                field=field,
            )
    if "active" in data and data["active"] is None:
        raise ValidationFailedError(
            "VEHICLE_SITE_ACTIVE_REQUIRED",
            "active cannot be null.",
            field="active",
        )
    if data.get("active") is False:
        vehicle_count = int(
            db.execute(
                select(func.count(Vehicle.id)).where(Vehicle.site_id == site_id)
            ).scalar_one()
        )
        if vehicle_count:
            raise ValidationFailedError(
                "SITE_HAS_VEHICLES",
                "A site with vehicles cannot be archived.",
                site_id=site_id,
                vehicle_count=vehicle_count,
            )
    for field, value in data.items():
        setattr(row, field, value)
    db.commit()
    _audit(
        db,
        "site.updated",
        row.id,
        actor,
        payload.model_dump(mode="json", exclude_unset=True),
        entity_type="vehicle_site",
    )
    return db.execute(
        select(VehicleSite)
        .options(selectinload(VehicleSite.vehicles))
        .execution_options(populate_existing=True)
        .where(VehicleSite.id == site_id)
    ).scalar_one()


def renew_license(
    db: Session,
    vehicle_id: int,
    payload: LicenseRenewCreate,
    *,
    actor: str | None = None,
) -> Vehicle:
    row = get_vehicle(db, vehicle_id)
    if payload.scan_file_id is not None:
        _owned_file(db, row.id, payload.scan_file_id, kind="license")
    renewal = VehicleLicenseRenewal(
        vehicle_id=row.id,
        start=row.license_start,
        expiry=row.license_expiry,
        renewed_on=date.today(),
        cost=payload.cost,
        scan_file_id=row.license_file_id,
    )
    db.add(renewal)
    row.license_start = payload.start
    row.license_expiry = payload.expiry
    if payload.scan_file_id is not None:
        row.license_file_id = payload.scan_file_id
    row.expiry_reminder_sent_for = None
    row.updated_at = _utcnow()
    db.commit()
    _audit(
        db,
        "vehicle.renewed",
        row.id,
        actor,
        {
            "start": payload.start.isoformat(),
            "expiry": payload.expiry.isoformat(),
            "cost": payload.cost,
        },
    )
    return get_vehicle(db, row.id)


def add_fine(
    db: Session,
    vehicle_id: int,
    payload: VehicleFineCreate,
    *,
    actor: str | None = None,
    created_by_user_id: int | None = None,
) -> Vehicle:
    row = get_vehicle(db, vehicle_id)
    _validate_employee(db, payload.employee_id)
    fine = VehicleFine(
        vehicle_id=row.id,
        employee_id=payload.employee_id,
        date=payload.date,
        time=payload.time,
        amount=payload.amount,
        black_points=payload.black_points,
        source="manual",
        location=payload.location,
        description=payload.description,
        created_by_user_id=created_by_user_id,
    )
    db.add(fine)
    db.commit()
    db.refresh(fine)
    _audit(
        db,
        "fine.added",
        row.id,
        actor,
        {"fine_id": fine.id, "amount": fine.amount},
    )
    return get_vehicle(db, row.id)


def _get_fine(db: Session, vehicle_id: int, fine_id: int) -> VehicleFine:
    row = db.execute(
        select(VehicleFine).where(VehicleFine.id == fine_id, VehicleFine.vehicle_id == vehicle_id)
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "VEHICLE_FINE_NOT_FOUND",
            f"Fine {fine_id} does not belong to vehicle {vehicle_id}",
            vehicle_id=vehicle_id,
            fine_id=fine_id,
        )
    return row


def update_fine(
    db: Session,
    vehicle_id: int,
    fine_id: int,
    payload: VehicleFineUpdate,
    *,
    actor: str | None = None,
) -> Vehicle:
    get_vehicle(db, vehicle_id)
    row = _get_fine(db, vehicle_id, fine_id)
    data = payload.model_dump(exclude_unset=True)
    cleared_required = next(
        (
            field
            for field in ("date", "amount", "black_points")
            if field in data and data[field] is None
        ),
        None,
    )
    if cleared_required is not None:
        raise ValidationFailedError(
            "VEHICLE_FINE_REQUIRED_FIELD",
            f"{cleared_required} cannot be null.",
            field=cleared_required,
        )
    if "employee_id" in data:
        _validate_employee(db, data["employee_id"])
    for field, value in data.items():
        setattr(row, field, value)
    row.updated_at = _utcnow()
    db.commit()
    _audit(
        db,
        "fine.updated",
        vehicle_id,
        actor,
        {"fine_id": fine_id, **payload.model_dump(mode="json", exclude_unset=True)},
    )
    return get_vehicle(db, vehicle_id)


def delete_fine(
    db: Session,
    vehicle_id: int,
    fine_id: int,
    *,
    actor: str | None = None,
) -> Vehicle:
    get_vehicle(db, vehicle_id)
    row = _get_fine(db, vehicle_id, fine_id)
    db.delete(row)
    db.commit()
    _audit(db, "fine.deleted", vehicle_id, actor, {"fine_id": fine_id})
    return get_vehicle(db, vehicle_id)


def create_accident(
    db: Session,
    payload: VehicleAccidentCreate,
    *,
    actor: str | None = None,
) -> VehicleAccident:
    vehicle = get_vehicle(db, payload.vehicle_id)
    _validate_employee(db, payload.employee_id)
    for file_id in payload.photo_file_ids:
        _owned_file(db, vehicle.id, file_id, kind="accident")
    row = VehicleAccident(
        vehicle_id=vehicle.id,
        employee_id=payload.employee_id,
        date=payload.date,
        time=payload.time,
        location_ar=payload.location_ar,
        location_en=payload.location_en,
        description_ar=payload.description_ar,
        description_en=payload.description_en,
        police_ref=payload.police_ref,
        damage_cost=payload.damage_cost,
        status="open",
        photo_file_ids=list(payload.photo_file_ids),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _audit(db, "accident.filed", vehicle.id, actor, {"accident_id": row.id})
    return _get_accident(db, vehicle.id, row.id)


def _get_accident(db: Session, vehicle_id: int, accident_id: int) -> VehicleAccident:
    row = (
        db.execute(
            select(VehicleAccident)
            .options(
                selectinload(VehicleAccident.employee),
                selectinload(VehicleAccident.vehicle).selectinload(Vehicle.files),
                selectinload(VehicleAccident.vehicle).selectinload(Vehicle.site),
            )
            .execution_options(populate_existing=True)
            .where(
                VehicleAccident.id == accident_id,
                VehicleAccident.vehicle_id == vehicle_id,
            )
        )
        .scalars()
        .unique()
        .one_or_none()
    )
    if row is None:
        raise NotFoundError(
            "VEHICLE_ACCIDENT_NOT_FOUND",
            f"Accident {accident_id} does not belong to vehicle {vehicle_id}",
            vehicle_id=vehicle_id,
            accident_id=accident_id,
        )
    return row


def set_accident_status(
    db: Session,
    vehicle_id: int,
    accident_id: int,
    status: str,
    *,
    actor: str | None = None,
) -> VehicleAccident:
    get_vehicle(db, vehicle_id)
    row = _get_accident(db, vehicle_id, accident_id)
    if status not in {"open", "closed"}:
        raise ValidationFailedError(
            "VEHICLE_BAD_ACCIDENT_STATUS",
            f"Unknown accident status: {status}",
            status=status,
        )
    row.status = status
    row.updated_at = _utcnow()
    db.commit()
    _audit(
        db,
        "accident.status",
        vehicle_id,
        actor,
        {"accident_id": accident_id, "status": status},
    )
    return _get_accident(db, vehicle_id, accident_id)


def delete_accident(
    db: Session,
    vehicle_id: int,
    accident_id: int,
    *,
    actor: str | None = None,
) -> None:
    get_vehicle(db, vehicle_id)
    row = _get_accident(db, vehicle_id, accident_id)
    db.delete(row)
    db.commit()
    _audit(
        db,
        "accident.deleted",
        vehicle_id,
        actor,
        {"accident_id": accident_id},
    )


def create_maintenance(
    db: Session,
    payload: VehicleMaintenanceCreate,
    *,
    actor: str | None = None,
) -> VehicleMaintenance:
    vehicle = get_vehicle(db, payload.vehicle_id)
    if payload.receipt_file_id is not None:
        _owned_file(db, vehicle.id, payload.receipt_file_id, kind="receipt")
    row = VehicleMaintenance(
        vehicle_id=vehicle.id,
        date=payload.date,
        type=payload.type,
        odometer_km=payload.odometer_km,
        cost=payload.cost,
        vendor_ar=payload.vendor_ar,
        vendor_en=payload.vendor_en,
        next_due=payload.next_due,
        receipt_file_id=payload.receipt_file_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _audit(db, "maintenance.logged", vehicle.id, actor, {"maintenance_id": row.id})
    return _get_maintenance(db, vehicle.id, row.id)


def _get_maintenance(db: Session, vehicle_id: int, maintenance_id: int) -> VehicleMaintenance:
    row = (
        db.execute(
            select(VehicleMaintenance)
            .options(
                selectinload(VehicleMaintenance.vehicle).selectinload(Vehicle.files),
                selectinload(VehicleMaintenance.vehicle).selectinload(Vehicle.site),
            )
            .execution_options(populate_existing=True)
            .where(
                VehicleMaintenance.id == maintenance_id,
                VehicleMaintenance.vehicle_id == vehicle_id,
            )
        )
        .scalars()
        .unique()
        .one_or_none()
    )
    if row is None:
        raise NotFoundError(
            "VEHICLE_MAINTENANCE_NOT_FOUND",
            f"Maintenance row {maintenance_id} does not belong to vehicle {vehicle_id}",
            vehicle_id=vehicle_id,
            maintenance_id=maintenance_id,
        )
    return row


def delete_maintenance(
    db: Session,
    vehicle_id: int,
    maintenance_id: int,
    *,
    actor: str | None = None,
) -> None:
    get_vehicle(db, vehicle_id)
    row = _get_maintenance(db, vehicle_id, maintenance_id)
    db.delete(row)
    db.commit()
    _audit(
        db,
        "maintenance.deleted",
        vehicle_id,
        actor,
        {"maintenance_id": maintenance_id},
    )


def list_fines(
    db: Session,
    *,
    site_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[VehicleFine]:
    stmt = (
        select(VehicleFine)
        .join(VehicleFine.vehicle)
        .options(
            selectinload(VehicleFine.employee),
            selectinload(VehicleFine.vehicle).selectinload(Vehicle.site),
        )
        .execution_options(populate_existing=True)
    )
    if site_id is not None:
        stmt = stmt.where(Vehicle.site_id == site_id)
    if date_from is not None:
        stmt = stmt.where(VehicleFine.date >= date_from)
    if date_to is not None:
        stmt = stmt.where(VehicleFine.date <= date_to)
    return list(
        db.execute(stmt.order_by(VehicleFine.date.desc(), VehicleFine.id.desc()))
        .scalars()
        .unique()
        .all()
    )


def list_accidents(db: Session) -> list[VehicleAccident]:
    return list(
        db.execute(
            select(VehicleAccident)
            .options(
                selectinload(VehicleAccident.employee),
                selectinload(VehicleAccident.vehicle).selectinload(Vehicle.files),
                selectinload(VehicleAccident.vehicle).selectinload(Vehicle.site),
            )
            .execution_options(populate_existing=True)
            .order_by(VehicleAccident.date.desc(), VehicleAccident.id.desc())
        )
        .scalars()
        .unique()
        .all()
    )


def list_maintenance(db: Session) -> list[VehicleMaintenance]:
    return list(
        db.execute(
            select(VehicleMaintenance)
            .options(
                selectinload(VehicleMaintenance.vehicle).selectinload(Vehicle.files),
                selectinload(VehicleMaintenance.vehicle).selectinload(Vehicle.site),
            )
            .execution_options(populate_existing=True)
            .order_by(VehicleMaintenance.date.desc(), VehicleMaintenance.id.desc())
        )
        .scalars()
        .unique()
        .all()
    )


def summary(db: Session) -> VehiclesSummary:
    today = date.today()
    notify_days = settings_service.get_vehicle_notify_days(db)
    vehicles = list(db.execute(select(Vehicle)).scalars().all())
    fines_count, fines_amount, black_points = db.execute(
        select(
            func.count(VehicleFine.id),
            func.coalesce(func.sum(VehicleFine.amount), 0),
            func.coalesce(func.sum(VehicleFine.black_points), 0),
        )
    ).one()
    open_accidents = int(
        db.execute(
            select(func.count(VehicleAccident.id)).where(VehicleAccident.status == "open")
        ).scalar_one()
    )
    maintenance_rows = list(db.execute(select(VehicleMaintenance.next_due)).scalars().all())
    active_sites = int(
        db.execute(
            select(func.count(VehicleSite.id)).where(VehicleSite.active.is_(True))
        ).scalar_one()
    )
    return VehiclesSummary(
        vehicles=len(vehicles),
        fines_count=int(fines_count),
        fines_amount=int(fines_amount),
        black_points=int(black_points),
        license_attention=sum(
            expiry_status(row.license_expiry, today=today, notify_days=notify_days) != "valid"
            for row in vehicles
        ),
        open_accidents=open_accidents,
        maintenance_due=sum(
            due_state(next_due, today=today, notify_days=notify_days) in {"due", "overdue"}
            for next_due in maintenance_rows
        ),
        active_sites=active_sites,
        notify_days=notify_days,
    )


def _safe_filename(filename: str) -> str:
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = _UNSAFE_CHARS.sub("_", name).strip().strip(".")
    return name or "vehicle-file"


def store_file(
    db: Session,
    vehicle_id: int,
    *,
    kind: str,
    filename: str,
    data: bytes,
    media_type: str,
    label_ar: str | None = None,
    label_en: str | None = None,
) -> VehicleFile:
    get_vehicle(db, vehicle_id)
    if kind not in _FILE_KINDS:
        raise ValidationFailedError(
            "VEHICLE_FILE_BAD_KIND",
            f"Unknown vehicle file kind: {kind}",
            kind=kind,
            allowed=sorted(_FILE_KINDS),
        )
    if not data:
        raise ValidationFailedError("VEHICLE_FILE_EMPTY", "Uploaded file is empty.")
    if len(data) > MAX_FILE_BYTES:
        raise ValidationFailedError(
            "VEHICLE_FILE_TOO_LARGE",
            f"File exceeds {MAX_FILE_BYTES // (1024 * 1024)} MiB.",
            size=len(data),
        )
    safe_name = _safe_filename(filename)
    extension = Path(safe_name).suffix.lower()
    if extension not in _ALLOWED_EXTENSIONS:
        raise ValidationFailedError(
            "VEHICLE_FILE_BAD_EXTENSION",
            f"File type {extension!r} is not allowed.",
            allowed=sorted(_ALLOWED_EXTENSIONS),
        )
    if kind in _IMAGE_KINDS and extension not in _IMAGE_EXTENSIONS:
        raise ValidationFailedError(
            "VEHICLE_FILE_IMAGE_REQUIRED",
            f"{kind} files must be images.",
            kind=kind,
        )
    normalized_media = media_type.partition(";")[0].strip().lower()
    if normalized_media not in _ALLOWED_MEDIA_BY_EXTENSION[extension]:
        raise ValidationFailedError(
            "VEHICLE_FILE_MEDIA_MISMATCH",
            "The upload media type does not match its extension.",
            extension=extension,
            media_type=media_type,
        )

    data_dir = get_settings().data_dir.resolve()
    destination_dir = data_dir / "vehicle_files" / str(vehicle_id) / kind
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / f"{uuid.uuid4().hex}-{safe_name}"
    destination.write_bytes(data)
    row = VehicleFile(
        vehicle_id=vehicle_id,
        kind=kind,
        label_ar=label_ar,
        label_en=label_en,
        path=destination.relative_to(data_dir).as_posix(),
        original_name=safe_name,
        media_type=normalized_media,
        size=len(data),
    )
    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise
    db.refresh(row)
    return row


def _resolve_file_path(row: VehicleFile) -> Path:
    data_dir = get_settings().data_dir.resolve()
    path = (data_dir / row.path).resolve()
    if not path.is_relative_to(data_dir):
        raise ValidationFailedError(
            "VEHICLE_FILE_INVALID_PATH",
            "The stored vehicle file path is outside the data directory.",
            file_id=row.id,
        )
    if not path.is_file():
        raise NotFoundError(
            "VEHICLE_FILE_MISSING",
            "The vehicle file is missing on disk.",
            file_id=row.id,
        )
    return path


def resolve_file(db: Session, vehicle_id: int, file_id: int) -> tuple[VehicleFile, Path]:
    get_vehicle(db, vehicle_id)
    row = _owned_file(db, vehicle_id, file_id)
    return row, _resolve_file_path(row)


def delete_file(
    db: Session,
    vehicle_id: int,
    file_id: int,
    *,
    actor: str | None = None,
) -> None:
    get_vehicle(db, vehicle_id)
    row = _owned_file(db, vehicle_id, file_id)
    if row.kind != "gallery":
        raise ValidationFailedError(
            "FILE_NOT_DELETABLE",
            "Only gallery photos can be deleted.",
            file_id=file_id,
            kind=row.kind,
        )
    path = _resolve_file_path(row)
    db.delete(row)
    db.commit()
    try:
        path.unlink(missing_ok=True)
    except OSError:
        log.warning("vehicle file %s could not be removed from disk", path, exc_info=True)
    _audit(db, "file.deleted", vehicle_id, actor, {"file_id": file_id})


def _audit(
    db: Session,
    action: str,
    vehicle_id: int,
    actor: str | None,
    payload: dict[str, Any],
    *,
    entity_type: str = "vehicle",
) -> None:
    entry = AuditLog(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=str(vehicle_id),
        payload=json.dumps(payload),
    )
    db.add(entry)
    db.commit()
