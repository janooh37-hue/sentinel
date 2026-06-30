"""Map an HR event + record to a WhatsApp template name and ordered params.

WhatsApp business-initiated messages use templates pre-registered in Meta with
positional ``{{1}}`` variables. This module is the single source of truth for
which template fires per (event, language) and the EXACT order of body params.
The order here MUST match the registered template. The signature line is part
of the registered template body, so it is not produced here.
"""

from __future__ import annotations

from app.db.models import Employee
from app.services.notify_format import (
    EVENT_DUTY_RESUMPTION,
    EVENT_LEAVE_APPROVED,
    EVENT_VIOLATION,
    action_text as _action_text,
    employee_name as _name,
    fmt_date as _fmt_date,
    type_label as _type_label,
    weekday as _weekday,
)


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
