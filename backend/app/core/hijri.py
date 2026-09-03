"""Pure Hijri date labels for vehicle letter templates."""

from __future__ import annotations

from datetime import date

from hijri_converter.convert import Gregorian


def hijri_label(d: date) -> str:
    """Return *d* as an Arabic Umm al-Qura date label."""
    h = Gregorian(d.year, d.month, d.day).to_hijri()
    return f"{h.day} {h.month_name('ar')} {h.year} هـ"
