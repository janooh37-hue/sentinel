"""Pure field builders for vehicle letter templates."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from html import escape
from typing import Any

from app.core.constants import ARABIC_MONTHS
from app.core.hijri import hijri_label
from app.schemas.vehicle import OdometerRowRead, VehicleMaintenanceRead

_MAINTENANCE_LABELS = {
    "service": "صيانة دورية",
    "repair": "إصلاح",
    "tires": "إطارات",
    "other": "أخرى",
}


@dataclass(frozen=True, slots=True)
class FineLine:
    """One fine rendered in the vehicle fines letter."""

    seq: int
    employee_name_ar: str | None
    employee_name_en: str | None
    g_number: str | None
    date: date
    amount_fils: int
    black_points: int


def _format_letter_amount(amount_fils: int) -> str:
    """`34900 -> "349 درهم"`, `34950 -> "349.50 درهم"` — whole dirhams print
    without cents, exactly as the template always has; a fractional fine now
    prints its cents rather than being silently rounded away."""
    whole, cents = divmod(amount_fils, 100)
    amount = str(whole) if cents == 0 else f"{whole}.{cents:02d}"
    return f"{amount} درهم"


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
                "amount": _format_letter_amount(fine.amount_fils),
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


def odometer_form_fields(
    *, month: str, rows: Sequence[OdometerRowRead], today: date
) -> dict[str, Any]:
    """Format the monthly fleet register without treating missing readings as zero."""
    year, month_number = map(int, month.split("-"))
    return {
        "subject": f"سجل عداد المسافات والصيانة الشهري للمركبات — {month_number:02d}/{year}",
        "date": today.strftime("%d-%m-%Y"),
        "month_label": f"{ARABIC_MONTHS[month_number - 1]} {year}",
        "rows": [
            {
                "seq": seq,
                "plate": row.plate_label.replace("\\", "/"),
                "vehicle_type": row.vehicle_type_ar or row.vehicle_type_en or "—",
                "opening_km": f"{row.opening_km:,}" if row.opening_km is not None else "—",
                "closing_km": f"{row.closing_km:,}" if row.closing_km is not None else "—",
                "km_driven": f"{row.km_driven:,}" if row.km_driven is not None else "—",
                "maintenance": "\n".join(
                    f"{_MAINTENANCE_LABELS.get(item.type, item.type)} (\u200e{item.date:%d/%m}\u200e)"
                    for item in row.maintenance
                )
                or "—",
                "maintenance_cost": f"{row.maintenance_cost:,}",
            }
            for seq, row in enumerate(rows, start=1)
        ],
        "total_km_driven": f"{sum(row.km_driven or 0 for row in rows):,}",
        "total_maintenance_cost": f"{sum(row.maintenance_cost for row in rows):,}",
    }


def maintenance_request_body(
    *,
    plate: str,
    vehicle_type: str,
    make_model: str,
    year: int | None,
    vin: str | None,
    site: str,
    driver: str | None,
    odometer_km: int | None,
    last_maintenance: VehicleMaintenanceRead | None,
    work_type: str,
    description: str,
) -> str:
    """Build escaped Arabic HTML for the existing General Book table renderer."""

    def cell(value: object) -> str:
        return escape(str(value) if value is not None and value != "" else "—")

    def table(rows: Sequence[tuple[str, object]]) -> str:
        return (
            '<table dir="rtl">'
            + "".join(
                f"<tr><td>{cell(label)}</td><td>{cell(value)}</td></tr>" for label, value in rows
            )
            + "</table>"
        )

    vehicle_table = table(
        [
            ("رقم اللوحة", plate),
            ("نوع المركبة", vehicle_type),
            ("الصنع والطراز", make_model),
            ("سنة الصنع", year),
            ("رقم الهيكل", vin),
            ("الموقع", site),
            ("السائق", driver),
            ("قراءة العداد الحالية (كم)", odometer_km),
        ]
    )
    maintenance = "<p>لا توجد صيانة سابقة مسجلة</p>"
    if last_maintenance is not None:
        maintenance = table(
            [
                ("التاريخ", last_maintenance.date.strftime("%d/%m/%Y")),
                ("النوع", _MAINTENANCE_LABELS.get(last_maintenance.type, last_maintenance.type)),
                ("قراءة العداد (كم)", last_maintenance.odometer_km),
                ("التكلفة (درهم)", last_maintenance.cost),
            ]
        )
    work_label = cell(_MAINTENANCE_LABELS.get(work_type, work_type))
    work_description = cell(description).replace("\n", "<br>")
    return (
        '<div dir="rtl" style="text-align:right">'
        "<p>يرجى التكرم بتنفيذ الأعمال المطلوبة للمركبة الموضحة بياناتها أدناه.</p>"
        f"<h3>بيانات المركبة</h3>{vehicle_table}"
        f"<h3>آخر صيانة</h3>{maintenance}"
        f"<h3>العمل المطلوب</h3><p>{work_label}: {work_description}</p></div>"
    )
