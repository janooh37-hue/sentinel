"""Render the full SMS body for an HR event.

Unlike WhatsApp (which uses Meta-registered templates with positional
placeholders), SMS has no pre-registration: we send the complete message text
ourselves, including the signature line. The wording mirrors the six WhatsApp
template bodies so both channels read identically.
"""

from __future__ import annotations

from app.db.models import Employee
from app.services import notify_format as nf

_SIGNATURE_EN = "Al Wathba Rehabilitation Centre"
_SIGNATURE_AR = "إدارة مركز الإصلاح والتأهيل بالوثبة"


def _leave_approved(leave, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    typ = nf.type_label(leave.leave_type, lang)
    s, sw = nf.fmt_date(leave.start_date), nf.weekday(leave.start_date, lang)
    e, ew = nf.fmt_date(leave.end_date), nf.weekday(leave.end_date, lang)
    days = str(leave.days)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تمت الموافقة على إجازتك ({typ}).\n"
            f"تاريخ البداية: {s} ({sw})\n"
            f"تاريخ النهاية: {e} ({ew})\n"
            f"المدة: {days} يوم.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your {typ} has been approved.\n"
        f"Start: {s} ({sw})\n"
        f"End: {e} ({ew})\n"
        f"Duration: {days} day(s).\n"
        f"{_SIGNATURE_EN}"
    )


def _duty_resumption(leave, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    d = leave.return_date or leave.end_date
    ds, wd = nf.fmt_date(d), nf.weekday(d, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم تسجيل مباشرتك للعمل بتاريخ {ds} ({wd}).\n"
            f"أهلاً بعودتك.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your return to duty on {ds} ({wd}) has been recorded.\n"
        f"Welcome back.\n"
        f"{_SIGNATURE_EN}"
    )


def _violation(v, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    typ = nf.type_label(v.violation_type, lang)
    ds, wd = nf.fmt_date(v.date), nf.weekday(v.date, lang)
    action = nf.action_text(v.action_taken, v.deduction_days, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم تسجيل {typ} بتاريخ {ds} ({wd}).\n"
            f"الإجراء: {action}.\n"
            f"يرجى مراجعة الموارد البشرية لأي استفسار.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"A {typ} has been recorded on {ds} ({wd}).\n"
        f"Action: {action}.\n"
        f"Please contact HR for any clarification.\n"
        f"{_SIGNATURE_EN}"
    )


_BUILDERS = {
    nf.EVENT_LEAVE_APPROVED: _leave_approved,
    nf.EVENT_DUTY_RESUMPTION: _duty_resumption,
    nf.EVENT_VIOLATION: _violation,
}


def render_text(event_type: str, language: str, record, employee: Employee) -> str:
    """Return the full SMS body for an event. KeyError on unknown event."""
    builder = _BUILDERS[event_type]
    lang = "ar" if language == "ar" else "en"
    return builder(record, employee, lang)
