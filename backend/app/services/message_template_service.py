"""Editable employee-message catalog, sample rendering and unsaved-form previews."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.core import form_policy
from app.db.models import Book, Employee, Leave, User
from app.schemas.notify import MessageText, NotifyPreviewRequest
from app.services import document_service, notify_dispatch, settings_service, sms_templates
from app.services import notify_format as nf

# Labels describe events, rather than repeating the editable message wording.
_LABELS = {
    "leave_requested": ("Leave requested", "طلب إجازة"),
    "leave_approved": ("Leave approved", "الموافقة على الإجازة"),
    "leave_rejected": ("Leave rejected", "رفض الإجازة"),
    "leave_cancelled": ("Leave cancelled", "إلغاء الإجازة"),
    "sick_leave_registered": ("Sick leave registered", "تسجيل إجازة مرضية"),
    "admin_leave": ("Administrative leave", "إجازة إدارية"),
    "leave_ending": ("Leave ending", "انتهاء الإجازة"),
    "leave_amended": ("Leave amended", "تعديل الإجازة"),
    "duty_resumption": ("Duty resumption", "مباشرة العمل"),
    "violation": ("Violation", "مخالفة"),
    "salary_transfer": ("Salary transfer", "تحويل الراتب"),
    "salary_deduction": ("Salary deduction", "خصم الراتب"),
    "employee_clearance": ("Employee clearance", "إخلاء طرف الموظف"),
    "hr_request": ("HR request", "طلب موارد بشرية"),
    "passport_release": ("Passport release", "تسليم جواز السفر"),
    "resignation": ("Resignation", "استقالة"),
    "warning": ("Warning", "إنذار"),
    "leave_permit": ("Leave permit", "تصريح مغادرة"),
}

_GSM_BASIC = frozenset(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./"
    "0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
_GSM_EXTENSION = frozenset("\f^{}\\[~]|€")


def segment_count(text: str) -> int:
    """SMS parts: GSM extensions cost two septets; Unicode counts UTF-16 units."""
    if not text:
        return 0
    if all(char in _GSM_BASIC or char in _GSM_EXTENSION for char in text):
        units = sum(2 if char in _GSM_EXTENSION else 1 for char in text)
        single, multipart = 160, 153
    else:
        units = len(text.encode("utf-16-le")) // 2
        single, multipart = 70, 67
    return 1 if units <= single else (units + multipart - 1) // multipart


def require_event(event: str) -> None:
    if event not in sms_templates.EVENTS:
        raise HTTPException(status_code=404, detail="Message template not found")


def event_label(event: str) -> tuple[str, str]:
    return _LABELS[event]


def catalog_metadata(event: str) -> dict[str, Any]:
    en, ar = event_label(event)
    services = [tpl for tpl, target in nf.TEMPLATE_EVENTS.items() if target == event]
    if event == nf.EVENT_VIOLATION:
        services += ["Violation Form", "violations"]
        group, timing = "violations", "on_save"
    elif event == nf.EVENT_LEAVE_ENDING:
        services += ["leaves"]
        group, timing = "reminders", "scheduled"
    elif event == nf.EVENT_DUTY_RESUMPTION:
        services += ["Duty Resumption Form", "leaves"]
        group, timing = "leaves", notify_dispatch.send_timing("Duty Resumption Form")
    elif event == nf.EVENT_ADMIN_LEAVE:
        services += ["Administrative Leave Form", "Leave Application Form", "leaves"]
        group, timing = "leaves", "on_approval"
    elif event in {
        nf.EVENT_LEAVE_REQUESTED,
        nf.EVENT_LEAVE_APPROVED,
        nf.EVENT_SICK_LEAVE_REGISTERED,
    }:
        services += ["Leave Application Form", "leaves"]
        group = "leaves"
        timing = "on_approval" if event == nf.EVENT_LEAVE_REQUESTED else "on_status_change"
    elif event in {nf.EVENT_LEAVE_REJECTED, nf.EVENT_LEAVE_CANCELLED, nf.EVENT_LEAVE_AMENDED}:
        services += ["leaves"]
        group, timing = "leaves", "on_status_change"
    else:
        group = (
            "leaves"
            if event == nf.EVENT_LEAVE_PERMIT
            else "violations"
            if event == nf.EVENT_WARNING
            else "forms"
        )
        timing = notify_dispatch.send_timing(services[0])
    return {"label": {"en": en, "ar": ar}, "group": group, "services": services, "timing": timing}


def read_template(db: Session, event: str) -> dict[str, Any]:
    require_event(event)
    return {
        "event": event,
        **catalog_metadata(event),
        "default": sms_templates.DEFAULTS[event],
        "override": sms_templates.get_override(db, event),
        "variables": [
            {
                "name": var.name,
                "label_en": var.label_en,
                "label_ar": var.label_ar,
                "sample": var.sample_en,
            }
            for var in sms_templates.VARIABLES[event]
        ],
    }


def save_template(
    db: Session, event: str, text: MessageText | None, *, actor: str
) -> dict[str, Any]:
    require_event(event)
    value = text.model_dump() if text is not None else None
    if value is not None:
        if any(not body.strip() for body in value.values()):
            raise ValidationFailedError("EMPTY_TEMPLATE", "Both message languages are required.")
        unknown = {
            lang: sms_templates.unknown_placeholders(event, body) for lang, body in value.items()
        }
        if any(unknown.values()):
            raise ValidationFailedError(
                "UNKNOWN_PLACEHOLDER", "Unknown message placeholders.", **unknown
            )
    settings_service.set_audited_setting(
        db,
        f"{sms_templates.OVERRIDE_PREFIX}{event}",
        value,
        actor=actor,
        action="message_template.updated" if value is not None else "message_template.reset",
        entity_type="message_template",
        entity_id=event,
    )
    return read_template(db, event)


def rendered(text: dict[str, str]) -> dict[str, Any]:
    return {"text": text, "segments": {lang: segment_count(body) for lang, body in text.items()}}


def render_sample(event: str, text: MessageText) -> dict[str, Any]:
    require_event(event)
    return rendered(
        {
            lang: sms_templates.substitute(body, sms_templates.sample_values(event, lang))
            for lang, body in text.model_dump().items()
        }
    )


def preview(db: Session, payload: NotifyPreviewRequest, *, user: User) -> dict[str, Any]:
    fields = document_service.join_violation_types(payload.fields)
    employee = db.get(Employee, payload.employee_id) if payload.employee_id is not None else None
    if payload.employee_id is not None and employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee is None:
        employee = Employee(id="", name_en="Ahmed Ali", name_ar="أحمد علي", msg_language="ar")
    language = "ar" if (employee.msg_language or "ar") == "ar" else "en"
    timing = notify_dispatch.send_timing(payload.template_id)
    result = {"event": None, "language": language, "timing": timing, "text": None, "segments": None}
    if payload.template_id not in nf.AUTO_NOTIFY_TEMPLATE_IDS:
        return result
    revise_book = None
    if payload.revise_of_book_id is not None:
        if timing != "on_approval":
            return result
        revise_book = db.get(Book, payload.revise_of_book_id)
        if revise_book is None or revise_book.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Book not found")
    now = datetime.now()
    route = nf.SPECIAL_TEMPLATE_ROUTES.get(payload.template_id)
    gated = form_policy.is_sign_gated_leave(payload.template_id, fields.get("leave_type"))
    record_id = revise_book.id if revise_book is not None else None
    record: Any
    if route == "violation":
        record = document_service._make_violation_row(employee.id, fields, Path(""), now)
    elif route in {"leave_status", "duty_resumption"}:
        record = document_service._make_leave_row(
            employee.id, payload.template_id, fields, Path(""), now
        )
        if revise_book is not None:
            plan = document_service.plan_gated_leave(
                db,
                template_id=payload.template_id,
                employee_id=employee.id,
                fields=fields,
                revise_book=revise_book,
            )
            existing = (
                db.get(Leave, plan.leave_id)
                if plan is not None and plan.leave_id is not None
                else document_service._find_duplicate_leave(db, record)
                if plan is None
                else None
            )
            record_id = existing.id if existing is not None else None
            # Generation updates dates only for the record's own gated leave.
            # Otherwise it reuses the row (including Annual Leave's later verdict).
            if existing is not None and (plan is None or not plan.move_dates):
                record.leave_type = existing.leave_type
                record.start_date = existing.start_date
                record.end_date = existing.end_date
                record.days = existing.days
                record.return_date = existing.return_date
                record.status = existing.status
        # Preview the approval-time message, not the unsaved row's Pending state.
        if form_policy.is_sign_gated_leave(payload.template_id, record.leave_type):
            record.status = "Approved"
    else:
        record = notify_dispatch.BookEvent(employee, fields, now.date(), now)
    # No relationship assignment, add, flush or commit: ORM records remain transient.
    event = notify_dispatch.template_event(
        payload.template_id, record if route == "leave_status" else None
    )
    if event is None:
        return result
    from app.services import perm_service
    from app.services.action_guard_service import template_decision

    template_decision(
        perm_service.effective_caps(db, user), "notification_template", "read", event
    ).require()
    if revise_book is not None and not notify_dispatch.approval_notification_eligible(
        db,
        revise_book,
        template_id=payload.template_id,
        target=(event, record_id),
        gated=gated,
        # Saving/submitting an enrolled gated revision resets its leave to Pending.
        status_changed=gated,
    ):
        return result
    text = {
        lang: sms_templates.render_text(event, lang, record, employee, db=db)
        for lang in ("ar", "en")
    }
    return {**result, "event": event, **rendered(text)}
