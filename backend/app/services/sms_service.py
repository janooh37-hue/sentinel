"""Resolve → send → log an SMS notification for an HR event.

Loads the source record + employee, normalizes the phone (from ``contact``),
resolves the language preference, renders the full SMS text, calls the gateway
client, and persists every attempt to ``sms_messages``. Re-sends are
first-class — each call writes a new row. ``last_status`` powers the badge.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core import leave_lifecycle
from app.core.phone import normalize_phone
from app.db.models import Book, Document, Employee, Leave, SmsMessage, Violation
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
    nf.EVENT_LEAVE_REQUESTED: _load_leave,
    nf.EVENT_LEAVE_APPROVED: _load_leave,
    nf.EVENT_LEAVE_REJECTED: _load_leave,
    nf.EVENT_LEAVE_CANCELLED: _load_leave,
    nf.EVENT_DUTY_RESUMPTION: _load_leave,
    nf.EVENT_VIOLATION: _load_violation,
    **{ev: _load_book_event for ev in nf.BOOK_EVENTS},
}

# Leave canonical status → the SMS event that notifies the employee of that step.
# 'Completed' is intentionally absent: the return-to-duty SMS is duty_resumption,
# sent from the leave-return flow, not here.
_LEAVE_STATUS_EVENTS = {
    "Pending": nf.EVENT_LEAVE_REQUESTED,
    "Approved": nf.EVENT_LEAVE_APPROVED,
    "Rejected": nf.EVENT_LEAVE_REJECTED,
    "Cancelled": nf.EVENT_LEAVE_CANCELLED,
}

_TERMINAL_DELIVERY_STATES = {"Delivered", "Failed"}
_DELIVERY_POLL_WINDOW_HOURS = 24


def poll_pending_deliveries(db: Session, *, now: datetime | None = None) -> int:
    """Poll the gateway for the delivery outcome of recent, not-yet-terminal SMS.

    Bounded on purpose: only rows that were accepted by the gateway
    (``provider_msg_id`` present), have not reached a terminal ``delivery_state``,
    and were created within the last 24h. Returns how many rows reached a
    terminal state this pass. No-ops (returns 0) when SMS is disabled.
    """
    if not get_settings().sms_enabled:
        return 0
    now = now or datetime.now(UTC).replace(tzinfo=None)
    cutoff = now - timedelta(hours=_DELIVERY_POLL_WINDOW_HOURS)
    rows = list(
        db.scalars(
            select(SmsMessage).where(
                SmsMessage.provider_msg_id.is_not(None),
                SmsMessage.created_at >= cutoff,
                or_(
                    SmsMessage.delivery_state.is_(None),
                    SmsMessage.delivery_state.not_in(_TERMINAL_DELIVERY_STATES),
                ),
            )
        )
    )
    finalized = 0
    for row in rows:
        assert row.provider_msg_id is not None  # query filters provider_msg_id IS NOT NULL
        result = sms_client.get_delivery(row.provider_msg_id)
        row.delivery_checked_at = now
        if not result.ok:
            continue  # gateway unreachable — retry next tick, leave state as-is
        row.delivery_state = result.state
        row.error = result.error
        if result.state in _TERMINAL_DELIVERY_STATES:
            finalized += 1
    db.commit()
    return finalized


def refresh_delivery(db: Session, sms_id: int) -> SmsMessage | None:
    """On-demand delivery re-check for one message (the manual 're-check now')."""
    row = db.get(SmsMessage, sms_id)
    if row is None:
        return None
    if not row.provider_msg_id:
        return row  # nothing to poll (never accepted by the gateway)
    result = sms_client.get_delivery(row.provider_msg_id)
    row.delivery_checked_at = datetime.now(UTC).replace(tzinfo=None)
    if result.ok:
        row.delivery_state = result.state
        row.error = result.error
    db.commit()
    db.refresh(row)
    return row


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
    body=None,
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
        body=body,
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
            body=text,
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
        body=text,
    )


def _send_leave_status(db: Session, leave_id: int, *, sent_by: int | None) -> SmsMessage | None:
    """Send the SMS matching a leave's current canonical status. No flag checks."""
    leave = db.get(Leave, leave_id)
    if leave is None or leave.employee_id is None:
        return None
    event = _LEAVE_STATUS_EVENTS.get(leave_lifecycle.canonical_status(leave.status))
    if event is None:
        return None
    return send_for_event(db, event, leave_id, sent_by=sent_by)


def _autosend_enabled(db: Session) -> bool:
    from app.services import settings_service

    return bool(get_settings().sms_enabled) and bool(
        settings_service.get_settings(db).sms_autosend_enabled
    )


def auto_send_leave_status(
    db: Session, leave_id: int, *, sent_by: int | None = None
) -> SmsMessage | None:
    """Best-effort SMS for a leave's current status (request/approved/rejected/
    cancelled). No-ops unless SMS + auto-send are enabled and the status maps to
    an event. Called on generation and on every status change."""
    if not _autosend_enabled(db):
        return None
    return _send_leave_status(db, leave_id, sent_by=sent_by)


def auto_send_for_book(
    db: Session, book_id: int, *, sent_by: int | None = None
) -> SmsMessage | None:
    """Best-effort automatic SMS for a freshly-generated service form.

    No-ops (returns None) unless SMS is enabled, auto-send is enabled, the
    book's latest version maps to an SMS event, and the book has an employee.

    Leave/violation forms carry their record on the generated Document (a book id
    is the wrong key for their loaders): route those by the document's leave_id /
    violation_id, and for leave pick the event from its status (a freshly
    generated leave is a *request*).
    """
    if not _autosend_enabled(db):
        return None
    book = db.get(Book, book_id)
    if book is None or not book.versions or book.employee_id is None:
        return None
    version = book.versions[-1]
    tpl = version.template_id or ""
    doc = db.get(Document, version.document_id) if version.document_id else None
    if doc is not None:
        if tpl == "Leave Application Form" and doc.leave_id is not None:
            return _send_leave_status(db, doc.leave_id, sent_by=sent_by)
        if tpl == "Duty Resumption Form" and doc.leave_id is not None:
            return send_for_event(db, nf.EVENT_DUTY_RESUMPTION, doc.leave_id, sent_by=sent_by)
        if tpl == "Violation Form" and doc.violation_id is not None:
            return send_for_event(db, nf.EVENT_VIOLATION, doc.violation_id, sent_by=sent_by)
    event = nf.TEMPLATE_EVENTS.get(tpl)
    if event is None:
        return None
    return send_for_event(db, event, book_id, sent_by=sent_by)


def last_status(db: Session, event_type: str, record_id: int) -> SmsMessage | None:
    return db.scalar(
        select(SmsMessage)
        .where(SmsMessage.event_ref == f"{event_type}:{record_id}")
        .order_by(SmsMessage.id.desc())
        .limit(1)
    )
