"""Daily Web Push reminders for vehicle licences and maintenance."""

from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import User, Vehicle, VehicleMaintenance
from app.services import perm_service, push_service, settings_service, vehicle_service

log = logging.getLogger(__name__)

_TITLE = "GSSG Manager"


def _isolate(value: str) -> str:
    """Keep an unknown-direction fragment from reordering adjacent RTL text."""
    return f"\u2068{value}\u2069"


def recipients(db: Session) -> list[User]:
    """Return active users currently allowed to view the vehicles module."""
    active_users = list(db.scalars(select(User).where(User.status == "active").order_by(User.id)))
    return [user for user in active_users if perm_service.has_capability(db, user, "vehicles.view")]


def _send_to_recipients(
    db: Session,
    recipient_ids: list[int],
    messages: dict[str, tuple[str, str]],
    url: str,
) -> int:
    sent = 0
    for user_id in recipient_ids:
        try:
            push_service.send_to_user(db, user_id, messages, url)
        except Exception:
            db.rollback()
            log.exception("vehicle reminders: push failed for user %s", user_id)
            continue
        sent += 1
    return sent


def _license_messages(vehicle: Vehicle, state: str) -> dict[str, tuple[str, str]]:
    plate = vehicle_service.plate_label(vehicle)
    expiry = vehicle.license_expiry.strftime("%d/%m/%Y")
    if state == "expired":
        en_heading = "License expired"
        en_detail = f"{plate} · {vehicle.type_en} expired on {expiry}"
        ar_heading = "انتهى الترخيص"
        ar_detail = f"{_isolate(plate)} · {vehicle.type_ar} انتهى في {expiry}"
    else:
        en_heading = "License expiring"
        en_detail = f"{plate} · {vehicle.type_en} expires on {expiry}"
        ar_heading = "ترخيص على وشك الانتهاء"
        ar_detail = f"{_isolate(plate)} · {vehicle.type_ar} ينتهي في {expiry}"
    return {
        "en": (_TITLE, f"{en_heading}\n{en_detail}"),
        "ar": (_TITLE, f"{ar_heading}\n{ar_detail}"),
    }


def _maintenance_messages(
    maintenance: VehicleMaintenance,
    state: str,
) -> dict[str, tuple[str, str]]:
    vehicle = maintenance.vehicle
    plate = vehicle_service.plate_label(vehicle)
    next_due = maintenance.next_due
    if next_due is None:  # Guarded by the caller; keeps message construction total.
        raise ValueError("maintenance reminder requires next_due")
    due_date = next_due.strftime("%d/%m/%Y")
    if state == "overdue":
        en_heading = "Maintenance overdue"
        en_detail = f"{plate} · {vehicle.type_en} overdue since {due_date}"
        ar_heading = "الصيانة متأخرة"
        ar_detail = f"{_isolate(plate)} · {vehicle.type_ar} متأخرة منذ {due_date}"
    else:
        en_heading = "Maintenance due"
        en_detail = f"{plate} · {vehicle.type_en} due on {due_date}"
        ar_heading = "موعد صيانة"
        ar_detail = f"{_isolate(plate)} · {vehicle.type_ar} موعدها في {due_date}"
    return {
        "en": (_TITLE, f"{en_heading}\n{en_detail}"),
        "ar": (_TITLE, f"{ar_heading}\n{ar_detail}"),
    }


def send_due_reminders(db: Session, *, today: date) -> int:
    """Send all due vehicle reminders and return successful recipient sends."""
    notify_days = settings_service.get_vehicle_notify_days(db)
    recipient_ids = [user.id for user in recipients(db)]
    sent = 0

    vehicles = list(db.scalars(select(Vehicle).order_by(Vehicle.id)))
    for vehicle in vehicles:
        state = vehicle_service.expiry_status(
            vehicle.license_expiry,
            today=today,
            notify_days=notify_days,
        )
        if state == "valid" or vehicle.expiry_reminder_sent_for == vehicle.license_expiry:
            continue
        delivered = _send_to_recipients(
            db,
            recipient_ids,
            _license_messages(vehicle, state),
            f"/vehicles/{vehicle.id}",
        )
        sent += delivered
        if delivered:
            vehicle.expiry_reminder_sent_for = vehicle.license_expiry
            db.commit()

    maintenance_rows = list(
        db.scalars(
            select(VehicleMaintenance)
            .where(VehicleMaintenance.next_due.is_not(None))
            .options(selectinload(VehicleMaintenance.vehicle))
            .order_by(VehicleMaintenance.id)
        )
    )
    for maintenance in maintenance_rows:
        next_due = maintenance.next_due
        if next_due is None:
            continue
        maintenance_state = vehicle_service.due_state(
            next_due,
            today=today,
            notify_days=notify_days,
        )
        if maintenance_state not in {"due", "overdue"}:
            continue
        if maintenance.reminder_sent_for == next_due:
            continue
        delivered = _send_to_recipients(
            db,
            recipient_ids,
            _maintenance_messages(maintenance, maintenance_state),
            f"/vehicles/{maintenance.vehicle_id}",
        )
        sent += delivered
        if delivered:
            maintenance.reminder_sent_for = next_due
            db.commit()

    return sent
