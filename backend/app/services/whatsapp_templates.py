"""Map an HR event + record to a WhatsApp template name and ordered params.

WhatsApp business-initiated messages use templates pre-registered in Meta with
positional ``{{1}}`` variables. This module is the single source of truth for
which template fires per (event, language) and the EXACT order of body params.
The order here MUST match the registered template. The signature line is part
of the registered template body, so it is not produced here.
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


def _english_part(value: str) -> str:
    return value.partition(" - ")[0].strip() or value.strip()


def _arabic_part(value: str) -> str:
    return value.partition(" - ")[2].strip() or value.strip()


def _type_label(value: str, lang: str) -> str:
    return _arabic_part(value) if lang == "ar" else _english_part(value)


def _name(emp: Employee, lang: str) -> str:
    if lang == "ar":
        return emp.name_ar or emp.name_en
    return emp.name_en or emp.name_ar or ""


def _fmt_date(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _weekday(d: date, lang: str) -> str:
    table = ARABIC_WEEKDAYS if lang == "ar" else ENGLISH_WEEKDAYS
    return table[d.weekday()]


def _action_text(action_taken: str | None, deduction_days: int, lang: str) -> str:
    if action_taken and action_taken.strip():
        return action_taken.strip()
    if deduction_days:
        return (
            f"خصم {deduction_days} يوم" if lang == "ar"
            else f"{deduction_days} day(s) deduction"
        )
    return "—"


def _build_leave_approved(leave, emp: Employee, lang: str) -> list[str]:
    return [
        _name(emp, lang),
        _type_label(leave.leave_type, lang),
        _fmt_date(leave.start_date), _weekday(leave.start_date, lang),
        _fmt_date(leave.end_date), _weekday(leave.end_date, lang),
        str(leave.days),
    ]


def _build_duty_resumption(leave, emp: Employee, lang: str) -> list[str]:
    d = leave.return_date or leave.end_date
    return [_name(emp, lang), _fmt_date(d), _weekday(d, lang)]


def _build_violation(v, emp: Employee, lang: str) -> list[str]:
    return [
        _name(emp, lang),
        _type_label(v.violation_type, lang),
        _fmt_date(v.date), _weekday(v.date, lang),
        _action_text(v.action_taken, v.deduction_days, lang),
    ]


_BUILDERS = {
    EVENT_LEAVE_APPROVED: _build_leave_approved,
    EVENT_DUTY_RESUMPTION: _build_duty_resumption,
    EVENT_VIOLATION: _build_violation,
}


def render(event_type: str, language: str, record, employee: Employee) -> tuple[str, list[str]]:
    """Return ``(template_name, params)`` for an event. KeyError on unknown event."""
    builder = _BUILDERS[event_type]
    lang = "ar" if language == "ar" else "en"
    params = builder(record, employee, lang)
    return f"{event_type}_{lang}", params
