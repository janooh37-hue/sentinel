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
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)

HR_OFFICE_AR = "مكتب الموارد البشرية"
ADMIN_OFFICE_AR = "مكتب الإدارة"

# Gregorian month names, January at index 0 (UAE-standard Arabic transliterations).
AR_MONTHS: tuple[str, ...] = (
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
)
EN_MONTHS: tuple[str, ...] = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def salary_transfer_month(today: date, lang: str) -> str:
    """Month a salary transfer takes effect: on/before the 15th -> next month;
    after the 15th -> the month after. Returns month name + year only (no
    leading «شهر» — the template already supplies it)."""
    bump = 1 if today.day <= 15 else 2
    m = today.month - 1 + bump  # 0-indexed target month, may exceed 11
    year = today.year + m // 12
    table = AR_MONTHS if lang == "ar" else EN_MONTHS
    return f"{table[m % 12]} {year}"


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

# Arabic-only free-text labels (HR types these directly) keyed by the exact
# stored string, so the English template shows English instead of leaking
# Arabic. Extend as new Arabic types/actions appear.
_TYPE_CANON_AR: dict[str, tuple[str, str]] = {
    "ترك مكان العمل": ("Leaving the workplace", "ترك مكان العمل"),
}

# Disciplinary actions entered in Arabic → English (for the English channel).
_ACTION_AR_EN: dict[str, str] = {
    "إنذار خطي": "Written warning",
    "إنذار شفهي": "Verbal warning",
}


def _has_arabic(s: str) -> bool:
    return any("؀" <= ch <= "ۿ" for ch in s)


def _canon(value: str) -> tuple[str, str] | None:
    """Resolve a stored type to canonical (English, Arabic), or None."""
    entry = _TYPE_CANON.get(_english_lead(value).lower())
    if entry:
        return entry
    return _TYPE_CANON_AR.get(value.strip())


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
        entry = _canon(v)
        return entry[1] if entry else ar
    if " - " in v:
        return english_part(v)
    entry = _canon(v)
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
        a = action_taken.strip()
        # Keep the English channel English: translate known Arabic actions.
        if lang == "en":
            return _ACTION_AR_EN.get(a, a)
        return a
    if deduction_days:
        return f"خصم {deduction_days} يوم" if lang == "ar" else f"{deduction_days} day(s) deduction"
    return "—"


# HR Request form "Requested Documents" options -> (English, Arabic) label.
# These options have no Arabic label elsewhere in the app; this is their source.
_HR_DOC_LABELS: dict[str, tuple[str, str]] = {
    "insurance_card": ("Insurance Card", "بطاقة التأمين"),
    "id_card": ("ID Card", "بطاقة الهوية"),
    "employment_certificate": ("Employment Certificate", "خطاب عمل"),
    "salary_certificate": ("Salary Certificate", "شهادة راتب"),
    "salary_transfer_letter": ("Salary Transfer Letter", "خطاب تحويل راتب"),
    "salary_pay_slip": ("Salary Pay Slip", "قسيمة الراتب"),
    "experience_certificate": ("Experience Certificate", "شهادة خبرة"),
}


def _doc_keys(selections) -> list[str]:
    """Normalize the stored doc_selections shape (dict/list/str) to a key list."""
    if isinstance(selections, dict):
        return [k for k, v in selections.items() if v]
    if isinstance(selections, list):
        return [s for s in selections if isinstance(s, str)]
    if isinstance(selections, str) and selections:
        return [selections]
    return []


def hr_request_docs(selections, lang: str) -> tuple[str, int]:
    """Localized, joined label(s) for the requested documents, plus the count."""
    idx = 1 if lang == "ar" else 0
    labels = [_HR_DOC_LABELS[k][idx] for k in _doc_keys(selections) if k in _HR_DOC_LABELS]
    sep = "، " if lang == "ar" else ", "
    return sep.join(labels), len(labels)
