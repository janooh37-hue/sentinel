"""Fleet vehicle CRUD, files, derived status, and audit writes."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Literal, cast

from sqlalchemy import func, inspect, select, text, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session, selectinload

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.vehicle_certificates import Profile, optimize_certificate
from app.db.models import (
    AuditLog,
    Employee,
    Vehicle,
    VehicleAccident,
    VehicleFile,
    VehicleFine,
    VehicleLicenseRenewal,
    VehicleMaintenance,
    VehiclePhotoAsset,
    VehicleSite,
)
from app.schemas.vehicle import (
    LicenseRenewalRead,
    LicenseRenewCreate,
    VehicleAccidentCreate,
    VehicleAccidentRead,
    VehicleCertificateUpdate,
    VehicleCreate,
    VehicleFileRead,
    VehicleFineCreate,
    VehicleFinePaymentRecord,
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
from app.services import settings_service, vehicle_photo_service
from app.services.workforce_etag import require_if_match, row_etag
from app.services.workforce_schedule_service import acquire_schedule_write_lock

log = logging.getLogger(__name__)

MAX_FILE_BYTES = 25 * 1024 * 1024
_ALLOWED_EXTENSIONS = frozenset({".pdf", ".png", ".jpg", ".jpeg", ".webp"})
_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp"})
_IMAGE_KINDS = frozenset({"photo", "gallery", "accident"})
_PHOTO_KINDS = frozenset({"photo", "gallery"})
_FILE_KINDS = frozenset({"photo", "license", "gallery", "accident", "receipt", "certificate"})
_CERTIFICATE_LABEL_MAX_LENGTH = 128
_CERTIFICATE_PROCESSING_TIMEOUT = 120
_ALLOWED_MEDIA_BY_EXTENSION: dict[str, frozenset[str]] = {
    ".pdf": frozenset({"application/pdf"}),
    ".png": frozenset({"image/png"}),
    ".jpg": frozenset({"image/jpeg", "image/jpg"}),
    ".jpeg": frozenset({"image/jpeg", "image/jpg"}),
    ".webp": frozenset({"image/webp"}),
}
_UNSAFE_CHARS = re.compile('[\\\\/:*?"<>|\x00-\x1f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]')

# Fine receipts use a narrower policy than the generic vehicle-file upload:
# no WebP, a lower size cap, and a magic-byte sniff so a renamed file cannot
# masquerade as one of the three accepted formats.
FINE_RECEIPT_MAX_BYTES = 10 * 1024 * 1024
_FINE_RECEIPT_SIGNATURES: dict[str, bytes] = {
    ".pdf": b"%PDF-",
    ".png": b"\x89PNG\r\n\x1a\n",
    ".jpg": b"\xff\xd8\xff",
    ".jpeg": b"\xff\xd8\xff",
}


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


_FINE_RECEIPT_UNSET = object()


def _fine_etag(row: VehicleFine) -> str:
    return row_etag(
        row,
        extra={
            "payment_status": row.payment_status,
            "receipt_file_id": row.receipt_file_id,
            "archived_at": row.archived_at,
        },
    )


def fine_read(
    row: VehicleFine,
    *,
    vehicle: Vehicle | None = None,
    receipt: VehicleFile | None = _FINE_RECEIPT_UNSET,  # type: ignore[assignment]
) -> VehicleFineRead:
    owner = vehicle or row.vehicle
    employee = row.employee
    resolved_receipt = (
        _vehicle_file(owner, row.receipt_file_id) if receipt is _FINE_RECEIPT_UNSET else receipt
    )
    return VehicleFineRead.model_validate(row).model_copy(
        update={
            "employee_name_ar": employee.name_ar if employee is not None else None,
            "employee_name_en": employee.name_en if employee is not None else None,
            "receipt": _file_read(resolved_receipt) if resolved_receipt is not None else None,
            "version": _fine_etag(row),
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
    photo_urls = vehicle_photo_service.asset_urls(row.photo_asset)
    insurance_status = (
        expiry_status(row.insurance_expiry, today=current_day, notify_days=window)
        if row.insurance_expiry is not None
        else None
    )
    days_to_insurance_expiry = (
        (row.insurance_expiry - current_day).days if row.insurance_expiry is not None else None
    )
    return VehicleListItem.model_validate(row).model_copy(
        update={
            "plate_label": plate_label(row),
            "expiry_status": expiry_status(
                row.license_expiry, today=current_day, notify_days=window
            ),
            "days_to_expiry": (row.license_expiry - current_day).days,
            "fines_count": len(row.fines),
            "fines_amount_fils": sum(item.amount_fils for item in row.fines),
            "black_points": sum(item.black_points for item in row.fines),
            **photo_urls,
            "insurance_status": insurance_status,
            "days_to_insurance_expiry": days_to_insurance_expiry,
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
            "inmate_capacity": row.inmate_capacity,
            "passenger_capacity": row.passenger_capacity,
            "accessories_ar": row.accessories_ar,
            "accessories_en": row.accessories_en,
            "notes_ar": row.notes_ar,
            "notes_en": row.notes_en,
            "photo_asset_id": row.photo_asset_id,
            "license_file_id": row.license_file_id,
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
                    (item for item in row.files if item.kind in {"photo", "gallery"}),
                    key=lambda item: (item.created_at, item.id),
                    reverse=True,
                )
            ],
            "license_files": [
                _file_read(file_row)
                for file_row in sorted(
                    (item for item in row.files if item.kind == "license"),
                    key=lambda item: (item.created_at, item.id),
                    reverse=True,
                )
            ],
            "certificates": [
                _file_read(file_row)
                for file_row in sorted(
                    (item for item in row.files if item.kind == "certificate"),
                    key=lambda item: (item.created_at, item.id),
                    reverse=True,
                )
            ],
        }
    )


def site_read(row: VehicleSite) -> VehicleSiteRead:
    active_count = sum(1 for vehicle in row.vehicles if vehicle.archived_at is None)
    return VehicleSiteRead.model_validate(row).model_copy(update={"vehicle_count": active_count})


def _list_options() -> tuple[Any, ...]:
    return (
        selectinload(Vehicle.site),
        selectinload(Vehicle.files),
        selectinload(Vehicle.photo_asset),
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
    state: Literal["active", "archived"] = "active",
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
    if state == "active":
        stmt = stmt.where(Vehicle.archived_at.is_(None))
    else:
        stmt = stmt.where(Vehicle.archived_at.is_not(None))
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
                    row.make,
                    row.model,
                    row.colour,
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
            row_state = expiry_status(row.license_expiry, today=current_day, notify_days=window)
            if row_state == expiry or (expiry == "attention" and row_state != "valid"):
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


def require_active_vehicle(db: Session, vehicle_id: int) -> Vehicle:
    row = get_vehicle(db, vehicle_id)
    if row.archived_at is not None:
        raise ConflictError(
            "VEHICLE_ARCHIVED",
            f"Vehicle {vehicle_id} is archived.",
            id=vehicle_id,
        )
    return row


def archive_vehicle(db: Session, vehicle_id: int, *, actor: str | None = None) -> Vehicle:
    row = get_vehicle(db, vehicle_id)
    if row.archived_at is not None:
        return row
    row.archived_at = _utcnow()
    row.updated_at = _utcnow()
    _add_audit(db, "vehicle.archived", row.id, actor, {"plate_number": row.plate_number})
    db.commit()
    return get_vehicle(db, row.id)


def restore_vehicle(db: Session, vehicle_id: int, *, actor: str | None = None) -> Vehicle:
    row = get_vehicle(db, vehicle_id)
    if row.archived_at is None:
        return row
    if not row.site.active:
        raise ValidationFailedError(
            "VEHICLE_SITE_INACTIVE",
            "Restoring this vehicle requires reactivating its site first.",
            site_id=row.site_id,
        )
    row.archived_at = None
    row.updated_at = _utcnow()
    _add_audit(db, "vehicle.restored", row.id, actor, {"plate_number": row.plate_number})
    db.commit()
    return get_vehicle(db, row.id)


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


def _create_vehicle_record(db: Session, payload: VehicleCreate) -> Vehicle:
    """Validate, add, and flush a vehicle without owning the transaction."""
    if _plate_exists(db, plate_code=payload.plate_code, plate_number=payload.plate_number):
        _raise_plate_exists(payload.plate_code, payload.plate_number)
    photo_asset_id = None
    if payload.photo_asset_id is not None:
        photo_asset_id = vehicle_photo_service.get_selectable_photo_asset(
            db, payload.photo_asset_id
        ).id

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
        photo_asset_id=photo_asset_id,
        make=payload.make,
        model=payload.model,
        model_year=payload.model_year,
        colour=payload.colour,
        insurance_expiry=payload.insurance_expiry,
        inmate_capacity=payload.inmate_capacity,
        passenger_capacity=payload.passenger_capacity,
        accessories_ar=payload.accessories_ar,
        accessories_en=payload.accessories_en,
        notes_ar=payload.notes_ar,
        notes_en=payload.notes_en,
    )
    db.add(row)
    db.flush()
    if payload.license_file_id is not None:
        _owned_file(db, row.id, payload.license_file_id, kind="license")
        row.license_file_id = payload.license_file_id
    return row


def create_vehicle(db: Session, payload: VehicleCreate, *, actor: str | None = None) -> Vehicle:
    try:
        row = _create_vehicle_record(db, payload)
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
            row.site_id,
            actor,
            {"name_ar": payload.new_site.name_ar, "name_en": payload.new_site.name_en},
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


def _update_vehicle_record(db: Session, row: Vehicle, payload: VehicleUpdate) -> None:
    """Validate and mutate an existing vehicle without owning the transaction."""
    data = payload.model_dump(exclude_unset=True)
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

    if "photo_asset_id" in data and data["photo_asset_id"] is not None:
        data["photo_asset_id"] = vehicle_photo_service.get_selectable_photo_asset(
            db, data["photo_asset_id"]
        ).id
    if "license_file_id" in data and data["license_file_id"] is not None:
        _owned_file(db, row.id, data["license_file_id"], kind="license")

    license_dates_changed = (
        "license_start" in data and data["license_start"] != row.license_start
    ) or ("license_expiry" in data and data["license_expiry"] != row.license_expiry)
    insurance_changed = (
        "insurance_expiry" in data and data["insurance_expiry"] != row.insurance_expiry
    )

    for field, value in data.items():
        setattr(row, field, value)
    if license_dates_changed:
        row.expiry_reminder_sent_for = None
    if insurance_changed:
        row.insurance_reminder_sent_for = None
    row.updated_at = _utcnow()


def update_vehicle(
    db: Session,
    vehicle_id: int,
    payload: VehicleUpdate,
    *,
    actor: str | None = None,
) -> Vehicle:
    row = require_active_vehicle(db, vehicle_id)
    audit_payload = payload.model_dump(mode="json", exclude_unset=True)
    try:
        _update_vehicle_record(db, row, payload)
        db.commit()
    except IntegrityError:
        db.rollback()
        next_code = (
            payload.plate_code if "plate_code" in payload.model_fields_set else row.plate_code
        )
        next_number = (
            payload.plate_number if "plate_number" in payload.model_fields_set else row.plate_number
        )
        if next_number is not None and _plate_exists(
            db,
            plate_code=next_code,
            plate_number=next_number,
            excluding_vehicle_id=row.id,
        ):
            _raise_plate_exists(next_code, next_number)
        raise
    except Exception:
        db.rollback()
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
                select(func.count(Vehicle.id)).where(
                    Vehicle.site_id == site_id, Vehicle.archived_at.is_(None)
                )
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
    row = require_active_vehicle(db, vehicle_id)
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
) -> VehicleFine:
    row = require_active_vehicle(db, vehicle_id)
    _validate_employee(db, payload.employee_id)
    fine = VehicleFine(
        vehicle_id=row.id,
        employee_id=payload.employee_id,
        date=payload.date,
        time=payload.time,
        amount_fils=payload.amount_fils,
        black_points=payload.black_points,
        source="manual",
        location=payload.location,
        description=payload.description,
        payment_status="unpaid",
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
        {"fine_id": fine.id, "amount_fils": fine.amount_fils},
    )
    return fine


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
    if_match: str | None,
    actor: str | None = None,
) -> Vehicle:
    require_active_vehicle(db, vehicle_id)
    row = _get_fine(db, vehicle_id, fine_id)
    if row.archived_at is not None:
        raise ValidationFailedError(
            "VEHICLE_FINE_ARCHIVED",
            "Archived fines cannot be edited; restore it first.",
            fine_id=fine_id,
        )
    require_if_match(if_match, _fine_etag(row), code="VEHICLE_FINE_VERSION_CONFLICT")
    data = payload.model_dump(exclude_unset=True)
    cleared_required = next(
        (
            field
            for field in ("date", "amount_fils", "black_points")
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
    if "payment_status" in data and row.payment_status not in ("unknown", "unpaid"):
        raise ConflictError(
            "VEHICLE_FINE_INVALID_TRANSITION",
            "Only an unknown or unpaid fine can be classified as unpaid.",
            fine_id=fine_id,
            current_status=row.payment_status,
        )
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
    if_match: str | None,
    actor: str | None = None,
) -> Vehicle:
    require_active_vehicle(db, vehicle_id)
    row = _get_fine(db, vehicle_id, fine_id)
    require_if_match(if_match, _fine_etag(row), code="VEHICLE_FINE_VERSION_CONFLICT")
    receipt = (
        _owned_file(db, vehicle_id, row.receipt_file_id, kind="receipt")
        if row.receipt_file_id is not None
        else None
    )
    receipt_path = _resolve_file_path(receipt) if receipt is not None else None
    db.delete(row)
    if receipt is not None:
        db.delete(receipt)
    db.commit()
    if receipt_path is not None:
        try:
            receipt_path.unlink(missing_ok=True)
        except OSError:
            log.warning(
                "vehicle fine receipt %s could not be removed from disk",
                receipt_path,
                exc_info=True,
            )
    _audit(db, "fine.deleted", vehicle_id, actor, {"fine_id": fine_id})
    return get_vehicle(db, vehicle_id)


def _validate_fine_receipt(*, filename: str, data: bytes, media_type: str) -> None:
    if not data:
        raise ValidationFailedError("VEHICLE_FINE_RECEIPT_EMPTY", "Uploaded receipt is empty.")
    if len(data) > FINE_RECEIPT_MAX_BYTES:
        raise ValidationFailedError(
            "VEHICLE_FINE_RECEIPT_TOO_LARGE",
            f"Receipt exceeds {FINE_RECEIPT_MAX_BYTES // (1024 * 1024)} MiB.",
            size=len(data),
        )
    safe_name = _safe_filename(filename)
    extension = Path(safe_name).suffix.lower()
    signature = _FINE_RECEIPT_SIGNATURES.get(extension)
    normalized_media = media_type.partition(";")[0].strip().lower()
    allowed_media = _ALLOWED_MEDIA_BY_EXTENSION.get(extension, frozenset())
    if signature is None or not data.startswith(signature) or normalized_media not in allowed_media:
        raise ValidationFailedError(
            "VEHICLE_FINE_RECEIPT_BAD_FORMAT",
            "Receipts must be a PDF, PNG, or JPEG file.",
            extension=extension,
            media_type=media_type,
        )


def record_payment(
    db: Session,
    vehicle_id: int,
    fine_id: int,
    *,
    if_match: str | None,
    filename: str | None,
    data: bytes | None,
    media_type: str | None,
    actor: str | None = None,
) -> VehicleFine:
    """Atomically mark an unknown/unpaid fine paid, with an optional receipt."""
    require_active_vehicle(db, vehicle_id)
    acquire_schedule_write_lock(db)
    row = _get_fine(db, vehicle_id, fine_id)
    if row.archived_at is not None:
        raise ValidationFailedError(
            "VEHICLE_FINE_ARCHIVED",
            "Archived fines cannot be edited; restore it first.",
            fine_id=fine_id,
        )
    require_if_match(if_match, _fine_etag(row), code="VEHICLE_FINE_VERSION_CONFLICT")
    if row.payment_status == "paid":
        raise ConflictError(
            "VEHICLE_FINE_ALREADY_PAID", "This fine is already marked paid.", fine_id=fine_id
        )

    receipt_file: VehicleFile | None = None
    destination: Path | None = None
    if data:
        _validate_fine_receipt(filename=filename or "", data=data, media_type=media_type or "")
        receipt_file, destination = _store_file_record(
            db,
            vehicle_id,
            kind="receipt",
            filename=filename or "receipt",
            data=data,
            media_type=media_type or "",
        )
    try:
        row.payment_status = "paid"
        if receipt_file is not None:
            row.receipt_file_id = receipt_file.id
        row.updated_at = _utcnow()
        db.commit()
    except Exception:
        db.rollback()
        if destination is not None:
            destination.unlink(missing_ok=True)
        raise
    db.refresh(row)
    _audit(
        db,
        "fine.payment.recorded",
        vehicle_id,
        actor,
        {
            "fine_id": fine_id,
            "amount_fils": row.amount_fils,
            "receipt_attached": receipt_file is not None,
        },
    )
    return row


def attach_receipt(
    db: Session,
    vehicle_id: int,
    fine_id: int,
    *,
    if_match: str | None,
    filename: str,
    data: bytes,
    media_type: str,
    actor: str | None = None,
) -> VehicleFine:
    """Attach a receipt to an already-paid fine that has none yet."""
    require_active_vehicle(db, vehicle_id)
    acquire_schedule_write_lock(db)
    row = _get_fine(db, vehicle_id, fine_id)
    if row.archived_at is not None:
        raise ValidationFailedError(
            "VEHICLE_FINE_ARCHIVED",
            "Archived fines cannot be edited; restore it first.",
            fine_id=fine_id,
        )
    require_if_match(if_match, _fine_etag(row), code="VEHICLE_FINE_VERSION_CONFLICT")
    if row.payment_status != "paid":
        raise ConflictError(
            "VEHICLE_FINE_RECEIPT_REQUIRES_PAID",
            "Only a paid fine can receive a receipt.",
            fine_id=fine_id,
        )
    if row.receipt_file_id is not None:
        raise ConflictError(
            "VEHICLE_FINE_RECEIPT_ALREADY_ATTACHED",
            "This fine already has a receipt.",
            fine_id=fine_id,
        )
    _validate_fine_receipt(filename=filename, data=data, media_type=media_type)
    receipt_file, destination = _store_file_record(
        db, vehicle_id, kind="receipt", filename=filename, data=data, media_type=media_type
    )
    try:
        row.receipt_file_id = receipt_file.id
        row.updated_at = _utcnow()
        db.commit()
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise
    db.refresh(row)
    _audit(
        db,
        "fine.receipt.attached",
        vehicle_id,
        actor,
        {"fine_id": fine_id, "file_id": receipt_file.id},
    )
    return row


def get_files_by_id(db: Session, file_ids: set[int]) -> dict[int, VehicleFile]:
    """One bounded lookup for the fleet ledger's receipt column."""
    if not file_ids:
        return {}
    rows = db.scalars(select(VehicleFile).where(VehicleFile.id.in_(file_ids))).all()
    return {row.id: row for row in rows}


def _load_fine_batch(
    db: Session, rows: list[VehicleFinePaymentRecord]
) -> list[tuple[VehicleFine, str]]:
    ids = [item.id for item in rows]
    found = {
        fine.id: fine
        for fine in db.scalars(select(VehicleFine).where(VehicleFine.id.in_(ids))).all()
    }
    missing = [fine_id for fine_id in ids if fine_id not in found]
    if missing:
        raise NotFoundError(
            "VEHICLE_FINE_NOT_FOUND", "One or more fines were not found.", fine_ids=missing
        )
    return [(found[item.id], item.version) for item in rows]


def archive_fines(
    db: Session, rows: list[VehicleFinePaymentRecord], *, actor: str | None = None
) -> int:
    """Archive paid, active fines. Validates the whole batch before mutating any row."""
    acquire_schedule_write_lock(db)
    fines = _load_fine_batch(db, rows)
    for vehicle_id in {fine.vehicle_id for fine, _ in fines}:
        require_active_vehicle(db, vehicle_id)
    for fine, expected_version in fines:
        require_if_match(expected_version, _fine_etag(fine), code="VEHICLE_FINE_VERSION_CONFLICT")
        if fine.payment_status != "paid" or fine.archived_at is not None:
            raise ConflictError(
                "VEHICLE_FINE_ARCHIVE_STATE_MISMATCH",
                "Only a paid, active fine can be archived.",
                fine_id=fine.id,
                payment_status=fine.payment_status,
            )
    now = _utcnow()
    by_vehicle: dict[int, list[int]] = {}
    for fine, _version in fines:
        fine.archived_at = now
        fine.updated_at = now
        by_vehicle.setdefault(fine.vehicle_id, []).append(fine.id)
    if fines:
        db.commit()
    for vehicle_id, ids in by_vehicle.items():
        _audit(db, "fine.archived", vehicle_id, actor, {"count": len(ids), "fine_ids": ids})
    return len(fines)


def restore_fines(
    db: Session, rows: list[VehicleFinePaymentRecord], *, actor: str | None = None
) -> int:
    """Restore archived fines. Validates the whole batch before mutating any row."""
    acquire_schedule_write_lock(db)
    fines = _load_fine_batch(db, rows)
    for vehicle_id in {fine.vehicle_id for fine, _ in fines}:
        require_active_vehicle(db, vehicle_id)
    for fine, expected_version in fines:
        require_if_match(expected_version, _fine_etag(fine), code="VEHICLE_FINE_VERSION_CONFLICT")
        if fine.archived_at is None:
            raise ConflictError(
                "VEHICLE_FINE_ARCHIVE_STATE_MISMATCH",
                "Only an archived fine can be restored.",
                fine_id=fine.id,
            )
    now = _utcnow()
    by_vehicle: dict[int, list[int]] = {}
    for fine, _version in fines:
        fine.archived_at = None
        fine.updated_at = now
        by_vehicle.setdefault(fine.vehicle_id, []).append(fine.id)
    if fines:
        db.commit()
    for vehicle_id, ids in by_vehicle.items():
        _audit(db, "fine.restored", vehicle_id, actor, {"count": len(ids), "fine_ids": ids})
    return len(fines)


def create_accident(
    db: Session,
    payload: VehicleAccidentCreate,
    *,
    actor: str | None = None,
) -> VehicleAccident:
    vehicle = require_active_vehicle(db, payload.vehicle_id)
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
    require_active_vehicle(db, vehicle_id)
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
    require_active_vehicle(db, vehicle_id)
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
    vehicle = require_active_vehicle(db, payload.vehicle_id)
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
    require_active_vehicle(db, vehicle_id)
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
        .where(Vehicle.archived_at.is_(None))
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
            .join(VehicleAccident.vehicle)
            .options(
                selectinload(VehicleAccident.employee),
                selectinload(VehicleAccident.vehicle).selectinload(Vehicle.files),
                selectinload(VehicleAccident.vehicle).selectinload(Vehicle.site),
            )
            .execution_options(populate_existing=True)
            .where(Vehicle.archived_at.is_(None))
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
            .join(VehicleMaintenance.vehicle)
            .options(
                selectinload(VehicleMaintenance.vehicle).selectinload(Vehicle.files),
                selectinload(VehicleMaintenance.vehicle).selectinload(Vehicle.site),
            )
            .execution_options(populate_existing=True)
            .where(Vehicle.archived_at.is_(None))
            .order_by(VehicleMaintenance.date.desc(), VehicleMaintenance.id.desc())
        )
        .scalars()
        .unique()
        .all()
    )


def summary(db: Session) -> VehiclesSummary:
    today = date.today()
    notify_days = settings_service.get_vehicle_notify_days(db)
    vehicles = list(
        db.execute(select(Vehicle).where(Vehicle.archived_at.is_(None))).scalars().all()
    )
    fines_count, fines_amount_fils, black_points = db.execute(
        select(
            func.count(VehicleFine.id),
            func.coalesce(func.sum(VehicleFine.amount_fils), 0),
            func.coalesce(func.sum(VehicleFine.black_points), 0),
        )
        .join(VehicleFine.vehicle)
        .where(Vehicle.archived_at.is_(None))
    ).one()
    open_accidents = int(
        db.execute(
            select(func.count(VehicleAccident.id))
            .join(VehicleAccident.vehicle)
            .where(VehicleAccident.status == "open", Vehicle.archived_at.is_(None))
        ).scalar_one()
    )
    maintenance_rows = list(
        db.execute(
            select(VehicleMaintenance.next_due)
            .join(VehicleMaintenance.vehicle)
            .where(Vehicle.archived_at.is_(None))
        )
        .scalars()
        .all()
    )
    active_sites = int(
        db.execute(
            select(func.count(VehicleSite.id)).where(VehicleSite.active.is_(True))
        ).scalar_one()
    )
    return VehiclesSummary(
        vehicles=len(vehicles),
        fines_count=int(fines_count),
        fines_amount_fils=int(fines_amount_fils),
        black_points=int(black_points),
        license_attention=sum(
            expiry_status(row.license_expiry, today=today, notify_days=notify_days) != "valid"
            for row in vehicles
        ),
        insurance_attention=sum(
            row.insurance_expiry is not None
            and expiry_status(row.insurance_expiry, today=today, notify_days=notify_days) != "valid"
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


def _validate_upload(
    kind: str, filename: str, data: bytes, media_type: str
) -> tuple[str, str, str]:
    """Validate kind/size/extension/media-type; return (safe_name, extension, normalized_media).

    Runs before any decoding — including certificate compression — so a
    malformed upload never reaches the optimizer.
    """
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
    return safe_name, extension, normalized_media


def _prepare_file_record(
    db: Session,
    vehicle_id: int,
    *,
    kind: str,
    filename: str,
    data: bytes,
    media_type: str,
    label_ar: str | None = None,
    label_en: str | None = None,
    expiry_date: date | None = None,
) -> tuple[VehicleFile, Path]:
    """Validate and write a file to disk, without touching the session.

    Returns a transient (unpersisted) ``VehicleFile`` and the path its bytes
    were written to. Splitting this out of ``_store_file_record`` lets the
    certificate replacement flow prepare two files' bytes on disk — the new
    upload and, when replacing, a recompressed predecessor — before either
    takes a database write lock (see ``store_file``).
    """
    require_active_vehicle(db, vehicle_id)
    safe_name, _extension, normalized_media = _validate_upload(kind, filename, data, media_type)

    data_dir = get_settings().data_dir.resolve()
    destination_dir = data_dir / "vehicle_files" / str(vehicle_id) / kind
    destination = destination_dir / f"{uuid.uuid4().hex}-{safe_name}"
    try:
        destination_dir.mkdir(parents=True, exist_ok=True)
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
            expiry_date=expiry_date,
        )
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return row, destination


def _store_file_record(
    db: Session,
    vehicle_id: int,
    *,
    kind: str,
    filename: str,
    data: bytes,
    media_type: str,
    label_ar: str | None = None,
    label_en: str | None = None,
    expiry_date: date | None = None,
) -> tuple[VehicleFile, Path]:
    """Prepare, add, and flush a vehicle file without owning the transaction."""
    row, destination = _prepare_file_record(
        db,
        vehicle_id,
        kind=kind,
        filename=filename,
        data=data,
        media_type=media_type,
        label_ar=label_ar,
        label_en=label_en,
        expiry_date=expiry_date,
    )
    try:
        db.add(row)
        db.flush()
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return row, destination


def _optimize_certificate_worker(data: bytes, media_type: str, profile: str) -> bytes:
    """Top-level so ``ProcessPoolExecutor`` can pickle it for submission —
    matches ``_pdf_executor._convert_in_subprocess``'s convention."""
    return optimize_certificate(data, media_type, profile=cast("Profile", profile))


def _optimize_certificate(data: bytes, media_type: str, *, profile: Profile = "current") -> bytes:
    """Compress a certificate's bytes in the shared single-worker process pool.

    Native PyMuPDF/Pillow work never runs on the event loop or shares a
    process with Word COM. A worker ``ValueError`` (see
    ``app.core.vehicle_certificates``) carries a ``VEHICLE_CERTIFICATE_*``
    code and is translated to ``ValidationFailedError``; a timeout or any
    other worker failure becomes ``VEHICLE_CERTIFICATE_PROCESSING_FAILED`` —
    no file is created and the client can retry explicitly.
    """
    from app.services._pdf_executor import get_executor

    future = get_executor().submit(_optimize_certificate_worker, data, media_type, profile)
    try:
        return future.result(timeout=_CERTIFICATE_PROCESSING_TIMEOUT)
    except ValueError as exc:
        code = exc.args[0] if exc.args else "VEHICLE_CERTIFICATE_INVALID"
        raise ValidationFailedError(code, str(exc) or code) from exc
    except Exception as exc:
        raise ValidationFailedError(
            "VEHICLE_CERTIFICATE_PROCESSING_FAILED",
            "The certificate could not be processed. Try uploading it again.",
        ) from exc


def _certificate_expiry_date(expiry_date: date | None, no_expiry: bool) -> date | None:
    """Require exactly one of a date or the explicit No-expiry choice."""
    if expiry_date is not None and no_expiry:
        raise ValidationFailedError(
            "VEHICLE_CERTIFICATE_EXPIRY_CONFLICT",
            "Choose an expiry date or No expiry, not both.",
        )
    if expiry_date is None and not no_expiry:
        raise ValidationFailedError(
            "VEHICLE_CERTIFICATE_EXPIRY_REQUIRED",
            "Enter an expiry date or select No expiry.",
        )
    return expiry_date


def _validate_certificate_scope(
    kind: str,
    expiry_date: date | None,
    no_expiry: bool,
    replaces_file_id: int | None,
) -> None:
    """Certificate-only inputs on any other kind are a caller error, not a
    silently ignored field — omitted defaults leave every other kind's
    upload behavior unchanged."""
    if kind == "certificate":
        return
    if expiry_date is not None or no_expiry or replaces_file_id is not None:
        raise ValidationFailedError(
            "VEHICLE_CERTIFICATE_REQUIRED",
            "This action is only available for certificate files.",
            kind=kind,
        )


def _validate_certificate_label(label: str | None) -> str | None:
    if label is None:
        return None
    trimmed = label.strip()
    if not trimmed:
        return None
    if len(trimmed) > _CERTIFICATE_LABEL_MAX_LENGTH:
        raise ValidationFailedError(
            "VEHICLE_CERTIFICATE_LABEL_TOO_LONG",
            f"Document names must be {_CERTIFICATE_LABEL_MAX_LENGTH} characters or fewer.",
            max_length=_CERTIFICATE_LABEL_MAX_LENGTH,
        )
    return trimmed


def _certificate_predecessor(db: Session, vehicle_id: int, replaces_file_id: int) -> VehicleFile:
    row = _owned_file(db, vehicle_id, replaces_file_id)
    if row.kind != "certificate":
        raise ValidationFailedError(
            "VEHICLE_CERTIFICATE_REQUIRED",
            "This action is only available for certificate files.",
            file_id=replaces_file_id,
        )
    if row.superseded_by_file_id is not None:
        raise ConflictError(
            "VEHICLE_CERTIFICATE_REPLACED",
            "This certificate already has a replacement.",
            file_id=replaces_file_id,
        )
    return row


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
    expiry_date: date | None = None,
    no_expiry: bool = False,
    replaces_file_id: int | None = None,
    actor: str | None = None,
) -> VehicleFile:
    is_certificate = kind == "certificate"
    _validate_certificate_scope(kind, expiry_date, no_expiry, replaces_file_id)

    effective_expiry: date | None = None
    effective_label_ar, effective_label_en = label_ar, label_en
    if is_certificate:
        effective_expiry = _certificate_expiry_date(expiry_date, no_expiry)
        effective_label_ar = _validate_certificate_label(label_ar)
        effective_label_en = _validate_certificate_label(label_en)

    predecessor: VehicleFile | None = None
    if is_certificate and replaces_file_id is not None:
        predecessor = _certificate_predecessor(db, vehicle_id, replaces_file_id)

    processed_data = data
    if is_certificate:
        _safe_name, _extension, normalized_media = _validate_upload(
            kind, filename, data, media_type
        )
        processed_data = _optimize_certificate(data, normalized_media, profile="current")

    path: Path | None = None
    historical_path: Path | None = None
    predecessor_path: Path | None = None
    try:
        row, path = _prepare_file_record(
            db,
            vehicle_id,
            kind=kind,
            filename=filename,
            data=processed_data,
            media_type=media_type,
            label_ar=effective_label_ar,
            label_en=effective_label_en,
            expiry_date=effective_expiry,
        )

        historical_candidate: bytes | None = None
        if predecessor is not None:
            predecessor_path = _resolve_file_path(predecessor)
            predecessor_bytes = predecessor_path.read_bytes()
            candidate = _optimize_certificate(
                predecessor_bytes, predecessor.media_type, profile="historical"
            )
            if len(candidate) < len(predecessor_bytes):
                historical_candidate = candidate

        db.add(row)
        db.flush()

        if predecessor is not None:
            # Recheck the vehicle is still active right before publication —
            # an archive mid-upload must reject the replacement.
            require_active_vehicle(db, vehicle_id)
            update_values: dict[str, Any] = {
                "is_historical": True,
                "superseded_by_file_id": row.id,
            }
            if historical_candidate is not None:
                data_dir = get_settings().data_dir.resolve()
                destination_dir = data_dir / "vehicle_files" / str(vehicle_id) / "certificate"
                destination_dir.mkdir(parents=True, exist_ok=True)
                new_path = destination_dir / f"{uuid.uuid4().hex}-{predecessor.original_name}"
                new_path.write_bytes(historical_candidate)
                historical_path = new_path
                update_values["path"] = new_path.relative_to(data_dir).as_posix()
                update_values["size"] = len(historical_candidate)

            # An UPDATE without RETURNING produces CursorResult, including its rowcount.
            result = cast(
                CursorResult[Any],
                db.execute(
                    update(VehicleFile)
                    .where(
                        VehicleFile.id == predecessor.id,
                        VehicleFile.vehicle_id == vehicle_id,
                        VehicleFile.kind == "certificate",
                        VehicleFile.superseded_by_file_id.is_(None),
                        VehicleFile.path == predecessor.path,
                    )
                    .values(**update_values)
                ),
            )
            if result.rowcount != 1:
                raise ConflictError(
                    "VEHICLE_CERTIFICATE_REPLACED",
                    "This certificate already has a replacement.",
                    file_id=predecessor.id,
                )
            _add_audit(
                db,
                "certificate.replaced",
                vehicle_id,
                actor,
                {
                    "old_file_id": predecessor.id,
                    "new_file_id": row.id,
                    "old_size": predecessor.size,
                    "stored_size": update_values.get("size", predecessor.size),
                },
            )

        db.commit()
    except Exception:
        db.rollback()
        if path is not None:
            path.unlink(missing_ok=True)
        if historical_path is not None:
            historical_path.unlink(missing_ok=True)
        raise
    db.refresh(row)

    if predecessor is not None and historical_path is not None and predecessor_path is not None:
        # Only after commit: the superseded pre-compression bytes are no
        # longer reachable through any row, so the disk copy can go too.
        try:
            predecessor_path.unlink(missing_ok=True)
        except OSError:
            log.warning(
                "vehicle certificate %s predecessor could not be removed",
                predecessor.id,
                exc_info=True,
            )
    return row


def update_certificate(
    db: Session,
    vehicle_id: int,
    file_id: int,
    payload: VehicleCertificateUpdate,
    *,
    actor: str | None = None,
) -> VehicleFile:
    require_active_vehicle(db, vehicle_id)
    row = _owned_file(db, vehicle_id, file_id, kind="certificate")

    fields_set = payload.model_fields_set
    touches_expiry = "expiry_date" in fields_set or "no_expiry" in fields_set
    touches_history = "is_historical" in fields_set
    if not touches_expiry and not touches_history:
        raise ValidationFailedError(
            "VEHICLE_CERTIFICATE_EMPTY_UPDATE",
            "Choose an expiry or history change to save.",
        )

    def _snapshot() -> dict[str, Any]:
        return {
            "expiry_date": row.expiry_date.isoformat() if row.expiry_date else None,
            "is_historical": row.is_historical,
        }

    before = _snapshot()

    if touches_expiry:
        new_expiry = _certificate_expiry_date(payload.expiry_date, payload.no_expiry)
        if new_expiry != row.expiry_date:
            row.expiry_reminder_sent_for = None
        row.expiry_date = new_expiry

    if touches_history:
        if payload.is_historical:
            row.is_historical = True
        elif row.superseded_by_file_id is not None:
            raise ConflictError(
                "VEHICLE_CERTIFICATE_HAS_REPLACEMENT",
                "This historical certificate has a newer replacement and cannot be made current.",
                file_id=file_id,
            )
        else:
            row.is_historical = False

    after = _snapshot()
    if before != after:
        _add_audit(
            db,
            "certificate.updated",
            vehicle_id,
            actor,
            {"file_id": file_id, "before": before, "after": after},
        )
    db.commit()
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
    vehicle = require_active_vehicle(db, vehicle_id)
    row = _owned_file(db, vehicle_id, file_id)
    if row.kind not in _PHOTO_KINDS and row.kind != "certificate":
        raise ValidationFailedError(
            "FILE_NOT_DELETABLE",
            "Only photo, gallery, and certificate files can be deleted.",
            file_id=file_id,
            kind=row.kind,
        )
    legacy_asset_id = db.scalar(
        select(VehiclePhotoAsset.id).where(VehiclePhotoAsset.legacy_file_id == file_id)
    )
    legacy_vehicle_id = (
        db.scalar(
            text(
                """
                SELECT vehicle_id
                FROM vehicle_photo_legacy_assignments
                WHERE photo_file_id = :file_id
                ORDER BY vehicle_id
                LIMIT 1
                """
            ),
            {"file_id": file_id},
        )
        if inspect(db.get_bind()).has_table("vehicle_photo_legacy_assignments")
        else None
    )
    if legacy_asset_id is not None or legacy_vehicle_id is not None:
        raise ConflictError(
            "VEHICLE_FILE_IN_USE",
            "The file is retained as a migrated vehicle-photo recovery source.",
            file_id=file_id,
            photo_asset_id=legacy_asset_id,
            legacy_vehicle_id=legacy_vehicle_id,
        )
    blocking_accident_id = min(
        (accident.id for accident in vehicle.accidents if file_id in accident.photo_file_ids),
        default=None,
    )
    if blocking_accident_id is not None:
        raise ConflictError(
            "VEHICLE_FILE_IN_USE",
            "The file is referenced by a vehicle accident.",
            file_id=file_id,
            accident_id=blocking_accident_id,
        )
    if row.kind == "certificate":
        db.execute(
            update(VehicleFile)
            .where(
                VehicleFile.vehicle_id == vehicle_id, VehicleFile.superseded_by_file_id == file_id
            )
            .values(superseded_by_file_id=None)
        )
    path = _resolve_file_path(row)
    db.delete(row)
    db.commit()
    try:
        path.unlink(missing_ok=True)
    except OSError:
        log.warning("vehicle file %s could not be removed from disk", path, exc_info=True)
    _audit(db, "file.deleted", vehicle_id, actor, {"file_id": file_id})


def _add_audit(
    db: Session,
    action: str,
    vehicle_id: int,
    actor: str | None,
    payload: dict[str, Any],
    *,
    entity_type: str = "vehicle",
) -> None:
    """Add an audit entry without owning the caller's transaction."""
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            entity_type=entity_type,
            entity_id=str(vehicle_id),
            payload=json.dumps(payload),
        )
    )


def _audit(
    db: Session,
    action: str,
    vehicle_id: int,
    actor: str | None,
    payload: dict[str, Any],
    *,
    entity_type: str = "vehicle",
) -> None:
    _add_audit(
        db,
        action,
        vehicle_id,
        actor,
        payload,
        entity_type=entity_type,
    )
    db.commit()
