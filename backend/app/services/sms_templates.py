"""Render employee messages shared by SMS and self-hosted WAHA WhatsApp.

Both channels send the same free-text body; no Meta templates are involved.
Bilingual defaults live here, with editable overrides in AppSetting (msgtpl.*).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from datetime import timedelta
from typing import Any, NamedTuple, cast

from sqlalchemy.orm import Session

from app.db.models import Employee
from app.services import notify_format as nf
from app.services import settings_service


class Variable(NamedTuple):
    name: str
    label_en: str
    label_ar: str
    sample_en: str
    sample_ar: str


OVERRIDE_PREFIX = "msgtpl."
_PLACEHOLDER = re.compile(r"\{(\w+)\}")

DEFAULTS: dict[str, dict[str, str]] = {
    nf.EVENT_LEAVE_REQUESTED: {
        "ar": "عزيزي {name}،\nتم استلام طلب إجازتك ({type}) من {start} إلى {end}.\nطلبك قيد المعالجة وسيتم إشعارك بالموافقة.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nYour {type} request from {start} to {end} has been received.\nYour request is being processed; you will be notified upon approval.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_LEAVE_PERMIT: {
        "ar": "عزيزي {name}،\n{permit_line}إدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\n{permit_line}Al Wathba Rehabilitation Centre",
    },
    nf.EVENT_ADMIN_LEAVE: {
        "ar": "عزيزي {name}،\nتم إصدار إجازتك الإدارية.\nالفترة: {start} إلى {end} ({days} يوم).\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nYour administrative leave has been issued.\nPeriod: {start} to {end} ({days} day(s)).\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_LEAVE_APPROVED: {
        "ar": "عزيزي {name}،\nتمت الموافقة على إجازتك ({type}).\nتاريخ البداية: {start} ({start_weekday})\nتاريخ النهاية: {end} ({end_weekday})\nالمدة: {days} يوم.\n{annual_note}إدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nYour {type} has been approved.\nStart: {start} ({start_weekday})\nEnd: {end} ({end_weekday})\nDuration: {days} day(s).\n{annual_note}Al Wathba Rehabilitation Centre",
    },
    nf.EVENT_LEAVE_REJECTED: {
        "ar": f"عزيزي {{name}}،\nنأسف لإبلاغك بعدم الموافقة على طلب إجازتك ({{type}}) من {{start}} إلى {{end}}.\nيرجى مراجعة {nf.ADMIN_OFFICE_AR} لمزيد من التفاصيل.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nWe regret to inform you that your {type} request from {start} to {end} was not approved.\nPlease contact the administration office for more details.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_LEAVE_CANCELLED: {
        "ar": f"عزيزي {{name}}،\nتم إلغاء إجازتك ({{type}}) من {{start}} إلى {{end}}.\n{{reason_line}}لأي استفسار يرجى مراجعة {nf.ADMIN_OFFICE_AR}.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nYour {type} from {start} to {end} has been cancelled.\n{reason_line}For any clarification, please contact the administration office.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_SICK_LEAVE_REGISTERED: {
        "ar": "عزيزي {name}،\nتم تسجيل إجازتك المرضية.\nالمدة: {days} يوم، من {start} ({start_weekday}) إلى {end} ({end_weekday}).\nنتمنى لك الشفاء العاجل.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nYour Sick Leave has been registered.\nDuration: {days} day(s), from {start} ({start_weekday}) to {end} ({end_weekday}).\nWe wish you a speedy recovery.\nAl Wathba Rehabilitation Centre",
    },
    # Default wording approved 2026-07-15; this reminder is editable too.
    nf.EVENT_LEAVE_ENDING: {
        "ar": f"عزيزي {{name}}،\nنفيدكم علماً بأن إجازتك السنوية تنتهي بتاريخ {{end}} ({{end_weekday}}) على أن تتم المباشرة في اليوم التالي {{resume}} ({{resume_weekday}}).\nيرجى مراجعة {nf.ADMIN_OFFICE_AR} لتسجيل مباشرة العمل.\nفي حال الإجازات الرسمية تتم المباشرة عند مسؤول السرية المناوبة.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nPlease be informed that your Annual Leave ends on {end} ({end_weekday}), and duty resumption is due on the following day, {resume} ({resume_weekday}).\nPlease visit the administration office to register your duty resumption.\nOn official holidays, duty resumption is registered with the on-duty company supervisor.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_DUTY_RESUMPTION: {
        "ar": "عزيزي {name}،\nتم تسجيل مباشرتك للعمل بتاريخ {date} ({weekday}).\nأهلاً بعودتك.\nإدارة مركز الإصلاح والتأهيل بالوثبة",  # noqa: RUF001
        "en": "Dear {name},\nYour return to duty on {date} ({weekday}) has been recorded.\nWelcome back.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_VIOLATION: {
        "ar": f"عزيزي {{name}}،\nتم تسجيل مخالفة بحقك بتاريخ {{date}} ({{weekday}}).\n{{details_line}}يرجى الحضور إلى {nf.ADMIN_OFFICE_AR} للتوقيع على محضر المخالفة.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nA violation has been recorded against you on {date} ({weekday}).\n{details_line}Please come to the administration office to sign the violation record.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_SALARY_TRANSFER: {
        "ar": f"عزيزي {{name}}،\nتم اعتماد طلب تحويل راتبك إلى حسابك لدى {{bank}}.\nسيتم التحويل مع راتب شهر {{month}}.\nلأي استفسار يرجى مراجعة {nf.HR_OFFICE_AR}.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nYour salary transfer request to your account at {bank} has been approved.\nThe transfer will take effect with the {month} salary.\nFor any clarification, please contact the HR office.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_SALARY_DEDUCTION: {
        "ar": f"عزيزي {{name}}،\nسيتم خصم مبلغ {{amount}} درهم من المرتب الشهري.\nلأي استفسار يرجى مراجعة {nf.HR_OFFICE_AR}.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nAn amount of AED {amount} will be deducted from the monthly salary.\nFor any clarification, please contact the HR office.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_EMPLOYEE_CLEARANCE: {
        "ar": "عزيزي {name}،\nتم إنجاز إخلاء طرفك اعتباراً من {date} ({weekday}).\nنتمنى لك التوفيق.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nYour employee clearance has been completed, effective {date} ({weekday}).\nWe wish you all the best.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_HR_REQUEST: {
        "ar": "عزيزي {name}،\n{docs_body}إدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\n{docs_body}Al Wathba Rehabilitation Centre",
    },
    nf.EVENT_PASSPORT_RELEASE: {
        "ar": "عزيزي {name}،\nتم تقديم طلب استلام جواز سفرك.\nسيتم إبلاغك عند جاهزيته للاستلام.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nYour passport release request has been submitted.\nYou will be notified when it is ready for collection.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_RESIGNATION: {
        "ar": "عزيزي {name}،\nتم استلام خطاب استقالتك بتاريخ {date} ({weekday}).\nسيتم إبلاغك بالإجراءات التالية.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nYour resignation letter has been received on {date} ({weekday}).\nYou will be informed of the next steps.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_WARNING: {
        "ar": f"عزيزي {{name}}،\nتم إصدار إنذار بحقك بتاريخ {{date}} ({{weekday}}).\nالمخالفة: {{type}}.\nيرجى الحضور إلى {nf.ADMIN_OFFICE_AR} للتوقيع على الإنذار.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nA warning has been issued against you on {date} ({weekday}).\nViolation: {type}.\nPlease come to the administration office to sign the warning.\nAl Wathba Rehabilitation Centre",
    },
    nf.EVENT_LEAVE_AMENDED: {
        "ar": f"عزيزي {{name}}،\nتم تعديل إجازتك السنوية.\nتاريخ البداية: {{start}} ({{start_weekday}})\nتاريخ النهاية: {{end}} ({{end_weekday}})\n{{duration_line}}{{reason_line}}لأي استفسار يرجى مراجعة {nf.ADMIN_OFFICE_AR}.\nإدارة مركز الإصلاح والتأهيل بالوثبة",
        "en": "Dear {name},\nYour Annual Leave has been updated.\nStart: {start} ({start_weekday})\nEnd: {end} ({end_weekday})\n{duration_line}{reason_line}For any clarification, please contact the administration office.\nAl Wathba Rehabilitation Centre",
    },
}
EVENTS = tuple(DEFAULTS)


def _period(leave: Any, emp: Employee, lang: str) -> dict[str, str]:
    return {
        "name": nf.employee_name(emp, lang),
        "start": nf.fmt_date(leave.start_date),
        "end": nf.fmt_date(leave.end_date),
    }


def _dated(day: Any, emp: Employee, lang: str) -> dict[str, str]:
    return {
        "name": nf.employee_name(emp, lang),
        "date": nf.fmt_date(day),
        "weekday": nf.weekday(day, lang),
    }


def vars_leave_requested(leave: Any, emp: Employee, lang: str) -> dict[str, str]:
    return {**_period(leave, emp, lang), "type": nf.type_label(leave.leave_type, lang)}


def vars_leave_rejected(leave: Any, emp: Employee, lang: str) -> dict[str, str]:
    return vars_leave_requested(leave, emp, lang)


def vars_admin_leave(leave: Any, emp: Employee, lang: str) -> dict[str, str]:
    return {**_period(leave, emp, lang), "days": str(leave.days)}


def vars_sick_leave_registered(leave: Any, emp: Employee, lang: str) -> dict[str, str]:
    return {
        **vars_admin_leave(leave, emp, lang),
        "start_weekday": nf.weekday(leave.start_date, lang),
        "end_weekday": nf.weekday(leave.end_date, lang),
    }


def vars_leave_approved(leave: Any, emp: Employee, lang: str) -> dict[str, str]:
    annual_note = ""
    if nf.type_label(leave.leave_type, "en") == "Annual Leave":
        annual_note = (
            "يرجى إحضار بطاقة العمل إلى المكتب لتجنب أي مخالفة.\nإجازة سعيدة.\n"
            if lang == "ar"
            else "Please bring your work ID to the office to avoid any violation.\nHave a nice vacation.\n"
        )
    return {
        **vars_sick_leave_registered(leave, emp, lang),
        "type": nf.type_label(leave.leave_type, lang),
        "annual_note": annual_note,
    }


def vars_leave_cancelled(leave: Any, emp: Employee, lang: str) -> dict[str, str]:
    reason = (getattr(leave, "notes", None) or "").strip()
    label = "سبب الإلغاء" if lang == "ar" else "Reason"
    return {
        **vars_leave_requested(leave, emp, lang),
        "reason_line": f"{label}: {reason}\n" if reason else "",
    }


def vars_leave_ending(leave: Any, emp: Employee, lang: str) -> dict[str, str]:
    """Editable reminder whose default wording was approved 2026-07-15."""
    resume = leave.end_date + timedelta(days=1)
    return {
        "name": nf.employee_name(emp, lang),
        "end": nf.fmt_date(leave.end_date),
        "end_weekday": nf.weekday(leave.end_date, lang),
        "resume": nf.fmt_date(resume),
        "resume_weekday": nf.weekday(resume, lang),
    }


def vars_duty_resumption(leave: Any, emp: Employee, lang: str) -> dict[str, str]:
    return _dated(leave.return_date or leave.end_date, emp, lang)


def vars_violation(record: Any, emp: Employee, lang: str) -> dict[str, str]:
    details = (getattr(record, "description", "") or "").strip()
    label = "التفاصيل" if lang == "ar" else "Details"
    return {
        **_dated(record.date, emp, lang),
        "details_line": f"{label}: {details}.\n" if details else "",
    }


def vars_salary_transfer(record: Any, emp: Employee, lang: str) -> dict[str, str]:
    return {
        "name": nf.employee_name(emp, lang),
        "bank": str((record.fields or {}).get("bank_name", "")),
        "month": nf.salary_transfer_month(record.today, lang),
    }


def vars_salary_deduction(record: Any, emp: Employee, lang: str) -> dict[str, str]:
    return {
        "name": nf.employee_name(emp, lang),
        "amount": str((record.fields or {}).get("amount", "")),
    }


def vars_employee_clearance(record: Any, emp: Employee, lang: str) -> dict[str, str]:
    return _dated(record.today, emp, lang)


def vars_hr_request(record: Any, emp: Employee, lang: str) -> dict[str, str]:
    docs, count = nf.hr_request_docs((record.fields or {}).get("doc_selections"), lang)
    if lang == "ar":
        body = (
            f"تم تقديم طلبك للحصول على المستندات التالية: {docs}.\nسيتم إبلاغك عند صدورها.\n"
            if count > 1
            else f"تم تقديم طلبك للحصول على {docs}.\nسيتم إبلاغك عند صدور المستند.\n"
        )
    else:
        body = (
            f"Your request for the following documents has been submitted: {docs}.\nYou will be notified once the documents are issued.\n"
            if count > 1
            else f"Your request for {docs} has been submitted.\nYou will be notified once the document is issued.\n"
        )
    return {"name": nf.employee_name(emp, lang), "docs_body": body}


def vars_passport_release(record: Any, emp: Employee, lang: str) -> dict[str, str]:
    return {"name": nf.employee_name(emp, lang)}


def vars_resignation(record: Any, emp: Employee, lang: str) -> dict[str, str]:
    return _dated(record.today, emp, lang)


def vars_warning(record: Any, emp: Employee, lang: str) -> dict[str, str]:
    return {
        **_dated(record.today, emp, lang),
        "type": nf.type_labels((record.fields or {}).get("violation_type", ""), lang),
    }


def vars_leave_permit(record: Any, emp: Employee, lang: str) -> dict[str, str]:
    """Numeric duration, free-text period, and empty duration keep distinct lines."""
    issued = record.created_at
    day = nf.fmt_date(issued.date())
    weekday = nf.weekday(issued.date(), lang)
    time = nf.fmt_time(issued, lang)
    hours = str((record.fields or {}).get("duration_hours", "") or "").strip()
    numeric = bool(hours) and hours.replace(".", "", 1).isdigit()
    if lang == "ar":
        if numeric:
            body = f"تم إصدار تصريح خروجك.\nاعتباراً من الساعة {time} يوم {weekday} {day}، ولمدة {hours} ساعة.\n"
        elif hours:
            body = f"تم إصدار تصريح خروجك بتاريخ {weekday} {day}.\nالمدة: {hours}.\n"
        else:
            body = f"تم إصدار تصريح خروجك.\nاعتباراً من الساعة {time} يوم {weekday} {day}.\n"
    elif numeric:
        body = f"Your leave permit has been issued.\nValid from {time} on {weekday}, {day}, for {hours} hour(s).\n"
    elif hours:
        body = f"Your leave permit has been issued on {weekday}, {day}.\nDuration: {hours}.\n"
    else:
        body = f"Your leave permit has been issued.\nValid from {time} on {weekday}, {day}.\n"
    return {
        "name": nf.employee_name(emp, lang),
        "date": day,
        "weekday": weekday,
        "time": time,
        "hours": hours,
        "permit_line": body,
    }


def vars_leave_amended(
    leave: Any, emp: Employee, lang: str, *, old_days: int, reason: str
) -> dict[str, str]:
    days = str(leave.days)
    if lang == "ar":
        duration_line = f"المدة الجديدة: {days} يوم (بدلاً من {old_days}).\n"
        reason_line = f"سبب التعديل: {reason}\n"
    else:
        duration_line = f"New duration: {days} day(s) (was {old_days}).\n"
        reason_line = f"Reason: {reason}\n"
    return {
        **vars_sick_leave_registered(leave, emp, lang),
        "old_days": str(old_days),
        "reason": reason,
        "duration_line": duration_line,
        "reason_line": reason_line,
    }


_VARIABLE_BUILDERS: dict[str, Callable[..., dict[str, str]]] = {
    nf.EVENT_LEAVE_REQUESTED: vars_leave_requested,
    nf.EVENT_LEAVE_PERMIT: vars_leave_permit,
    nf.EVENT_ADMIN_LEAVE: vars_admin_leave,
    nf.EVENT_LEAVE_APPROVED: vars_leave_approved,
    nf.EVENT_LEAVE_REJECTED: vars_leave_rejected,
    nf.EVENT_LEAVE_CANCELLED: vars_leave_cancelled,
    nf.EVENT_SICK_LEAVE_REGISTERED: vars_sick_leave_registered,
    nf.EVENT_LEAVE_ENDING: vars_leave_ending,
    nf.EVENT_DUTY_RESUMPTION: vars_duty_resumption,
    nf.EVENT_VIOLATION: vars_violation,
    nf.EVENT_SALARY_TRANSFER: vars_salary_transfer,
    nf.EVENT_SALARY_DEDUCTION: vars_salary_deduction,
    nf.EVENT_EMPLOYEE_CLEARANCE: vars_employee_clearance,
    nf.EVENT_HR_REQUEST: vars_hr_request,
    nf.EVENT_PASSPORT_RELEASE: vars_passport_release,
    nf.EVENT_RESIGNATION: vars_resignation,
    nf.EVENT_WARNING: vars_warning,
    nf.EVENT_LEAVE_AMENDED: vars_leave_amended,
}

_VARIABLES = {
    "name": Variable("name", "Employee name", "اسم الموظف", "John Smith", "جون سميث"),
    "type": Variable("type", "Type", "النوع", "Annual Leave", "الإجازة السنوية"),
    # Same {type} placeholder, but the warning's type is a violation, not a leave.
    "violation_type": Variable(
        "type", "Violation type", "نوع المخالفة", "Leaving the workplace", "ترك مكان العمل"
    ),
    "start": Variable("start", "Start date", "تاريخ البداية", "05/07/2026", "05/07/2026"),
    "end": Variable("end", "End date", "تاريخ النهاية", "09/07/2026", "09/07/2026"),
    "start_weekday": Variable("start_weekday", "Start weekday", "يوم البداية", "Sunday", "الأحد"),
    "end_weekday": Variable("end_weekday", "End weekday", "يوم النهاية", "Thursday", "الخميس"),
    "days": Variable("days", "Duration in days", "المدة بالأيام", "5", "5"),
    "annual_note": Variable(
        "annual_note",
        "Annual leave note (whole lines)",
        "ملاحظة الإجازة السنوية (أسطر كاملة)",
        "Please bring your work ID to the office to avoid any violation.\nHave a nice vacation.\n",
        "يرجى إحضار بطاقة العمل إلى المكتب لتجنب أي مخالفة.\nإجازة سعيدة.\n",
    ),
    "reason_line": Variable(
        "reason_line",
        "Reason (whole line)",
        "السبب (سطر كامل)",
        "Reason: Insufficient balance\n",
        "السبب: نقص الرصيد\n",
    ),
    "resume": Variable(
        "resume", "Duty resumption date", "تاريخ مباشرة العمل", "10/07/2026", "10/07/2026"
    ),
    "resume_weekday": Variable(
        "resume_weekday", "Duty resumption weekday", "يوم مباشرة العمل", "Friday", "الجمعة"
    ),
    "date": Variable("date", "Date", "التاريخ", "05/07/2026", "05/07/2026"),
    "weekday": Variable("weekday", "Weekday", "اليوم", "Sunday", "الأحد"),
    "details_line": Variable(
        "details_line",
        "Details (whole line)",
        "التفاصيل (سطر كامل)",
        "Details: Leaving the workplace.\n",
        "التفاصيل: ترك مكان العمل.\n",
    ),
    "bank": Variable("bank", "Bank name", "اسم البنك", "Bank", "البنك"),
    "month": Variable("month", "Salary month", "شهر الراتب", "August 2026", "أغسطس 2026"),
    "amount": Variable("amount", "Amount", "المبلغ", "100", "100"),
    "docs_body": Variable(
        "docs_body",
        "Requested documents (whole lines)",
        "المستندات المطلوبة (أسطر كاملة)",
        "Your request for Insurance Card has been submitted.\nYou will be notified once the document is issued.\n",
        "تم تقديم طلبك للحصول على بطاقة التأمين.\nسيتم إبلاغك عند صدور المستند.\n",
    ),
    "time": Variable("time", "Issue time", "وقت الإصدار", "1:15 PM", "1:15 مساءً"),
    "hours": Variable("hours", "Permit duration", "مدة التصريح", "3", "3"),
    "permit_line": Variable(
        "permit_line",
        "Permit (whole lines)",
        "التصريح (أسطر كاملة)",
        "Your leave permit has been issued.\nValid from 1:15 PM on Sunday, 05/07/2026, for 3 hour(s).\n",
        "تم إصدار تصريح خروجك.\nاعتباراً من الساعة 1:15 مساءً يوم الأحد 05/07/2026، ولمدة 3 ساعة.\n",
    ),
    "old_days": Variable(
        "old_days", "Previous duration in days", "المدة السابقة بالأيام", "10", "10"
    ),
    "reason": Variable(
        "reason", "Amendment reason", "سبب التعديل", "Insufficient balance", "نقص الرصيد"
    ),
    "duration_line": Variable(
        "duration_line",
        "Amended duration (whole line)",
        "المدة المعدلة (سطر كامل)",
        "New duration: 5 day(s) (was 10).\n",
        "المدة الجديدة: 5 يوم (بدلاً من 10).\n",
    ),
}

_EVENT_VARIABLE_NAMES = {
    nf.EVENT_LEAVE_REQUESTED: "name type start end",
    nf.EVENT_LEAVE_PERMIT: "name date weekday time hours permit_line",
    nf.EVENT_ADMIN_LEAVE: "name start end days",
    nf.EVENT_LEAVE_APPROVED: "name type start start_weekday end end_weekday days annual_note",
    nf.EVENT_LEAVE_REJECTED: "name type start end",
    nf.EVENT_LEAVE_CANCELLED: "name type start end reason_line",
    nf.EVENT_SICK_LEAVE_REGISTERED: "name start start_weekday end end_weekday days",
    nf.EVENT_LEAVE_ENDING: "name end end_weekday resume resume_weekday",
    nf.EVENT_DUTY_RESUMPTION: "name date weekday",
    nf.EVENT_VIOLATION: "name date weekday details_line",
    nf.EVENT_SALARY_TRANSFER: "name bank month",
    nf.EVENT_SALARY_DEDUCTION: "name amount",
    nf.EVENT_EMPLOYEE_CLEARANCE: "name date weekday",
    nf.EVENT_HR_REQUEST: "name docs_body",
    nf.EVENT_PASSPORT_RELEASE: "name",
    nf.EVENT_RESIGNATION: "name date weekday",
    nf.EVENT_WARNING: "name date weekday violation_type",
    nf.EVENT_LEAVE_AMENDED: "name start start_weekday end end_weekday days old_days reason duration_line reason_line",
}
VARIABLES: dict[str, tuple[Variable, ...]] = {
    event: tuple(_VARIABLES[name] for name in names.split())
    for event, names in _EVENT_VARIABLE_NAMES.items()
}


def variables(
    event: str, record: Any, employee: Employee, lang: str, **extra: Any
) -> dict[str, str]:
    return _VARIABLE_BUILDERS[event](record, employee, lang, **extra)


def substitute(text: str, values: Mapping[str, str]) -> str:
    """Replace plain named tokens once, never evaluating format expressions."""
    return _PLACEHOLDER.sub(lambda match: values.get(match[1], match[0]), text)


def unknown_placeholders(event: str, text: str) -> list[str]:
    allowed = {variable.name for variable in VARIABLES[event]}
    # Drop allowed tokens first so nested/format syntax like {name:{name}} still surfaces.
    rest = _PLACEHOLDER.sub(lambda match: "" if match[1] in allowed else match[0], text)
    return sorted({m.strip("{}") or m for m in re.findall(r"\{[^{}]*\}?|\}", rest)})


def get_override(db: Session | None, event: str) -> dict[str, str] | None:
    if db is None:
        return None
    return cast(dict[str, str] | None, settings_service._get(db, OVERRIDE_PREFIX + event))


def template_for(db: Session | None, event: str, lang: str) -> str:
    override = get_override(db, event)
    text = override.get(lang, "") if override else ""
    return text if text.strip() else DEFAULTS[event][lang]


def sample_values(event: str, lang: str) -> dict[str, str]:
    return {
        variable.name: variable.sample_ar if lang == "ar" else variable.sample_en
        for variable in VARIABLES[event]
    }


def render_text(
    event_type: str,
    language: str,
    record: Any,
    employee: Employee,
    *,
    db: Session | None = None,
) -> str:
    """Return the shared message body. KeyError on unknown event."""
    lang = "ar" if language == "ar" else "en"
    return substitute(
        template_for(db, event_type, lang), variables(event_type, record, employee, lang)
    )


def render_leave_amended(
    leave: Any,
    employee: Employee,
    lang: str,
    *,
    old_days: int,
    reason: str,
    db: Session | None = None,
) -> str:
    """Render with the previous duration, which is no longer on the Leave row."""
    lang = "ar" if lang == "ar" else "en"
    return substitute(
        template_for(db, nf.EVENT_LEAVE_AMENDED, lang),
        variables(nf.EVENT_LEAVE_AMENDED, leave, employee, lang, old_days=old_days, reason=reason),
    )
