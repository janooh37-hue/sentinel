"""Pure field builders for vehicle letter templates."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from app.core.hijri import hijri_label


@dataclass(frozen=True, slots=True)
class FineLine:
    """One fine rendered in the vehicle fines letter."""

    seq: int
    employee_name_ar: str | None
    employee_name_en: str | None
    g_number: str | None
    date: date
    amount: int
    black_points: int


def fines_letter_fields(
    *,
    plate_label: str,
    fines: Sequence[FineLine],
    hide_names: bool,
    today: date,
) -> dict[str, Any]:
    """Build the complete template context for a vehicle fines letter."""
    plate = plate_label.replace("\\", "/")
    rows: list[dict[str, Any]] = []
    for fine in fines:
        if hide_names or fine.g_number is None:
            employee_name = "—"
            g_number = "—"
        else:
            employee_name = fine.employee_name_ar or fine.employee_name_en or "—"
            g_number = fine.g_number
        rows.append(
            {
                "seq": fine.seq,
                "employee_name": employee_name,
                "g_number": g_number,
                "date": fine.date.strftime("%d/%m/%Y"),
                "amount": f"{fine.amount} درهم",
                "points": fine.black_points,
            }
        )

    return {
        "plate": plate,
        "hide_names": hide_names,
        "hijri_date": hijri_label(today),
        "subject": f"مخالفات المركبات — {plate}",
        "fines": rows,
    }


def accident_letter_fields(
    *,
    plate_label: str,
    vehicle_type_ar: str,
    vin: str | None,
    site_ar: str,
    date: date,
    time: str | None,
    employee_label: str | None,
    location_ar: str,
    police_ref: str | None,
    damage_cost: int,
    status: str,
    description_ar: str,
    today: date,
) -> dict[str, Any]:
    """Build the complete template context for an official accident letter."""
    plate = plate_label.replace("\\", "/")
    date_time = date.strftime("%d/%m/%Y")
    if time:
        date_time = f"{date_time} {time}"

    return {
        "plate": plate,
        "vehicle_type": vehicle_type_ar,
        "vin": vin or "—",
        "site": site_ar,
        "date_time": date_time,
        "employee": employee_label or "—",
        "location": location_ar,
        "police_ref": police_ref or "—",
        "damage_cost": f"{damage_cost} درهم",
        "status": "مفتوح" if status == "open" else "مغلق",
        "description": description_ar,
        "hijri_date": hijri_label(today),
        "subject": f"بلاغ حادث مركبة — {plate}",
    }
