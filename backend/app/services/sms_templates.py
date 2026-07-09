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

_HR_OFFICE_LINE_AR = f"لأي استفسار يرجى مراجعة {nf.HR_OFFICE_AR}."
_HR_OFFICE_LINE_EN = "For any clarification, please contact the HR office."


def _leave_approved(leave, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    typ = nf.type_label(leave.leave_type, lang)
    s, sw = nf.fmt_date(leave.start_date), nf.weekday(leave.start_date, lang)
    e, ew = nf.fmt_date(leave.end_date), nf.weekday(leave.end_date, lang)
    days = str(leave.days)
    # Annual Leave gets the extra ID-card reminder + a sign-off.
    is_annual = nf.type_label(leave.leave_type, "en") == "Annual Leave"
    if lang == "ar":
        annual = (
            "يرجى إحضار بطاقة العمل إلى المكتب لتجنب أي مخالفة.\nإجازة سعيدة.\n"
            if is_annual
            else ""
        )
        return (
            f"عزيزي {name}،\n"
            f"تمت الموافقة على إجازتك ({typ}).\n"
            f"تاريخ البداية: {s} ({sw})\n"
            f"تاريخ النهاية: {e} ({ew})\n"
            f"المدة: {days} يوم.\n"
            f"{annual}"
            f"{_SIGNATURE_AR}"
        )
    annual = (
        "Please bring your work ID to the office to avoid any violation.\nHave a nice vacation.\n"
        if is_annual
        else ""
    )
    return (
        f"Dear {name},\n"
        f"Your {typ} has been approved.\n"
        f"Start: {s} ({sw})\n"
        f"End: {e} ({ew})\n"
        f"Duration: {days} day(s).\n"
        f"{annual}"
        f"{_SIGNATURE_EN}"
    )


def _leave_requested(leave, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    typ = nf.type_label(leave.leave_type, lang)
    s, sw = nf.fmt_date(leave.start_date), nf.weekday(leave.start_date, lang)
    e, ew = nf.fmt_date(leave.end_date), nf.weekday(leave.end_date, lang)
    days = str(leave.days)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم تقديم طلبك ({typ}) وهو قيد المراجعة.\n"
            f"تاريخ البداية: {s} ({sw})\n"
            f"تاريخ النهاية: {e} ({ew})\n"
            f"المدة: {days} يوم.\n"
            f"سيتم إبلاغك عند اتخاذ القرار.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your {typ} request has been submitted and is under review.\n"
        f"Start: {s} ({sw})\n"
        f"End: {e} ({ew})\n"
        f"Duration: {days} day(s).\n"
        f"You will be notified once a decision is made.\n"
        f"{_SIGNATURE_EN}"
    )


def _leave_rejected(leave, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    typ = nf.type_label(leave.leave_type, lang)
    s = nf.fmt_date(leave.start_date)
    e = nf.fmt_date(leave.end_date)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"نأسف لإبلاغك برفض طلب إجازتك ({typ}) من {s} إلى {e}.\n"
            f"{_HR_OFFICE_LINE_AR}\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your {typ} request from {s} to {e} has been rejected.\n"
        f"{_HR_OFFICE_LINE_EN}\n"
        f"{_SIGNATURE_EN}"
    )


def _leave_cancelled(leave, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    typ = nf.type_label(leave.leave_type, lang)
    s = nf.fmt_date(leave.start_date)
    e = nf.fmt_date(leave.end_date)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم إلغاء طلب إجازتك ({typ}) من {s} إلى {e}.\n"
            f"{_HR_OFFICE_LINE_AR}\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your {typ} from {s} to {e} has been cancelled.\n"
        f"{_HR_OFFICE_LINE_EN}\n"
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
    typ = nf.type_labels(v.violation_type, lang)
    ds, wd = nf.fmt_date(v.date), nf.weekday(v.date, lang)
    action = nf.action_text(v.action_taken, v.deduction_days, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم تسجيل {typ} بتاريخ {ds} ({wd}).\n"
            f"الإجراء: {action}.\n"
            f"يرجى مراجعة {nf.ADMIN_OFFICE_AR} لأي استفسار.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"A {typ} has been recorded on {ds} ({wd}).\n"
        f"Action: {action}.\n"
        f"Please contact the administration office for any clarification.\n"
        f"{_SIGNATURE_EN}"
    )


def _salary_transfer(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    bank = (rec.fields or {}).get("bank_name", "")
    month = nf.salary_transfer_month(rec.today, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم اعتماد طلب تحويل راتبك إلى حسابك لدى {bank}.\n"
            f"سيتم التحويل مع راتب شهر {month}.\n"
            f"{_HR_OFFICE_LINE_AR}\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your salary transfer request to your account at {bank} has been approved.\n"
        f"The transfer will take effect with the {month} salary.\n"
        f"{_HR_OFFICE_LINE_EN}\n"
        f"{_SIGNATURE_EN}"
    )


def _salary_deduction(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    amount = (rec.fields or {}).get("amount", "")
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"سيتم خصم مبلغ {amount} درهم من المرتب الشهري.\n"
            f"{_HR_OFFICE_LINE_AR}\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"An amount of AED {amount} will be deducted from the monthly salary.\n"
        f"{_HR_OFFICE_LINE_EN}\n"
        f"{_SIGNATURE_EN}"
    )


def _employee_clearance(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    ds, wd = nf.fmt_date(rec.today), nf.weekday(rec.today, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم إنجاز إخلاء طرفك اعتباراً من {ds} ({wd}).\n"
            f"نتمنى لك التوفيق.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your employee clearance has been completed, effective {ds} ({wd}).\n"
        f"We wish you all the best.\n"
        f"{_SIGNATURE_EN}"
    )


def _hr_request(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    docs, count = nf.hr_request_docs((rec.fields or {}).get("doc_selections"), lang)
    if lang == "ar":
        if count > 1:
            body = f"تم تقديم طلبك للحصول على المستندات التالية: {docs}.\nسيتم إبلاغك عند صدورها.\n"
        else:
            body = f"تم تقديم طلبك للحصول على {docs}.\nسيتم إبلاغك عند صدور المستند.\n"
        return f"عزيزي {name}،\n{body}{_SIGNATURE_AR}"
    if count > 1:
        body = (
            f"Your request for the following documents has been submitted: {docs}.\n"
            f"You will be notified once the documents are issued.\n"
        )
    else:
        body = (
            f"Your request for {docs} has been submitted.\n"
            f"You will be notified once the document is issued.\n"
        )
    return f"Dear {name},\n{body}{_SIGNATURE_EN}"


def _passport_release(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم تقديم طلب استلام جواز سفرك.\n"
            f"سيتم إبلاغك عند جاهزيته للاستلام.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your passport release request has been submitted.\n"
        f"You will be notified when it is ready for collection.\n"
        f"{_SIGNATURE_EN}"
    )


def _resignation(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    ds, wd = nf.fmt_date(rec.today), nf.weekday(rec.today, lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم استلام خطاب استقالتك بتاريخ {ds} ({wd}).\n"
            f"سيتم إبلاغك بالإجراءات التالية.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"Your resignation letter has been received on {ds} ({wd}).\n"
        f"You will be informed of the next steps.\n"
        f"{_SIGNATURE_EN}"
    )


def _warning(rec, emp: Employee, lang: str) -> str:
    name = nf.employee_name(emp, lang)
    ds, wd = nf.fmt_date(rec.today), nf.weekday(rec.today, lang)
    vtype = nf.type_labels((rec.fields or {}).get("violation_type", ""), lang)
    if lang == "ar":
        return (
            f"عزيزي {name}،\n"
            f"تم إصدار إنذار بحقك بتاريخ {ds} ({wd}).\n"
            f"المخالفة: {vtype}.\n"
            f"يرجى مراجعة {nf.ADMIN_OFFICE_AR} لأي استفسار.\n"
            f"{_SIGNATURE_AR}"
        )
    return (
        f"Dear {name},\n"
        f"A warning has been issued against you on {ds} ({wd}).\n"
        f"Violation: {vtype}.\n"
        f"Please contact the administration office for any clarification.\n"
        f"{_SIGNATURE_EN}"
    )


_BUILDERS = {
    nf.EVENT_LEAVE_REQUESTED: _leave_requested,
    nf.EVENT_LEAVE_APPROVED: _leave_approved,
    nf.EVENT_LEAVE_REJECTED: _leave_rejected,
    nf.EVENT_LEAVE_CANCELLED: _leave_cancelled,
    nf.EVENT_DUTY_RESUMPTION: _duty_resumption,
    nf.EVENT_VIOLATION: _violation,
    nf.EVENT_SALARY_TRANSFER: _salary_transfer,
    nf.EVENT_SALARY_DEDUCTION: _salary_deduction,
    nf.EVENT_EMPLOYEE_CLEARANCE: _employee_clearance,
    nf.EVENT_HR_REQUEST: _hr_request,
    nf.EVENT_PASSPORT_RELEASE: _passport_release,
    nf.EVENT_RESIGNATION: _resignation,
    nf.EVENT_WARNING: _warning,
}


def render_text(event_type: str, language: str, record, employee: Employee) -> str:
    """Return the full SMS body for an event. KeyError on unknown event."""
    builder = _BUILDERS[event_type]
    lang = "ar" if language == "ar" else "en"
    return builder(record, employee, lang)
