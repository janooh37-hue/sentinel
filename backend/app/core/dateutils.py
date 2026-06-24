"""Date parsing helpers ported from `gssg_manager.pyw` v3.5.4 line 412.

Excel-serial and string-format coercion. The behaviour is preserved exactly to
keep the migration in Phase 09 byte-equivalent — including the (deliberate)
1900 leap-bug compensation that subtracts a day for serials > 59.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Final

# Excel's day-zero per Microsoft's (broken) calendar that treats 1900 as a leap
# year. Combined with the >59 offset below, this round-trips correctly for any
# date Excel can produce.
_EXCEL_EPOCH: Final[datetime] = datetime(1899, 12, 30)

_STR_FORMATS: Final[tuple[str, ...]] = (
    "%d/%m/%Y",
    "%Y-%m-%d",
    "%Y-%m-%d %H:%M:%S",
)


def excel_date_to_datetime(value: object) -> datetime | None:
    """Coerce v3.5.4's loose date inputs to a datetime.

    Accepts:
      * ``None`` → returns ``None``.
      * ``datetime`` / ``date`` → returned as-is (datetime promotion for date).
      * ``str`` → tries ``%d/%m/%Y``, ``%Y-%m-%d``, then ``%Y-%m-%d %H:%M:%S``.
      * ``int`` / ``float`` (or numeric str) → treated as Excel serial. Values
        > 59 are decremented by 1 to compensate for Excel's phantom Feb 29 1900.

    Anything that fails every coercion returns ``None`` — same as v3.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        for fmt in _STR_FORMATS:
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                continue
        # Fall through to numeric-from-string attempt below.
        try:
            serial = float(text)
        except ValueError:
            return None
        return _serial_to_datetime(serial)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return _serial_to_datetime(float(value))
    return None


def _serial_to_datetime(serial: float) -> datetime | None:
    try:
        if serial > 59:
            serial -= 1
        return _EXCEL_EPOCH + timedelta(days=serial)
    except (OverflowError, ValueError):
        return None
