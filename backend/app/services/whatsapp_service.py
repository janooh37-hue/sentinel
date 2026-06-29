"""Resolve → send → log a WhatsApp notification for an HR event.

Loads the source record + employee, normalizes the phone (from ``contact``),
resolves the language preference, renders template params, calls the transport
client, and persists every attempt to ``whatsapp_messages``. Re-sends are
first-class — each call writes a new row. ``last_status`` powers the badge.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.phone import normalize_phone
from app.db.models import Employee, Leave, Violation, WhatsAppMessage
from app.services import whatsapp_client, whatsapp_templates as wt

log = logging.getLogger(__name__)


class WhatsAppDisabledError(RuntimeError):
    """Raised when an admin tries to send while WhatsApp is not configured."""


class RecordNotFoundError(LookupError):
    """Raised when the event's source record does not exist."""


# event_type → (model, loader). Leave-based events share the Leave row.
def _load_leave(db: Session, rid: int) -> Leave | None:
    return db.get(Leave, rid)


def _load_violation(db: Session, rid: int) -> Violation | None:
    return db.get(Violation, rid)


_LOADERS = {
    wt.EVENT_LEAVE_APPROVED: _load_leave,
    wt.EVENT_DUTY_RESUMPTION: _load_leave,
    wt.EVENT_VIOLATION: _load_violation,
}


def _log_row(db, *, employee_id, event_type, record_id, language, phone,
             template, status, provider_msg_id=None, error=None, sent_by=None):
    row = WhatsAppMessage(
        employee_id=employee_id,
        event_type=event_type,
        event_ref=f"{event_type}:{record_id}",
        language=language,
        phone=phone or "",
        template=template or "",
        status=status,
        provider_msg_id=provider_msg_id,
        error=error,
        sent_by=sent_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def send_for_event(
    db: Session, event_type: str, record_id: int, sent_by: int | None
) -> WhatsAppMessage:
    cfg = get_settings()
    if not cfg.whatsapp_enabled:
        raise WhatsAppDisabledError("WhatsApp notifications are not enabled")

    loader = _LOADERS.get(event_type)
    if loader is None:
        raise RecordNotFoundError(f"unknown event_type {event_type!r}")
    record = loader(db, record_id)
    if record is None:
        raise RecordNotFoundError(f"{event_type} record {record_id} not found")

    employee: Employee | None = record.employee
    if employee is None:
        raise RecordNotFoundError(f"{event_type} {record_id} has no employee")

    lang = "ar" if (employee.msg_language or "ar") == "ar" else "en"
    phone = normalize_phone(employee.contact, default_cc=cfg.whatsapp_country_code)
    template_name, params = wt.render(event_type, lang, record, employee)

    if phone is None:
        log.info("whatsapp: no valid phone for employee %s", employee.id)
        return _log_row(
            db, employee_id=employee.id, event_type=event_type, record_id=record_id,
            language=lang, phone=None, template=template_name, status="failed",
            error="No valid phone number for this employee", sent_by=sent_by,
        )

    result = whatsapp_client.send_text(phone, template_name, lang, params)
    return _log_row(
        db, employee_id=employee.id, event_type=event_type, record_id=record_id,
        language=lang, phone=phone, template=template_name,
        status="sent" if result.ok else "failed",
        provider_msg_id=result.message_id, error=result.error, sent_by=sent_by,
    )


def last_status(db: Session, event_type: str, record_id: int) -> WhatsAppMessage | None:
    return db.scalar(
        select(WhatsAppMessage)
        .where(WhatsAppMessage.event_ref == f"{event_type}:{record_id}")
        .order_by(WhatsAppMessage.id.desc())
        .limit(1)
    )
