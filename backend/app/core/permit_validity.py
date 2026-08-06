from calendar import monthrange
from datetime import date, timedelta
from typing import Literal

PermitValidityUnit = Literal["day", "week", "month", "year"]
_MAX_BY_UNIT = {"day": 3650, "week": 520, "month": 120, "year": 10}


def validate_period(value: int, unit: str) -> None:
    if unit not in _MAX_BY_UNIT or not 1 <= value <= _MAX_BY_UNIT[unit]:
        raise ValueError("invalid permit validity period")


def validate_period_read(value: int, unit: str) -> None:
    if unit not in _MAX_BY_UNIT or value < 1:
        raise ValueError("invalid permit validity period")


def _shift_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    return date(year, month, min(value.day, monthrange(year, month)[1]))


def period_end(start: date, value: int, unit: str) -> date:
    validate_period(value, unit)
    if unit == "day":
        boundary = start + timedelta(days=value)
    elif unit == "week":
        boundary = start + timedelta(weeks=value)
    else:
        boundary = _shift_months(start, value * (12 if unit == "year" else 1))
    return max(start, boundary - timedelta(days=1))


_AR_PERIODS = {
    "day": ("يوم واحد", "يومان", "أيام", "يوماً"),
    "week": ("أسبوع واحد", "أسبوعان", "أسابيع", "أسبوعاً"),
    "month": ("شهر واحد", "شهران", "أشهر", "شهراً"),
    "year": ("سنة واحدة", "سنتان", "سنوات", "سنة"),
}


def period_label(value: int, unit: str, lang: Literal["en", "ar"]) -> str:
    validate_period_read(value, unit)
    if lang == "en":
        return f"{value} {unit if value == 1 else unit + 's'}"
    one, two, few, many = _AR_PERIODS[unit]
    if value == 1:
        return one
    if value == 2:
        return two
    return f"{value} {few if 3 <= value <= 10 else many}"
