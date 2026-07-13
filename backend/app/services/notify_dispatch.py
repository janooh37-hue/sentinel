"""Resolve → route → send → log an outbound notification for an HR event.

The router owns the channel policy: WhatsApp-first via OpenWA; SMS immediately
when the number is not on WhatsApp; when WhatsApp is transiently down, mark the
row ``queued`` and let the retry worker re-attempt for RETRY_WINDOW_MINUTES,
then fall back to SMS as a last resort. Every attempt writes an OutboundMessage.
Loaders + text rendering are shared with the (retired) SMS path via sms_templates.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core import leave_lifecycle
from app.core.phone import normalize_phone
from app.db.models import Book, Document, Employee, Leave, OutboundMessage, Violation
from app.services import notify_format as nf
from app.services import openwa_client, sms_client, sms_templates

log = logging.getLogger(__name__)

RETRY_WINDOW_MINUTES = 5
RETRY_BACKOFF_SECONDS = 30
_TERMINAL_DELIVERY = {"Delivered", "Failed", "delivered", "read", "failed"}
_DELIVERY_POLL_WINDOW_HOURS = 24


class NotifyDisabledError(RuntimeError):
    """Neither channel is configured to send."""


class RecordNotFoundError(LookupError):
    """The event's source record does not exist."""


# ── loaders (moved verbatim from sms_service) ────────────────────────────────


def _load_leave(db: Session, rid: int) -> Leave | None:
    return db.get(Leave, rid)


def _load_violation(db: Session, rid: int) -> Violation | None:
    return db.get(Violation, rid)


@dataclass(frozen=True)
class BookEvent:
    """Adapter so book-backed events flow through the same render path as
    Leave/Violation records: exposes the fields the builders read."""

    employee: Employee
    fields: dict[str, object]
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


_LOADERS: dict[str, Callable[[Session, int], object]] = {
    nf.EVENT_LEAVE_REQUESTED: _load_leave,
    nf.EVENT_LEAVE_APPROVED: _load_leave,
    nf.EVENT_LEAVE_REJECTED: _load_leave,
    nf.EVENT_LEAVE_CANCELLED: _load_leave,
    nf.EVENT_DUTY_RESUMPTION: _load_leave,
    nf.EVENT_VIOLATION: _load_violation,
    **{ev: _load_book_event for ev in nf.BOOK_EVENTS},
}

# Leave canonical status → the notification event for that step.
# 'Completed' is intentionally absent: duty_resumption is sent from the
# leave-return flow, not here.
_LEAVE_STATUS_EVENTS: dict[str, str] = {
    "Pending": nf.EVENT_LEAVE_REQUESTED,
    "Approved": nf.EVENT_LEAVE_APPROVED,
    "Rejected": nf.EVENT_LEAVE_REJECTED,
    "Cancelled": nf.EVENT_LEAVE_CANCELLED,
}


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _log_row(db: Session, **kw: object) -> OutboundMessage:
    row = OutboundMessage(**kw)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _any_channel_enabled(cfg: object) -> bool:
    return bool(getattr(cfg, "openwa_enabled", False) or getattr(cfg, "sms_enabled", False))


def _send_sms(
    db: Session,
    *,
    base: dict[str, object],
    fell_back: bool,
    reason: str | None,
) -> OutboundMessage:
    """Send over SMS and log. ``base`` carries the shared row fields."""
    if not get_settings().sms_enabled:
        return _log_row(
            db,
            **base,
            channel="sms",
            status="failed",
            fell_back=fell_back,
            fallback_reason=reason,
            error="SMS not enabled",
        )
    phone = str(base["phone"])
    body = str(base.get("body") or "")
    result = sms_client.send(phone, body)
    return _log_row(
        db,
        **base,
        channel="sms",
        status="sent" if result.ok else "failed",
        fell_back=fell_back,
        fallback_reason=reason,
        provider_msg_id=result.message_id,
        error=result.error,
    )


def _try_whatsapp(db: Session, *, base: dict[str, object]) -> OutboundMessage:
    """Attempt WhatsApp; queue on transient failure; fall to SMS if not registered."""
    phone = str(base["phone"])
    body = str(base.get("body") or "")
    reg = openwa_client.is_registered(phone)
    if reg is False:
        return _send_sms(db, base=base, fell_back=True, reason="not_on_whatsapp")
    result = openwa_client.send(phone, body)
    if result.ok:
        return _log_row(
            db,
            **base,
            channel="whatsapp",
            status="sent",
            provider_msg_id=result.message_id,
            attempts=1,
        )
    if result.not_registered:
        return _send_sms(db, base=base, fell_back=True, reason="not_on_whatsapp")
    # transient — queue for the retry worker
    return _log_row(
        db,
        **base,
        channel="whatsapp",
        status="queued",
        attempts=1,
        next_retry_at=_now() + timedelta(seconds=RETRY_BACKOFF_SECONDS),
        error=result.error,
    )


def _resolve(db: Session, event_type: str, record_id: int) -> tuple[Employee, str, str | None, str]:
    """Load the record, derive employee/lang/phone/text. Raises RecordNotFoundError."""
    loader = _LOADERS.get(event_type)
    if loader is None:
        raise RecordNotFoundError(f"unknown event_type {event_type!r}")
    record = loader(db, record_id)
    if record is None:
        raise RecordNotFoundError(f"{event_type} record {record_id} not found")
    employee: Employee | None = getattr(record, "employee", None)
    if employee is None:
        raise RecordNotFoundError(f"{event_type} {record_id} has no employee")
    lang = "ar" if (employee.msg_language or "ar") == "ar" else "en"
    phone = normalize_phone(employee.contact, default_cc=get_settings().sms_country_code)
    text: str = sms_templates.render_text(event_type, lang, record, employee)
    return employee, lang, phone, text


def send_for_event(
    db: Session, event_type: str, record_id: int, *, sent_by: int | None
) -> OutboundMessage:
    cfg = get_settings()
    if not _any_channel_enabled(cfg):
        raise NotifyDisabledError("No notification channel is enabled")
    employee, lang, phone, text = _resolve(db, event_type, record_id)
    base: dict[str, object] = dict(
        employee_id=employee.id,
        event_type=event_type,
        event_ref=f"{event_type}:{record_id}",
        language=lang,
        phone=phone or "",
        body=text,
        sent_by=sent_by,
    )
    if phone is None:
        return _log_row(
            db,
            **base,
            channel=None,
            status="failed",
            error="No valid phone number for this employee",
        )
    if cfg.openwa_enabled:
        return _try_whatsapp(db, base=base)
    return _send_sms(db, base=base, fell_back=False, reason=None)


def _send_leave_status(
    db: Session, leave_id: int, *, sent_by: int | None
) -> OutboundMessage | None:
    """Send the notification matching a leave's current canonical status. No flag checks."""
    leave = db.get(Leave, leave_id)
    if leave is None or leave.employee_id is None:
        return None
    event = _LEAVE_STATUS_EVENTS.get(leave_lifecycle.canonical_status(leave.status))
    if event is None:
        return None
    return send_for_event(db, event, leave_id, sent_by=sent_by)


def _autosend_enabled(db: Session) -> bool:
    from app.services import settings_service

    cfg = get_settings()
    return _any_channel_enabled(cfg) and bool(
        settings_service.get_settings(db).sms_autosend_enabled
    )


def auto_send_leave_status(
    db: Session, leave_id: int, *, sent_by: int | None = None
) -> OutboundMessage | None:
    """Best-effort notification for a leave's current status (request/approved/rejected/
    cancelled). No-ops unless a channel + auto-send are enabled and the status maps to
    an event. Called on generation and on every status change."""
    if not _autosend_enabled(db):
        return None
    return _send_leave_status(db, leave_id, sent_by=sent_by)


def auto_send_for_book(
    db: Session, book_id: int, *, sent_by: int | None = None
) -> OutboundMessage | None:
    """Best-effort automatic notification for a freshly-generated service form.

    No-ops (returns None) unless a channel is enabled, auto-send is enabled, the
    book's latest version maps to an event, and the book has an employee.

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


def retry_queued(db: Session, *, now: datetime | None = None) -> int:
    """Re-attempt WhatsApp for queued rows; fall to SMS once the window expires."""
    now = now or _now()
    window_start = now - timedelta(minutes=RETRY_WINDOW_MINUTES)
    rows = list(
        db.scalars(
            select(OutboundMessage).where(
                OutboundMessage.status == "queued",
                OutboundMessage.channel == "whatsapp",
                or_(
                    OutboundMessage.next_retry_at.is_(None),
                    OutboundMessage.next_retry_at <= now,
                    # Window-expired rows must be finalized regardless of next_retry_at
                    OutboundMessage.created_at <= window_start,
                ),
            )
        )
    )
    finalized = 0
    for row in rows:
        if row.created_at <= window_start:
            # last resort: SMS
            if get_settings().sms_enabled:
                result = sms_client.send(row.phone, row.body or "")
                row.channel = "sms"
                row.status = "sent" if result.ok else "failed"
                row.provider_msg_id = result.message_id
                row.error = result.error
            else:
                row.status = "failed"
                row.error = "WhatsApp unrecoverable; SMS not enabled"
            row.fell_back = True
            row.fallback_reason = "whatsapp_unrecoverable"
            finalized += 1
            continue
        result_wa = openwa_client.send(row.phone, row.body or "")
        row.attempts += 1
        if result_wa.ok:
            row.status = "sent"
            row.provider_msg_id = result_wa.message_id
            row.error = None
            finalized += 1
        elif result_wa.not_registered:
            if get_settings().sms_enabled:
                sres = sms_client.send(row.phone, row.body or "")
                row.channel = "sms"
                row.status = "sent" if sres.ok else "failed"
                row.provider_msg_id = sres.message_id
                row.error = sres.error
            else:
                row.status = "failed"
            row.fell_back = True
            row.fallback_reason = "not_on_whatsapp"
            finalized += 1
        else:
            row.next_retry_at = now + timedelta(seconds=RETRY_BACKOFF_SECONDS)
            row.error = result_wa.error
    db.commit()
    return finalized


def poll_deliveries(db: Session, *, now: datetime | None = None) -> int:
    """Channel-aware delivery poll for accepted, non-terminal, recent rows."""
    now = now or _now()
    cutoff = now - timedelta(hours=_DELIVERY_POLL_WINDOW_HOURS)
    rows = list(
        db.scalars(
            select(OutboundMessage).where(
                OutboundMessage.provider_msg_id.is_not(None),
                OutboundMessage.status == "sent",
                OutboundMessage.created_at >= cutoff,
                or_(
                    OutboundMessage.delivery_state.is_(None),
                    OutboundMessage.delivery_state.not_in(_TERMINAL_DELIVERY),
                ),
            )
        )
    )
    finalized = 0
    for row in rows:
        assert row.provider_msg_id is not None  # query ensures provider_msg_id IS NOT NULL
        if row.channel == "sms":
            res = sms_client.get_delivery(row.provider_msg_id)
            state: str | None = res.state
        else:
            res_wa = openwa_client.get_ack(row.provider_msg_id)
            state = res_wa.state
            res = res_wa  # type: ignore[assignment]
        row.delivery_checked_at = now
        if not res.ok:
            continue
        row.delivery_state = state
        if state in _TERMINAL_DELIVERY:
            finalized += 1
    db.commit()
    return finalized


def refresh_delivery(db: Session, msg_id: int) -> OutboundMessage | None:
    """On-demand delivery re-check for one message (the manual 're-check now')."""
    row = db.get(OutboundMessage, msg_id)
    if row is None:
        return None
    if not row.provider_msg_id:
        return row  # nothing to poll (never accepted by the gateway)
    if row.channel == "sms":
        res_sms = sms_client.get_delivery(row.provider_msg_id)
        row.delivery_checked_at = _now()
        if res_sms.ok:
            row.delivery_state = res_sms.state
    else:
        res_wa = openwa_client.get_ack(row.provider_msg_id)
        row.delivery_checked_at = _now()
        if res_wa.ok:
            row.delivery_state = res_wa.state
    db.commit()
    db.refresh(row)
    return row


def last_status(db: Session, event_type: str, record_id: int) -> OutboundMessage | None:
    return db.scalar(
        select(OutboundMessage)
        .where(OutboundMessage.event_ref == f"{event_type}:{record_id}")
        .order_by(OutboundMessage.id.desc())
        .limit(1)
    )
