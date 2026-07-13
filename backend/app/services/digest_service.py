"""Build + render the annual-leave digest for duty-unit supervisors.

A small, extensible bilingual list layer: future digests (returning-to-duty,
pending-approvals) reuse render helpers + the supervisor router without
touching resolution.
"""

from __future__ import annotations

import calendar
from datetime import date

from sqlalchemy.orm import Session

from app.db.models import Employee, Leave
from app.services import leave_service
from app.services import notify_format as nf


def month_bounds(d: date) -> tuple[date, date]:
    last = calendar.monthrange(d.year, d.month)[1]
    return date(d.year, d.month, 1), date(d.year, d.month, last)


def _month_name(d: date, lang: str) -> str:
    table = nf.AR_MONTHS if lang == "ar" else nf.EN_MONTHS
    return f"{table[d.month - 1]} {d.year}"


def render_leave_digest(
    unit: str,
    month: date,
    employees_leaves: list[tuple[Employee, Leave]],
    lang: str,
) -> str:
    """One bilingual message: heading (unit + month) then a line per person."""
    if lang == "ar":
        heading = f"الإجازات السنوية لوحدة «{unit}» لشهر {_month_name(month, 'ar')}:"
    else:
        heading = f'Annual leave for unit "{unit}" — {_month_name(month, "en")}:'
    lines = [heading]
    for emp, lv in employees_leaves:
        name = nf.employee_name(emp, lang)
        span = f"{nf.fmt_date(lv.start_date)} → {nf.fmt_date(lv.end_date)}"
        lines.append(f"• {name} — {span}")
    return "\n".join(lines)


def build_unit_digest(db: Session, duty_unit: str, month: date) -> list[tuple[Employee, Leave]]:
    ms, me = month_bounds(month)
    leaves = leave_service.list_annual_overlapping(
        db, month_start=ms, month_end=me, duty_unit=duty_unit
    )
    pairs: list[tuple[Employee, Leave]] = []
    for lv in leaves:
        emp = db.get(Employee, lv.employee_id)
        if emp is not None:
            pairs.append((emp, lv))
    return pairs
