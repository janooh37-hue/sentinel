"""Single source of truth for employee-profile completeness.

The 14 tracked fields drive the profile gaps checklist, the ProfileTab
missing-row highlights, and the /employees/completeness aggregate. Field
display names live in frontend i18n under ``employee.field.<name>``.
"""

from __future__ import annotations

from app.db.models import Employee

TRACKED_FIELDS: tuple[str, ...] = (
    "name_en",
    "name_ar",
    "dob",
    "nationality",
    "contact",
    "passport_no",
    "passport_expiry",
    "uae_id_no",
    "uae_id_expiry",
    "iban",
    "position",
    "department",
    "duty_unit",
    "doj",
)


def _blank(value: object) -> bool:
    if value is None:
        return True
    return isinstance(value, str) and not value.strip()


def missing_fields(emp: Employee) -> list[str]:
    missing: list[str] = []
    for field in TRACKED_FIELDS:
        if field == "position":
            if _blank(emp.position) and _blank(emp.position_ar):
                missing.append(field)
        elif _blank(getattr(emp, field)):
            missing.append(field)
    return missing


def completeness(emp: Employee) -> tuple[int, int]:
    gaps = len(missing_fields(emp))
    return len(TRACKED_FIELDS) - gaps, len(TRACKED_FIELDS)
