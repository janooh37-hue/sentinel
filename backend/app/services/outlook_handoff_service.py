"""Create pending ledger rows and hand email composition off to Outlook."""

from __future__ import annotations

import email.utils as stdlib_email_utils
import imaplib
import logging
import re
import time
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage, Message
from email.utils import make_msgid
from pathlib import Path
from typing import Any, Final, Literal, TypeAlias

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.config import get_settings
from app.core.subject import normalise_subject
from app.db.models import Book, EmailAccount, LedgerEntry
from app.services import (
    book_service,
    correspondence_service,
    email_service,
    ledger_service,
)

# Keep in sync with BOOK_REF_SOURCE in frontend/src/lib/smartLinks.ts.
_BOOK_REF_RE = re.compile(r"\b(?:GS|HR|NAT|SC|\d{1,2})-\d{3,4}\b")

HANDOFF_TAG: Final[str] = "outlook-pending"
STALE_TAG: Final[str] = "outlook-stale"
HANDOFF_HEADER: Final[str] = "X-GSSG-Handoff"

HandoffMode: TypeAlias = Literal["mailto", "draft"]
HandoffAttachment: TypeAlias = tuple[str, str | None, bytes]


log = logging.getLogger(__name__)


class HandoffValidationError(ValueError):
    """The handoff request cannot be fulfilled as submitted."""


class HandoffDeliveryError(RuntimeError):
    """Outlook Drafts could not accept the prepared message."""


def _attachment_content_type(filename: str) -> tuple[str, str]:
    maintype, subtype = "application", "octet-stream"
    ext = Path(filename).suffix.lower()
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}:
        maintype = "image"
        subtype = ext.lstrip(".") if ext != ".jpg" else "jpeg"
    elif ext == ".pdf":
        subtype = "pdf"
    elif ext in {".txt", ".csv", ".md", ".html", ".htm"}:
        maintype = "text"
        subtype = "plain" if ext in {".txt", ".md", ".csv"} else "html"
    return maintype, subtype


def _plain_text(html: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n\n", text, flags=re.IGNORECASE)
    return re.sub(r"<[^>]+>", "", text).strip() or " "


def _is_ok(result: object) -> bool:
    if not isinstance(result, tuple) or not result:
        return False
    status = result[0]
    if isinstance(status, bytes):
        status = status.decode("ascii", errors="ignore")
    return str(status).upper() == "OK"


def _remove_saved_attachments(paths: list[str]) -> None:
    data_dir = get_settings().data_dir.resolve()
    parents: set[Path] = set()
    for rel_path in paths:
        path = (data_dir / rel_path).resolve()
        try:
            path.relative_to(data_dir)
        except ValueError:
            continue
        parents.add(path.parent)
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
    for parent in parents:
        try:
            parent.rmdir()
        except OSError:
            pass


def _append_draft(account: EmailAccount, message: EmailMessage) -> None:
    conn = email_service._connect(account)
    try:
        append_args = (
            account.drafts_folder,
            "(\\Draft)",
            imaplib.Time2Internaldate(time.time()),
            message.as_bytes(),
        )
        if _is_ok(conn.append(*append_args)):
            return
        if not _is_ok(conn.create(account.drafts_folder)):
            raise HandoffDeliveryError("could not create the Outlook Drafts folder")
        if not _is_ok(conn.append(*append_args)):
            raise HandoffDeliveryError("could not append the message to Outlook Drafts")
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def create_handoff(
    db: Session,
    *,
    owner_user_id: int,
    to: list[str],
    cc: list[str],
    subject: str,
    html: str,
    mode: str,
    related_book_id: int | None,
    related_employee_id: str | None,
    in_reply_to: str | None,
    references: str | None,
    use_signature: bool,
    attachments: list[HandoffAttachment],
) -> LedgerEntry:
    """Persist a pending handoff and optionally append its MIME draft to IMAP."""
    if not to:
        raise HandoffValidationError("at least one recipient is required")
    if not subject.strip():
        raise HandoffValidationError("subject is required")
    if mode not in {"mailto", "draft"}:
        raise HandoffValidationError("mode must be 'mailto' or 'draft'")

    account = email_service.get_account(db, owner_user_id=owner_user_id)
    if mode == "draft":
        if account is None:
            raise HandoffValidationError("no email account configured")
        if not account.enabled:
            raise HandoffValidationError("email account is disabled")

    account_domain = (
        email_service._domain_of(account.email) if account is not None else ""
    )
    direction = "outgoing"
    if account_domain:
        recipient_domains = {
            email_service._domain_of(address) for address in [*to, *cc] if address
        }
        if recipient_domains and recipient_domains == {account_domain}:
            direction = "internal"

    final_html = email_service._sanitize_html(html)
    if mode == "draft" and use_signature:
        final_html = email_service._apply_signature(
            final_html, email_service._get_signature(db)
        )

    new_message_id: str | None = None
    if mode == "draft":
        new_message_id = make_msgid(domain=account_domain or None)

    tags = ["email", HANDOFF_TAG]
    if new_message_id is not None:
        tags.append(email_service._msgid_tag(new_message_id))

    entry = LedgerEntry(
        entry_date=date.today(),
        direction=direction,
        channel="email",
        counterparty=to[0][:255],
        subject=subject[:255],
        notes_html=final_html,
        tags=tags,
        attachment_paths=[],
        owner_user_id=owner_user_id,
        to_recipients=[{"name": "", "address": address} for address in to],
        cc_recipients=[{"name": "", "address": address} for address in cc],
        bcc_recipients=[],
        message_id=new_message_id,
        in_reply_to=in_reply_to,
        email_references=references,
        related_book_id=related_book_id,
        related_employee_id=related_employee_id,
        read_at=datetime.now(UTC).replace(tzinfo=None),
    )
    saved_paths: list[str] = []
    try:
        db.add(entry)
        db.flush()

        for filename, _content_type, data in attachments:
            rel_path = email_service._save_email_attachment(entry.id, filename, data)
            if rel_path:
                saved_paths.append(rel_path)
        if saved_paths:
            entry.attachment_paths = saved_paths

        if mode == "draft":
            assert account is not None
            assert new_message_id is not None
            message = EmailMessage()
            message["From"] = account.email
            message["To"] = ", ".join(to)
            if cc:
                message["Cc"] = ", ".join(cc)
            message["Subject"] = subject
            message["Date"] = stdlib_email_utils.formatdate(localtime=True)
            message["Message-ID"] = new_message_id
            if in_reply_to:
                message["In-Reply-To"] = in_reply_to
            if references:
                message["References"] = references
            message[HANDOFF_HEADER] = str(entry.id)
            message.set_content(_plain_text(final_html))
            message.add_alternative(final_html, subtype="html")
            for filename, _content_type, data in attachments:
                maintype, subtype = _attachment_content_type(filename)
                message.add_attachment(
                    data,
                    maintype=maintype,
                    subtype=subtype,
                    filename=email_service._safe_email_filename(filename),
                )
            _append_draft(account, message)

        db.commit()
        db.refresh(entry)
        return entry
    except Exception as exc:
        db.rollback()
        _remove_saved_attachments(saved_paths)
        if isinstance(exc, HandoffDeliveryError):
            raise
        if mode == "draft":
            raise HandoffDeliveryError(
                f"Outlook draft handoff failed: {exc!s}"
            ) from exc
        raise


def _tag_filter(tag: str, param: str, *, negate: bool = False) -> Any:
    keyword = "NOT EXISTS" if negate else "EXISTS"
    return text(
        f"{keyword} (SELECT 1 FROM json_each(ledger_entries.tags) "
        f"WHERE json_each.value = :{param})"
    ).bindparams(**{param: tag})


def _live_pending_by_id(
    db: Session, *, entry_id: int, owner_user_id: int
) -> LedgerEntry | None:
    pending = db.get(LedgerEntry, entry_id)
    if (
        pending is None
        or pending.deleted_at is not None
        or pending.owner_user_id != owner_user_id
        or HANDOFF_TAG not in (pending.tags or [])
    ):
        return None
    return pending


def _find_pending_match(
    db: Session,
    *,
    entry: LedgerEntry,
    msg: Message,
    owner_user_id: int,
) -> LedgerEntry | None:
    raw_handoff_id = msg.get(HANDOFF_HEADER)
    if raw_handoff_id:
        try:
            pending_id = int(str(raw_handoff_id).strip())
        except (TypeError, ValueError):
            pending_id = 0
        if pending_id > 0:
            pending = _live_pending_by_id(
                db, entry_id=pending_id, owner_user_id=owner_user_id
            )
            if pending is not None:
                return pending

    raw_message_id = msg.get("Message-ID")
    if raw_message_id:
        message_id_tag = email_service._msgid_tag(str(raw_message_id))
        pending = db.execute(
            select(LedgerEntry)
            .where(
                LedgerEntry.owner_user_id == owner_user_id,
                LedgerEntry.channel == "email",
                LedgerEntry.deleted_at.is_(None),
                _tag_filter(HANDOFF_TAG, "handoff_exact_tag"),
                _tag_filter(message_id_tag, "handoff_msgid_tag"),
            )
            .order_by(LedgerEntry.created_at.asc(), LedgerEntry.id.asc())
            .limit(1)
        ).scalars().first()
        if pending is not None:
            return pending

    cutoff = entry.entry_date - timedelta(days=14)
    candidates = db.execute(
        select(LedgerEntry)
        .where(
            LedgerEntry.owner_user_id == owner_user_id,
            LedgerEntry.channel == "email",
            LedgerEntry.deleted_at.is_(None),
            LedgerEntry.entry_date >= cutoff,
            _tag_filter(HANDOFF_TAG, "handoff_fallback_tag"),
        )
        .order_by(LedgerEntry.created_at.asc(), LedgerEntry.id.asc())
    ).scalars()
    sent_subject = normalise_subject(entry.subject)
    sent_recipients = {
        str(recipient.get("address", "")).strip().casefold()
        for recipient in (entry.to_recipients or [])
        if isinstance(recipient, dict) and recipient.get("address")
    }
    if not sent_subject or not sent_recipients:
        return None
    for pending in candidates:
        if normalise_subject(pending.subject) != sent_subject:
            continue
        pending_to = pending.to_recipients or []
        if not pending_to or not isinstance(pending_to[0], dict):
            continue
        first_address = str(pending_to[0].get("address", "")).strip().casefold()
        if first_address and first_address in sent_recipients:
            return pending
    return None


def _resolve_book(db: Session, entry: LedgerEntry) -> Book | None:
    if entry.related_book_id is not None:
        try:
            return book_service.get_book(db, entry.related_book_id)
        except NotFoundError:
            return None

    for match in _BOOK_REF_RE.finditer(entry.subject.upper()):
        try:
            return book_service.get_book_by_ref(db, match.group(0).upper())
        except NotFoundError:
            continue
    return None


def reconcile_sent_entry(
    db: Session,
    *,
    entry: LedgerEntry,
    msg: Message,
    account: EmailAccount,
) -> None:
    """Merge a newly imported Sent row with its pending Outlook handoff."""
    owner_user_id = account.owner_user_id
    if (
        owner_user_id is None
        or entry.owner_user_id != owner_user_id
        or entry.channel != "email"
        or entry.direction not in {"outgoing", "internal"}
        or entry.deleted_at is not None
    ):
        return

    pending = _find_pending_match(
        db,
        entry=entry,
        msg=msg,
        owner_user_id=owner_user_id,
    )
    if pending is not None:
        if entry.related_book_id is None:
            entry.related_book_id = pending.related_book_id
        if entry.related_employee_id is None:
            entry.related_employee_id = pending.related_employee_id
        pending.deleted_at = datetime.now(UTC).replace(tzinfo=None)

    book = _resolve_book(db, entry)
    if book is not None:
        if entry.related_book_id is None:
            entry.related_book_id = book.id
        if entry.related_employee_id is None:
            entry.related_employee_id = book.employee_id
        try:
            with db.begin_nested():
                correspondence_service.log_event(
                    db,
                    trigger="email_sent",
                    source_kind="sent_email",
                    source_book_id=book.id,
                    subject=entry.subject,
                    employee_id=book.employee_id,
                    submitter=account.email,
                    entry_date=entry.entry_date,
                    condition_fields={
                        "direction": entry.direction,
                        "category": book.category_id,
                    },
                )
        except Exception:
            log.warning(
                "correspondence auto-log failed for sent ledger entry id=%s",
                entry.id,
                exc_info=True,
            )

    db.commit()


def flag_stale_handoffs(db: Session, *, account: EmailAccount) -> None:
    """Flag pending Outlook handoffs older than 48 hours exactly once."""
    owner_user_id = account.owner_user_id
    if owner_user_id is None:
        return

    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=48)
    stale_entries = db.execute(
        select(LedgerEntry)
        .where(
            LedgerEntry.owner_user_id == owner_user_id,
            LedgerEntry.channel == "email",
            LedgerEntry.deleted_at.is_(None),
            LedgerEntry.created_at < cutoff,
            _tag_filter(HANDOFF_TAG, "stale_handoff_tag"),
            _tag_filter(STALE_TAG, "already_stale_tag", negate=True),
        )
        .order_by(LedgerEntry.created_at.asc(), LedgerEntry.id.asc())
    ).scalars().all()
    if not stale_entries:
        return

    today = date.today()
    for entry in stale_entries:
        ledger_service._upsert_flag(
            db,
            entry_id=entry.id,
            user_id=owner_user_id,
            due=today,
        )
        entry.tags = [*(entry.tags or []), STALE_TAG]
    db.commit()
