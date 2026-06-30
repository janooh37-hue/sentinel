"""Shared formatting helpers for employee notification channels.

Both the WhatsApp template renderer and the SMS text renderer use these to
turn an Employee + HR record into display-ready strings (localized name,
date, weekday, type label, disciplinary action text). Keeping them here means
the two channels can never drift in how they format the same data.
"""

from __future__ import annotations

from datetime import date

from app.core.constants import ARABIC_WEEKDAYS
from app.db.models import Employee

EVENT_LEAVE_APPROVED = "leave_approved"
EVENT_DUTY_RESUMPTION = "duty_resumption"
EVENT_VIOLATION = "violation"

# Monday-first to match datetime.weekday() and ARABIC_WEEKDAYS' ordering.
ENGLISH_WEEKDAYS: tuple[str, ...] = (
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
)


def english_part(value: str) -> str:
    return value.partition(" - ")[0].strip() or value.strip()


def arabic_part(value: str) -> str:
    return value.partition(" - ")[2].strip() or value.strip()


def type_label(value: str, lang: str) -> str:
    return arabic_part(value) if lang == "ar" else english_part(value)


def employee_name(emp: Employee, lang: str) -> str:
    if lang == "ar":
        return emp.name_ar or emp.name_en
    return emp.name_en or emp.name_ar or ""


def fmt_date(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def weekday(d: date, lang: str) -> str:
    table = ARABIC_WEEKDAYS if lang == "ar" else ENGLISH_WEEKDAYS
    return table[d.weekday()]


def action_text(action_taken: str | None, deduction_days: int, lang: str) -> str:
    if action_taken and action_taken.strip():
        return action_taken.strip()
    if deduction_days:
        return (
            f"خصم {deduction_days} يوم" if lang == "ar"
            else f"{deduction_days} day(s) deduction"
        )
    return "—"
