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


# Canonical (English, Arabic) labels keyed by the lowercased English lead.
# Used only as a FALLBACK: a record stored as the well-formed "English - عربي"
# keeps its own Arabic half verbatim. This map rescues the messy shapes that
# leak the wrong language otherwise — English-only ("Annual Leave"), no-dash
# mixed ("Duty Resumption مباشرة عمل"), and the generic "Unknown"/"Violation".
# Arabic for the in-use types matches the wording already stored on real
# records; the rest mirror the app's i18n (frontend src/locales/ar.json).
_TYPE_CANON: dict[str, tuple[str, str]] = {
    "annual leave": ("Annual Leave", "الإجازة السنوية"),
    "sick leave": ("Sick Leave", "الإجازة المرضية"),
    "duty leave": ("Duty Leave", "الاستئذان"),
    "national service": ("National Service", "الخدمة الوطنية"),
    "others": ("Others", "أخرى"),
    "duty resumption": ("Duty Resumption", "مباشرة عمل"),
    "passport release": ("Passport Release", "تسليم جواز"),
    "emergency leave": ("Emergency Leave", "إجازة طارئة"),
    "hajj leave": ("Hajj Leave", "إجازة حج"),
    "compassionate leave": ("Compassionate Leave", "إجازة تعزية"),
    "administrative leave": ("Administrative Leave", "إجازة إدارية"),
    "maternity leave": ("Maternity Leave", "إجازة أمومة"),
    "unpaid leave": ("Unpaid Leave", "إجازة بدون راتب"),
    "leave permit": ("Leave Permit", "تصريح خروج"),
    "unknown": ("Leave", "إجازة"),
    "violation": ("Violation", "مخالفة"),
}


def _has_arabic(s: str) -> bool:
    return any("؀" <= ch <= "ۿ" for ch in s)


def _english_lead(value: str) -> str:
    """Leading Latin run of a possibly-mixed label (stops at the first Arabic
    char or the ' - ' separator). 'Duty Resumption مباشرة عمل' -> 'Duty
    Resumption'; an Arabic-only value -> ''."""
    out: list[str] = []
    for ch in value:
        if "؀" <= ch <= "ۿ":
            break
        out.append(ch)
    return "".join(out).strip(" -").strip()


def type_label(value: str, lang: str) -> str:
    """Localized type label, robust to inconsistent stored shapes.

    A well-formed ``"English - عربي"`` keeps its own halves. Otherwise a
    canonical map fills the missing language so an Arabic SMS never shows the
    English label (and vice-versa). Unmapped free-text falls back to the split.
    """
    v = (value or "").strip()
    if lang == "ar":
        ar = arabic_part(v)
        if " - " in v and _has_arabic(ar):
            return ar
        entry = _TYPE_CANON.get(_english_lead(v).lower())
        return entry[1] if entry else ar
    if " - " in v:
        return english_part(v)
    entry = _TYPE_CANON.get(_english_lead(v).lower())
    return entry[0] if entry else english_part(v)


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
