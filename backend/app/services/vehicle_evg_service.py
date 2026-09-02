"""EVG preview matching and atomic vehicle-fine import."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.db.models import User, Vehicle, VehicleFine
from app.schemas.vehicle import (
    EvgConfirmResult,
    EvgConfirmRow,
    EvgPreviewResponse,
    EvgPreviewRow,
    EvgVehicleOption,
)
from app.services.evg_client import fetch_tickets
from app.services.vehicle_service import _audit, get_vehicle, plate_label


def _traffic_codes(
    vehicles: list[Vehicle],
    requested: list[str] | None,
) -> list[str]:
    source = (
        (vehicle.traffic_code for vehicle in vehicles) if requested is None else iter(requested)
    )
    return list(dict.fromkeys(code.strip() for code in source if code.strip()))


def preview(
    db: Session,
    *,
    traffic_codes: list[str] | None,
) -> EvgPreviewResponse:
    """Fetch EVG rows and classify their match against the current fleet."""

    vehicles = list(db.scalars(select(Vehicle).order_by(Vehicle.id)).all())
    codes = _traffic_codes(vehicles, traffic_codes)
    existing_fines = db.scalars(
        select(VehicleFine).where(VehicleFine.evg_ticket_no.is_not(None))
    ).all()
    known = {fine.evg_ticket_no: fine for fine in existing_fines if fine.evg_ticket_no is not None}

    vehicles_by_plate: dict[str, list[Vehicle]] = {}
    for vehicle in vehicles:
        vehicles_by_plate.setdefault(vehicle.plate_number, []).append(vehicle)

    preview_rows: list[EvgPreviewRow] = []
    seen_tickets: set[str] = set()
    for traffic_code in codes:
        fetched = fetch_tickets(
            traffic_code,
            details_for=lambda ticket_no: ticket_no not in known,
        )
        for ticket, details in fetched:
            if ticket.ticket_no in seen_tickets:
                continue
            seen_tickets.add(ticket.ticket_no)

            plate_code = details.plate_code if details is not None else None
            description = " ؛ ".join(details.descriptions) or None if details is not None else None
            time = details.time if details is not None else None
            imported = known.get(ticket.ticket_no)
            if imported is not None:
                match = "already_imported"
                vehicle_id = imported.vehicle_id
            else:
                candidates = list(vehicles_by_plate.get(ticket.plate_number, ()))
                if plate_code is not None:
                    candidates = [
                        vehicle for vehicle in candidates if vehicle.plate_code == plate_code
                    ]
                if len(candidates) == 1:
                    match = "matched"
                    vehicle_id = candidates[0].id
                elif candidates:
                    match = "ambiguous"
                    vehicle_id = None
                else:
                    match = "unmatched"
                    vehicle_id = None

            preview_rows.append(
                EvgPreviewRow(
                    ticket_no=ticket.ticket_no,
                    date=ticket.date,
                    time=time,
                    location=ticket.location,
                    plate_number=ticket.plate_number,
                    plate_code=plate_code,
                    amount=ticket.amount,
                    amount_after_discount=ticket.amount_after_discount,
                    black_points=ticket.black_points,
                    fine_type=ticket.fine_type,
                    description=description,
                    vehicle_id=vehicle_id,
                    match=match,
                )
            )

    return EvgPreviewResponse(
        rows=preview_rows,
        traffic_codes=codes,
        fetched_at=datetime.now(UTC),
        vehicles=[
            EvgVehicleOption(id=vehicle.id, plate_label=plate_label(vehicle))
            for vehicle in vehicles
        ],
    )


def confirm(
    db: Session,
    rows: list[EvgConfirmRow],
    *,
    user: User,
) -> EvgConfirmResult:
    """Atomically import selected preview rows, skipping known ticket numbers."""

    if any(row.vehicle_id is None for row in rows):
        raise ValidationFailedError(
            "EVG_ROW_UNMATCHED",
            "Every EVG row must be matched to a vehicle before import",
        )
    for vehicle_id in sorted({row.vehicle_id for row in rows}):
        get_vehicle(db, vehicle_id)

    ticket_numbers = [row.ticket_no for row in rows]
    known = set(
        db.scalars(
            select(VehicleFine.evg_ticket_no).where(VehicleFine.evg_ticket_no.in_(ticket_numbers))
        ).all()
    )
    created = 0
    skipped = 0
    created_by_vehicle: dict[int, int] = {}
    skipped_by_vehicle: dict[int, int] = {}
    for row in rows:
        if row.ticket_no in known:
            skipped += 1
            skipped_by_vehicle[row.vehicle_id] = skipped_by_vehicle.get(row.vehicle_id, 0) + 1
            continue
        db.add(
            VehicleFine(
                vehicle_id=row.vehicle_id,
                employee_id=None,
                date=row.date,
                time=row.time,
                amount=row.amount,
                amount_after_discount=row.amount_after_discount,
                black_points=row.black_points,
                source="evg",
                evg_ticket_no=row.ticket_no,
                location=row.location,
                description=row.description,
                fine_type=row.fine_type,
                created_by_user_id=user.id,
            )
        )
        known.add(row.ticket_no)
        created += 1
        created_by_vehicle[row.vehicle_id] = created_by_vehicle.get(row.vehicle_id, 0) + 1

    if created:
        db.commit()

    for vehicle_id, vehicle_created in created_by_vehicle.items():
        _audit(
            db,
            "evg.imported",
            vehicle_id,
            user.email,
            {
                "created": vehicle_created,
                "skipped": skipped_by_vehicle.get(vehicle_id, 0),
                "total_created": created,
                "total_skipped": skipped,
            },
        )
    return EvgConfirmResult(created=created, skipped=skipped)
