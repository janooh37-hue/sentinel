"""Create pending ledger rows and hand email composition off to Outlook."""

from __future__ import annotations

import email.utils as stdlib_email_utils
import imaplib
import re
import time
from datetime import UTC, date, datetime
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path
from typing import Final, Literal, TypeAlias

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import EmailAccount, LedgerEntry
from app.services import email_service

# Keep in sync with BOOK_REF_SOURCE in frontend/src/lib/smartLinks.ts.
_BOOK_REF_RE = re.compile(r"\b(?:GS|HR|NAT|SC|\d{1,2})-\d{3,4}\b")

HANDOFF_TAG: Final[str] = "outlook-pending"
STALE_TAG: Final[str] = "outlook-stale"
HANDOFF_HEADER: Final[str] = "X-GSSG-Handoff"

HandoffMode: TypeAlias = Literal["mailto", "draft"]
HandoffAttachment: TypeAlias = tuple[str, str | None, bytes]


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
