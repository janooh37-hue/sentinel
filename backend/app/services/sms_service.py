"""Resolve → send → log an SMS notification for an HR event.

Loads the source record + employee, normalizes the phone (from ``contact``),
resolves the language preference, renders the full SMS text, calls the gateway
client, and persists every attempt to ``sms_messages``. Re-sends are
first-class — each call writes a new row. ``last_status`` powers the badge.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.phone import normalize_phone
from app.db.models import Book, Employee, Leave, SmsMessage, Violation
from app.services import notify_format as nf
from app.services import sms_client, sms_templates

log = logging.getLogger(__name__)


class SmsDisabledError(RuntimeError):
    """Raised when an admin tries to send while SMS is not configured."""


class RecordNotFoundError(LookupError):
    """Raised when the event's source record does not exist."""


def _load_leave(db: Session, rid: int) -> Leave | None:
    return db.get(Leave, rid)


def _load_violation(db: Session, rid: int) -> Violation | None:
    return db.get(Violation, rid)


@dataclass(frozen=True)
class BookEvent:
    """Adapter so book-backed services flow through the same render path as
    Leave/Violation records: exposes the fields the builders read."""

    employee: Employee
    fields: dict
    today: date


def _load_book_event(db: Session, book_id: int) -> BookEvent | None:
    book = db.get(Book, book_id)
    if book is None or not book.versions or book.employee_id is None:
        return None
    employee = db.get(Employee, book.employee_id)
    if employee is None:
        return None
    version = book.versions[-1]  # relationship ordered by version_no ascending
    return BookEvent(employee=employee, fields=version.fields or {}, today=date.today())


_LOADERS = {
    nf.EVENT_LEAVE_APPROVED: _load_leave,
    nf.EVENT_DUTY_RESUMPTION: _load_leave,
    nf.EVENT_VIOLATION: _load_violation,
    **{ev: _load_book_event for ev in nf.BOOK_EVENTS},
}


def _log_row(
    db,
    *,
    employee_id,
    event_type,
    record_id,
    language,
    phone,
    status,
    provider_msg_id=None,
    error=None,
    sent_by=None,
):
    row = SmsMessage(
        employee_id=employee_id,
        event_type=event_type,
        event_ref=f"{event_type}:{record_id}",
        language=language,
        phone=phone or "",
        status=status,
        provider_msg_id=provider_msg_id,
        error=error,
        sent_by=sent_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def send_for_event(db: Session, event_type: str, record_id: int, sent_by: int | None) -> SmsMessage:
    cfg = get_settings()
    if not cfg.sms_enabled:
        raise SmsDisabledError("SMS notifications are not enabled")

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
    phone = normalize_phone(employee.contact, default_cc=cfg.sms_country_code)
    text = sms_templates.render_text(event_type, lang, record, employee)

    if phone is None:
        log.info("sms: no valid phone for employee %s", employee.id)
        return _log_row(
            db,
            employee_id=employee.id,
            event_type=event_type,
            record_id=record_id,
            language=lang,
            phone=None,
            status="failed",
            error="No valid phone number for this employee",
            sent_by=sent_by,
        )

    result = sms_client.send(phone, text)
    return _log_row(
        db,
        employee_id=employee.id,
        event_type=event_type,
        record_id=record_id,
        language=lang,
        phone=phone,
        status="sent" if result.ok else "failed",
        provider_msg_id=result.message_id,
        error=result.error,
        sent_by=sent_by,
    )


def last_status(db: Session, event_type: str, record_id: int) -> SmsMessage | None:
    return db.scalar(
        select(SmsMessage)
        .where(SmsMessage.event_ref == f"{event_type}:{record_id}")
        .order_by(SmsMessage.id.desc())
        .limit(1)
    )
