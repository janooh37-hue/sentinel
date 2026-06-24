"""Email account + IMAP sync service.

Single-row account at ``EmailAccount.id == 1``. ``sync_now()`` connects to
the configured IMAP server, fetches inbox + sent-folder messages (since the
last successful sync, or last 30 days on first run), parses them, and
inserts one ``LedgerEntry`` per message. Message-Id is appended as a tag
(prefixed ``msgid:``) so re-running sync is idempotent.

Direction inference:
    INBOX folder      → incoming
    Sent folder       → outgoing
    Anything else     → internal

Counterparty is the From: address (incoming) or first To: address (outgoing).
Subject is mapped 1:1. Body is converted to HTML for ``notes_html`` (text
emails get ``<pre>`` wrapping; HTML emails are inserted as-is).
"""

from __future__ import annotations

import email as stdlib_email
import imaplib
import logging
import re
import smtplib
import ssl
import threading
from datetime import UTC, date, datetime, timedelta
from email.header import decode_header, make_header
from email.message import EmailMessage, Message
from email.utils import getaddresses, make_msgid, parsedate_to_datetime
from pathlib import Path
from typing import Final

import nh3
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core import crypto
from app.db.models import EmailAccount, LedgerEntry
from app.schemas.email import (
    EmailAccountUpsert,
    EmailSendRequest,
    EmailSendResult,
    EmailSyncResult,
    EmailSyncStatus,
)

log = logging.getLogger(__name__)

# Serialise IMAP sync runs across ALL users: a manual POST /email/sync and the
# scheduled tick must never overlap (concurrent IMAP fetch + per-row commits race
# on SQLite). NOTE (Phase 3): this is GLOBAL, so one user's sync briefly blocks
# another's — acceptable for the small HR team (syncs are short; a refused manual
# sync raises SyncInProgressError → the UI retries on the next poll). Do not
# re-architect into per-account locks unless syncs visibly queue.
_SYNC_LOCK = threading.Lock()


class SyncInProgressError(RuntimeError):
    """Raised when a sync is requested while another sync holds the lock."""


# ─── Email attachments ──────────────────────────────────────────────────────

# Wider than ledger_service.ALLOWED_DOC_EXTS — emails routinely carry common
# Office and archive types. Executables are excluded.
EMAIL_ATTACHMENT_ALLOWED_EXTS: Final[frozenset[str]] = frozenset({
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".heic",
    ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".odt", ".ods",
    ".txt", ".csv", ".rtf", ".md",
    ".zip", ".7z", ".rar", ".tar", ".gz", ".tgz",
    ".eml", ".msg", ".ics", ".vcf",
    ".html", ".htm", ".xml", ".json",
})
EMAIL_ATTACHMENT_MAX_BYTES: Final[int] = 25 * 1024 * 1024  # 25 MiB


# Inbound email HTML is rendered in the ledger UI — sanitise it before storing
# to ``notes_html`` so a hostile sender can't land stored XSS. nh3 (ammonia,
# rust) drops <script>/<style>, event handlers, and javascript:/data: URLs while
# keeping common formatting, links, and images.
_ALLOWED_HTML_TAGS: Final[set[str]] = nh3.ALLOWED_TAGS | {
    "img", "span", "div", "pre", "table", "thead", "tbody", "tr", "td", "th",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "font",
}
_ALLOWED_HTML_ATTRS: Final[dict[str, set[str]]] = {
    **nh3.ALLOWED_ATTRIBUTES,
    "img": {"src", "alt", "title", "width", "height"},
    "*": {"style", "align", "dir"},
}
# ``cid:`` keeps Outlook inline images working (resolved via inline_images map);
# ``data:`` allows inlined image payloads. ``javascript:``/``vbscript:`` excluded.
_ALLOWED_URL_SCHEMES: Final[set[str]] = {"http", "https", "mailto", "cid", "data"}


def _sanitize_html(raw: str) -> str:
    """Strip scripts/handlers/unsafe URLs from inbound email HTML."""
    return nh3.clean(
        raw,
        tags=_ALLOWED_HTML_TAGS,
        attributes=_ALLOWED_HTML_ATTRS,
        url_schemes=_ALLOWED_URL_SCHEMES,
    )


# Unicode bidi-control, zero-width and BOM codepoints — stripped explicitly so
# a malicious attachment name can't display-spoof (e.g. U+202E RIGHT-TO-LEFT
# OVERRIDE) even if the alnum allow-list below is ever widened.
_BIDI_ZW = "".join(
    chr(cp)
    for cp in (
        *range(0x200B, 0x2010),  # ZWSP..RLM (U+200B..U+200F)
        *range(0x202A, 0x202F),  # LRE..RLO (U+202A..U+202E)
        *range(0x2066, 0x206A),  # isolates (U+2066..U+2069)
        0xFEFF,                  # BOM / ZWNBSP
    )
)


def _safe_email_filename(raw: str) -> str:
    """Strip path separators and dangerous chars. Empty -> 'attachment'."""
    raw = "".join(c for c in raw if c not in _BIDI_ZW)
    cleaned = "".join(c for c in raw if c.isalnum() or c in "._- ()[]+").strip()
    if not cleaned or cleaned.startswith("."):
        return "attachment"
    return cleaned[:200]


def _save_email_attachment(entry_id: int, filename: str, data: bytes) -> str | None:
    """Write a single attachment under
    ``data_dir/ledger_attachments/<entry_id>/`` with collision-safe naming.

    Returns the path relative to ``data_dir`` (matches the ledger_attachments
    convention) or None when the part is rejected.
    """
    if len(data) == 0 or len(data) > EMAIL_ATTACHMENT_MAX_BYTES:
        return None
    safe = _safe_email_filename(filename)
    ext = Path(safe).suffix.lower()
    if ext not in EMAIL_ATTACHMENT_ALLOWED_EXTS:
        return None
    data_dir = get_settings().data_dir.resolve()
    target_dir = data_dir / "ledger_attachments" / str(entry_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / safe
    n = 1
    while dest.exists():
        dest = target_dir / f"{Path(safe).stem}_{n}{ext}"
        n += 1
    dest.write_bytes(data)
    return dest.resolve().relative_to(data_dir).as_posix()


def _extract_attachments(msg: Message) -> list[tuple[str, bytes, str | None]]:
    """Pull every part flagged Content-Disposition: attachment (and any
    inline non-text part with a filename — IONOS-style image attachments).

    Each tuple is ``(filename, raw_bytes, content_id_or_None)``. ``content_id``
    is stripped of the surrounding ``<>`` so callers can key a cid → path map
    directly off the value.
    """
    out: list[tuple[str, bytes, str | None]] = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        disp = (part.get_content_disposition() or "").lower()
        filename = part.get_filename()
        if filename:
            filename = _decode(filename)
        ctype = part.get_content_type()
        is_attachment = disp == "attachment" or (filename and not ctype.startswith("text/"))
        if not is_attachment or not filename:
            continue
        payload = part.get_payload(decode=True)
        if not payload or not isinstance(payload, bytes):
            continue
        raw_cid = part.get("Content-ID")
        content_id = raw_cid.strip().strip("<>") if raw_cid else None
        out.append((filename, payload, content_id or None))
    return out


def _save_and_enqueue_attachments(
    db: Session,
    *,
    entry_id: int,
    msg: Message,
    direction: str,
    owner_user_id: int | None,
) -> tuple[list[str], dict[str, str]]:
    """Save every attachment of *msg* under the entry's folder and, for INCOMING
    mail, queue each real document attachment into the Scan Inbox (inline cid
    signature/logo images and non-document types are filtered inside
    ``enqueue_email_attachment``). Returns ``(saved_paths, cid_map)`` — the same
    pair the new-mail and backfill loops previously built inline."""
    from app.services import scan_inbox_service

    saved_paths: list[str] = []
    cid_map: dict[str, str] = {}
    for fname, blob, cid in _extract_attachments(msg):
        rel = _save_email_attachment(entry_id, fname, blob)
        if not rel:
            continue
        saved_paths.append(rel)
        if cid:
            cid_map[cid] = rel
        if direction == "incoming":
            scan_inbox_service.enqueue_email_attachment(
                db,
                ledger_entry_id=entry_id,
                owner_user_id=owner_user_id,
                rel_path=rel,
                filename=fname,
                data=blob,
                is_inline=cid is not None,
            )
    return saved_paths, cid_map


INITIAL_LOOKBACK_DAYS: Final[int] = 14
SIGNATURE_MARKER: Final[str] = "<!-- gssg-signature -->"


def _get_signature(db: Session) -> str:
    """Read the operator's HTML email signature from AppSetting."""
    import json

    from app.db.models import AppSetting

    row = db.execute(
        select(AppSetting).where(AppSetting.key == "settings.email_signature")
    ).scalar_one_or_none()
    if row is None:
        return ""
    try:
        value = json.loads(row.value)
    except (TypeError, ValueError):
        return ""
    return value if isinstance(value, str) else ""


def _apply_signature(html: str, signature: str) -> str:
    """Append ``signature`` wrapped in the marker comment when it isn't
    already present in ``html`` (idempotent on reply/forward)."""
    if not signature.strip():
        return html
    if SIGNATURE_MARKER in html:
        return html
    return f"{html}{SIGNATURE_MARKER}<br><div data-gssg-signature>{signature}</div>{SIGNATURE_MARKER}"
# Per-folder cap. IMAP latency is ~100 ms RTT; even with bulk fetch a few
# hundred messages each carrying attachments will blow past the HTTP client
# timeout. Keep it tight — operators can re-run "Sync now" if the mailbox is
# busy and the next run will pick up from ``last_synced_at``.
PER_SYNC_FETCH_LIMIT: Final[int] = 50
# Number of messages to bundle into a single IMAP FETCH command. Servers
# generally accept comma-joined UID lists; we still chunk so memory stays
# bounded for very long lists.
FETCH_CHUNK: Final[int] = 25


# ─── Account CRUD ───────────────────────────────────────────────────────────


def get_account(db: Session, owner_user_id: int | None = None) -> EmailAccount | None:
    """Resolve an EmailAccount.

    Pass ``owner_user_id`` for every USER-FACING path — each user owns their own
    mailbox row. The owner-less branch (``owner_user_id is None``) is a fallback
    for **owner-agnostic internal callers only** (e.g. correspondence-log hooks
    that have no user context); it returns the lowest-id row so single-account
    installs still work. Do NOT call the owner-less form from an HTTP handler that
    has a ``current_user`` — that was the source of the multi-user send bug.
    """
    stmt = select(EmailAccount)
    if owner_user_id is not None:
        stmt = stmt.where(EmailAccount.owner_user_id == owner_user_id)
    else:
        stmt = stmt.order_by(EmailAccount.id.asc())
    return db.execute(stmt).scalars().first()


def upsert_account(
    db: Session, payload: EmailAccountUpsert, owner_user_id: int | None = None
) -> EmailAccount:
    existing = get_account(db, owner_user_id)
    now = datetime.now(UTC).replace(tzinfo=None)

    if existing is None:
        if not payload.password:
            raise ValueError("password is required when creating the email account")
        row = EmailAccount(
            email=payload.email,
            imap_host=payload.imap_host,
            imap_port=payload.imap_port,
            use_ssl=payload.use_ssl,
            username=payload.username,
            password_encrypted=crypto.encrypt(payload.password),
            smtp_host=payload.smtp_host,
            smtp_port=payload.smtp_port,
            smtp_use_tls=payload.smtp_use_tls,
            sent_folder=payload.sent_folder,
            inbox_folder=payload.inbox_folder,
            enabled=payload.enabled,
            sync_interval_minutes=payload.sync_interval_minutes,
            linked_employee_id=payload.linked_employee_id,
            owner_user_id=owner_user_id,
            created_at=now,
        )
        db.add(row)
    else:
        existing.email = payload.email
        existing.imap_host = payload.imap_host
        existing.imap_port = payload.imap_port
        existing.use_ssl = payload.use_ssl
        existing.username = payload.username
        existing.smtp_host = payload.smtp_host
        existing.smtp_port = payload.smtp_port
        existing.smtp_use_tls = payload.smtp_use_tls
        existing.sent_folder = payload.sent_folder
        existing.inbox_folder = payload.inbox_folder
        existing.enabled = payload.enabled
        existing.sync_interval_minutes = payload.sync_interval_minutes
        existing.linked_employee_id = payload.linked_employee_id
        if owner_user_id is not None:
            existing.owner_user_id = owner_user_id
        existing.updated_at = now
        if payload.password:
            existing.password_encrypted = crypto.encrypt(payload.password)
        row = existing

    db.commit()
    db.refresh(row)

    # Identity Phase 14: first employee to be linked auto-claims the admin
    # slot. Helper is idempotent — re-linking the same employee is a no-op.
    if row.linked_employee_id:
        # Local import avoids a circular dependency: identity_service imports
        # from app.db.models, which transitively touches email-shaped types.
        from app.services import identity_service

        identity_service.promote_to_admin_if_vacant(db, row.linked_employee_id)

    return row


def delete_account(db: Session, owner_user_id: int | None = None) -> None:
    existing = get_account(db, owner_user_id)
    if existing is None:
        return
    db.delete(existing)
    db.commit()


# ─── Connection / test ──────────────────────────────────────────────────────


def _connect(account: EmailAccount) -> imaplib.IMAP4:
    if account.use_ssl:
        ctx = ssl.create_default_context()
        conn: imaplib.IMAP4 = imaplib.IMAP4_SSL(
            account.imap_host, account.imap_port, ssl_context=ctx, timeout=30
        )
    else:
        conn = imaplib.IMAP4(account.imap_host, account.imap_port, timeout=30)
    password = crypto.decrypt(account.password_encrypted)
    conn.login(account.username, password)
    return conn




def test_connection(account: EmailAccount) -> None:
    """Raises on failure; returns None on success."""
    conn = _connect(account)
    try:
        conn.noop()
    finally:
        try:
            conn.logout()
        except Exception:
            pass


# ─── SMTP send ─────────────────────────────────────────────────────────────


def send_email(
    db: Session,
    payload: EmailSendRequest,
    *,
    owner_user_id: int,
    attachments: list[tuple[str, bytes]] | None = None,
) -> EmailSendResult:
    """Send an email via SMTP using the caller's own account, then record a
    ledger entry with direction=outgoing (or internal when both ends are in
    the operator's domain) so the message shows up immediately.

    ``owner_user_id`` is required and keyword-only — it identifies the sending
    user. The ledger entry is stamped with the same owner so the message
    appears in **their** mailbox, not the lowest-id account.

    ``attachments`` is a list of ``(filename, bytes)`` pairs to attach to
    both the MIME message and the resulting ledger entry's vault."""
    attachments = attachments or []
    account = get_account(db, owner_user_id=owner_user_id)
    if account is None:
        raise ValueError("no email account configured")
    if not account.enabled:
        raise ValueError("email account is disabled")

    if not payload.to:
        raise ValueError("at least one recipient is required")
    if not payload.subject.strip():
        raise ValueError("subject is required")

    password = crypto.decrypt(account.password_encrypted)
    account_domain = _domain_of(account.email)

    final_html = payload.html
    if payload.use_signature:
        final_html = _apply_signature(final_html, _get_signature(db))

    # Build the multipart message. We emit both HTML and a plain-text fallback.
    msg = EmailMessage()
    msg["From"] = account.email
    msg["To"] = ", ".join(payload.to)
    if payload.cc:
        msg["Cc"] = ", ".join(payload.cc)
    msg["Subject"] = payload.subject
    msg["Date"] = stdlib_email.utils.formatdate(localtime=True)
    new_msg_id = make_msgid(domain=account_domain or None)
    msg["Message-ID"] = new_msg_id
    if payload.in_reply_to:
        msg["In-Reply-To"] = payload.in_reply_to
    if payload.references:
        msg["References"] = payload.references

    # Plain-text fallback: strip tags very loosely.
    text_fallback = re.sub(r"<br\s*/?>", "\n", final_html, flags=re.IGNORECASE)
    text_fallback = re.sub(r"</p>", "\n\n", text_fallback, flags=re.IGNORECASE)
    text_fallback = re.sub(r"<[^>]+>", "", text_fallback).strip()
    msg.set_content(text_fallback or " ")
    msg.add_alternative(final_html, subtype="html")

    # Attachments
    for fname, data in attachments:
        maintype, subtype = "application", "octet-stream"
        ext = Path(fname).suffix.lower()
        if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}:
            maintype = "image"
            subtype = ext.lstrip(".") if ext != ".jpg" else "jpeg"
        elif ext == ".pdf":
            subtype = "pdf"
        elif ext in {".txt", ".csv", ".md", ".html", ".htm"}:
            maintype = "text"
            subtype = "plain" if ext in {".txt", ".md", ".csv"} else "html"
        msg.add_attachment(
            data, maintype=maintype, subtype=subtype, filename=_safe_email_filename(fname)
        )

    # Hand off to SMTP.
    if account.smtp_use_tls:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(account.smtp_host, account.smtp_port, timeout=30) as smtp:
            smtp.ehlo()
            smtp.starttls(context=ctx)
            smtp.ehlo()
            smtp.login(account.username, password)
            smtp.send_message(msg)
    else:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(
            account.smtp_host, account.smtp_port, timeout=30, context=ctx
        ) as smtp:
            smtp.login(account.username, password)
            smtp.send_message(msg)

    # Persist as a ledger entry so the user sees it immediately. Subsequent
    # IMAP sync from Sent folder will dedup via the Message-Id tag.
    direction = "outgoing"
    if account_domain:
        recipient_addrs = payload.to + payload.cc
        recipient_domains = {_domain_of(a) for a in recipient_addrs if a}
        if recipient_domains and recipient_domains == {account_domain}:
            direction = "internal"

    counterparty = payload.to[0] if payload.to else "(unknown)"
    entry = LedgerEntry(
        entry_date=date.today(),
        direction=direction,
        channel="email",
        counterparty=counterparty[:256],
        subject=payload.subject[:256],
        notes_html=final_html,
        tags=["email", "sent-from-app", _msgid_tag(new_msg_id)],
        attachment_paths=[],
        owner_user_id=account.owner_user_id,
        to_recipients=[{"name": "", "address": a} for a in payload.to],
        cc_recipients=[{"name": "", "address": a} for a in payload.cc],
        bcc_recipients=[],
        message_id=new_msg_id,
        in_reply_to=payload.in_reply_to,
        email_references=payload.references,
        # We authored & sent it — never "unread" (also keeps internal-sent mail
        # out of the unread badge, which now counts internal as received).
        read_at=datetime.now(UTC).replace(tzinfo=None),
    )
    db.add(entry)
    db.flush()  # need entry.id to name the attachment folder

    saved_paths: list[str] = []
    for fname, data in attachments:
        rel = _save_email_attachment(entry.id, fname, data)
        if rel:
            saved_paths.append(rel)
    if saved_paths:
        entry.attachment_paths = saved_paths

    # ── Phase 3: optional shared Correspondence Log row (default rule OFF). ──
    try:
        from app.services import correspondence_service

        correspondence_service.log_event(
            db,
            trigger="email_sent",
            source_kind="sent_email",
            source_book_id=None,
            subject=payload.subject[:255],
            employee_id=None,
            submitter=None,
            entry_date=date.today(),
            condition_fields={"direction": direction},
            direction="outgoing",
        )
    except Exception:
        log.warning("correspondence auto-log failed on email send", exc_info=True)

    db.commit()
    db.refresh(entry)

    return EmailSendResult(sent=True, message_id=new_msg_id, ledger_entry_id=entry.id)


# ─── Sync ───────────────────────────────────────────────────────────────────


def _decode(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _first_address(value: str | None) -> str:
    """Return the bare email address from a To/From-style header.

    Falls back to the display name only when the parsed address is empty,
    so identical senders dedupe correctly across IONOS reply chains
    (where the display name varies, but the address doesn't).
    """
    if not value:
        return ""
    parsed = getaddresses([value])
    if not parsed:
        return ""
    name, addr = parsed[0]
    return addr or _decode(name) or ""


def _all_addresses(value: str | None) -> list[str]:
    """Return every email address in a To/Cc/From header (no display names)."""
    if not value:
        return []
    return [addr for _, addr in getaddresses([value]) if addr]


def _recipient_list(value: str | None) -> list[dict[str, str]]:
    """Parse a To/Cc-style header into ``[{"name", "address"}]`` items.

    Display names are MIME-decoded; entries without an address are dropped so
    the JSON column only carries real recipients.
    """
    if not value:
        return []
    out: list[dict[str, str]] = []
    for raw_name, addr in getaddresses([value]):
        if not addr:
            continue
        out.append({"name": _decode(raw_name), "address": addr})
    return out


def _apply_recipient_backfill(row: LedgerEntry, msg: Message) -> bool:
    """Populate empty recipient/message-id columns on an already-imported row.

    Returns True when anything changed (so the caller knows to commit). Never
    overwrites already-populated columns — a re-sync is idempotent.
    """
    changed = False
    if not row.to_recipients:
        to = _recipient_list(msg.get("To"))
        if to:
            row.to_recipients = to
            changed = True
    if not row.cc_recipients:
        cc = _recipient_list(msg.get("Cc"))
        if cc:
            row.cc_recipients = cc
            changed = True
    if row.message_id is None:
        mid = (msg.get("Message-ID") or "").strip() or None
        if mid:
            row.message_id = mid
            changed = True
    if row.in_reply_to is None:
        irt = (msg.get("In-Reply-To") or "").strip() or None
        if irt:
            row.in_reply_to = irt
            changed = True
    if row.email_references is None:
        refs = (msg.get("References") or "").strip() or None
        if refs:
            row.email_references = refs
            changed = True
    return changed


def _domain_of(addr: str) -> str:
    if "@" not in addr:
        return ""
    return addr.rsplit("@", 1)[1].strip().lower()


def _is_internal(msg: Message, account_domain: str) -> bool:
    """An email is *internal* when every visible address (from, to, cc)
    lives in the operator's own domain (e.g. all @gssg.ae)."""
    if not account_domain:
        return False
    addresses = (
        _all_addresses(msg.get("From"))
        + _all_addresses(msg.get("To"))
        + _all_addresses(msg.get("Cc"))
    )
    if not addresses:
        return False
    return all(_domain_of(a) == account_domain for a in addresses)


def _extract_body(msg: Message) -> tuple[str, bool]:
    """Return (text, is_html). Prefers text/html, falls back to text/plain."""
    if msg.is_multipart():
        html_part: Message | None = None
        text_part: Message | None = None
        for part in msg.walk():
            ctype = part.get_content_type()
            if part.get_content_disposition() == "attachment":
                continue
            if ctype == "text/html" and html_part is None:
                html_part = part
            elif ctype == "text/plain" and text_part is None:
                text_part = part
        chosen = html_part or text_part
        if chosen is None:
            return "", False
        payload = chosen.get_payload(decode=True)
        if payload is None:
            return "", False
        charset = chosen.get_content_charset() or "utf-8"
        try:
            text = payload.decode(charset, errors="replace")
        except (LookupError, UnicodeDecodeError):
            text = payload.decode("utf-8", errors="replace")
        return text, chosen.get_content_type() == "text/html"

    payload = msg.get_payload(decode=True)
    if payload is None:
        return "", False
    charset = msg.get_content_charset() or "utf-8"
    try:
        text = payload.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        text = payload.decode("utf-8", errors="replace")
    return text, msg.get_content_type() == "text/html"


_MSG_ID_TAG_PREFIX = "msgid:"


def _msgid_tag(msg_id: str) -> str:
    # Strip surrounding <...> if present and limit length.
    cleaned = msg_id.strip().strip("<>")[:160]
    return f"{_MSG_ID_TAG_PREFIX}{cleaned}"


def _existing_msgids(db: Session) -> dict[str, tuple[int, int]]:
    """Map ``msgid_tag → (entry_id, current_attachment_count)``.

    Used both for dedup (presence check) and for cheap attachment backfill
    (an entry with 0 attachments on a re-sync gets its attachments populated
    even though we skip re-inserting the row).
    """
    rows = db.execute(
        select(LedgerEntry.id, LedgerEntry.tags, LedgerEntry.attachment_paths)
        .where(LedgerEntry.channel == "email")
        .where(LedgerEntry.deleted_at.is_(None))
    ).all()
    out: dict[str, tuple[int, int]] = {}
    for entry_id, tags, paths in rows:
        if not tags:
            continue
        att_count = len(paths or [])
        for tag in tags:
            if isinstance(tag, str) and tag.startswith(_MSG_ID_TAG_PREFIX):
                out[tag] = (entry_id, att_count)
    return out


# ─── Folder discovery (with subfolders) ─────────────────────────────────────

# IMAP LIST line shape: (flags) "delim" "name"   — names may be quoted or
# bare; delimiter is usually "/" on most servers and "." on some.
_LIST_PATTERN = re.compile(
    r'^\((?P<flags>[^)]*)\)\s+'
    r'(?P<delim>"(?:[^"\\]|\\.)*"|NIL|\S+)\s+'
    r'(?P<name>"(?:[^"\\]|\\.)*"|\S+)\s*$'
)


def _unquote(token: str) -> str:
    if token.startswith('"') and token.endswith('"'):
        return token[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    return token


def _parse_list_line(line: str) -> tuple[str, str, str] | None:
    """Returns (name, flags_lower, delim) or None when the line isn't parseable."""
    m = _LIST_PATTERN.match(line.strip())
    if not m:
        return None
    name = _unquote(m.group("name"))
    delim = _unquote(m.group("delim"))
    if delim.upper() == "NIL":
        delim = ""
    return name, m.group("flags").lower(), delim


def _discover_folders(
    conn: imaplib.IMAP4, root: str
) -> list[str]:
    """All selectable folders == ``root`` or under ``root``/<sub>.

    Tolerates servers where the delimiter is "." instead of "/". Skips any
    folder flagged ``\\Noselect`` (placeholder nodes).
    """
    typ, data = conn.list()
    if typ != "OK" or not data:
        return [root]
    matches: list[str] = []
    for raw in data:
        if raw is None:
            continue
        line = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
        parsed = _parse_list_line(line)
        if parsed is None:
            continue
        name, flags, delim = parsed
        if "\\noselect" in flags:
            continue
        if name == root:
            matches.append(name)
            continue
        if delim and name.startswith(root + delim):
            matches.append(name)
    # Stable order: root first, then deepest-last for predictability.
    seen: set[str] = set()
    out: list[str] = []
    if root in matches:
        out.append(root)
        seen.add(root)
    for n in matches:
        if n in seen:
            continue
        seen.add(n)
        out.append(n)
    return out or [root]


def _fetch_folder(
    conn: imaplib.IMAP4,
    folder: str,
    since: datetime,
) -> tuple[list[tuple[bytes, Message]], int]:
    """Returns ``([(uid, parsed_message)], pending)`` from ``folder`` since ``since``.

    Bulk-fetches up to ``PER_SYNC_FETCH_LIMIT`` messages in ``FETCH_CHUNK``-
    sized batches so we make ~2 round trips for 50 messages instead of 50.
    ``pending`` is the number of matching messages left un-fetched because the
    per-sync limit truncated this folder (0 when nothing was dropped).
    """
    # Folder names with spaces (e.g. "Sent Items") must be wrapped in quotes
    # over the wire; imaplib doesn't auto-quote.
    selectable = f'"{folder}"' if " " in folder else folder
    typ, _ = conn.select(selectable, readonly=True)
    if typ != "OK":
        return [], 0
    date_str = since.strftime("%d-%b-%Y")
    typ, data = conn.search(None, f"(SINCE {date_str})")
    if typ != "OK" or not data or not data[0]:
        return [], 0
    all_ids = data[0].split()
    pending = max(0, len(all_ids) - PER_SYNC_FETCH_LIMIT)
    ids = all_ids[-PER_SYNC_FETCH_LIMIT:]
    if not ids:
        return [], 0
    out: list[tuple[bytes, Message]] = []
    for i in range(0, len(ids), FETCH_CHUNK):
        chunk = ids[i : i + FETCH_CHUNK]
        # IMAP FETCH accepts comma-separated UID list — one round trip per chunk.
        id_set = b",".join(chunk).decode("ascii")
        typ, payload = conn.fetch(id_set, "(RFC822)")
        if typ != "OK" or not payload:
            continue
        # Walk the response. Each message is a tuple (header_line, raw_bytes);
        # closing ')' tokens come between as plain bytes — skip them.
        idx = 0
        for item in payload:
            if not isinstance(item, tuple) or not item[1]:
                continue
            raw = item[1]
            try:
                msg = stdlib_email.message_from_bytes(raw)
            except Exception:
                idx += 1
                continue
            # Best-effort UID — fall back to ordinal when the FETCH response
            # doesn't include the explicit UID field.
            uid = chunk[idx] if idx < len(chunk) else b"?"
            out.append((uid, msg))
            idx += 1
    return out, pending


def _build_entry(
    msg: Message,
    *,
    direction: str,
    msg_id_tag: str,
    account_domain: str = "",
    owner_user_id: int | None = None,
) -> LedgerEntry:
    # Capture the SOURCE folder before the internal-promotion overwrites it:
    # mail from the Sent folder (direction=="outgoing") was authored by us, so it
    # is born read — even after it's promoted to "internal" (intra-office sent
    # mail). Only Inbox mail (incoming + internal-RECEIVED) stays unread. This is
    # how we tell internal-sent from internal-received, which direction alone
    # can't (see ledger_service.list_entries).
    is_sent_folder = direction == "outgoing"
    # Promote to "internal" when every party uses the operator's own domain.
    if direction != "internal" and _is_internal(msg, account_domain):
        direction = "internal"
    subject = _decode(msg.get("Subject")) or "(no subject)"
    from_addr = _first_address(msg.get("From"))
    to_addr = _first_address(msg.get("To"))
    counterparty = from_addr if direction == "incoming" else to_addr or from_addr
    counterparty = counterparty or "(unknown)"

    # Entry date from the Date header, falling back to today. ``entry_date``
    # on ``LedgerEntry`` is a SQLAlchemy ``Date`` column — must be a ``date``
    # object, not an ISO string.
    date_hdr = msg.get("Date")
    parsed: datetime
    if date_hdr:
        try:
            parsed = parsedate_to_datetime(date_hdr)
        except (TypeError, ValueError):
            parsed = datetime.now(UTC)
    else:
        parsed = datetime.now(UTC)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    entry_date_value = parsed.date()

    body, is_html = _extract_body(msg)
    if is_html:
        notes_html = _sanitize_html(body)
    else:
        # Plain text → escape and wrap. Cheap path that avoids importing
        # markdown or html sanitisers for now.
        escaped = (
            body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        )
        notes_html = f"<pre style='white-space:pre-wrap;font-family:inherit;'>{escaped}</pre>"

    raw_msg_id = (msg.get("Message-ID") or "").strip() or None
    raw_in_reply_to = (msg.get("In-Reply-To") or "").strip() or None
    raw_references = (msg.get("References") or "").strip() or None
    to_recipients = _recipient_list(msg.get("To"))
    cc_recipients = _recipient_list(msg.get("Cc"))

    return LedgerEntry(
        entry_date=entry_date_value,
        direction=direction,
        channel="email",
        counterparty=counterparty[:256],
        subject=subject[:256],
        notes_html=notes_html,
        tags=["email", msg_id_tag],
        attachment_paths=[],
        owner_user_id=owner_user_id,
        to_recipients=to_recipients,
        cc_recipients=cc_recipients,
        bcc_recipients=[],
        message_id=raw_msg_id,
        in_reply_to=raw_in_reply_to,
        email_references=raw_references,
        # Sent-folder mail is born read; received mail (Inbox) is born unread.
        read_at=parsed if is_sent_folder else None,
    )


_DEFAULT_SUBJECT_CLEAN = re.compile(r"^\s*(re|fw|fwd|رد|توجيه)\s*:", re.IGNORECASE)


def list_enabled_accounts(db: Session) -> list[EmailAccount]:
    """Every account with ``enabled=True`` — the scheduler iterates these."""
    return list(
        db.execute(
            select(EmailAccount).where(EmailAccount.enabled.is_(True))
        ).scalars()
    )


def sync_now(db: Session, owner_user_id: int | None = None) -> EmailSyncResult:
    """Run a sync for the caller's account, refusing to overlap an in-flight one.

    Non-blocking: if another sync (manual or scheduled) holds ``_SYNC_LOCK``
    we raise ``SyncInProgressError`` rather than queueing behind it.
    """
    if not _SYNC_LOCK.acquire(blocking=False):
        raise SyncInProgressError("a sync is already running")
    try:
        account = get_account(db, owner_user_id)
        if account is None:
            raise ValueError("no email account configured")
        if not account.enabled:
            raise ValueError("email account is disabled")
        return _sync_account_locked(db, account)
    finally:
        _SYNC_LOCK.release()


def get_sync_status(db: Session, owner_user_id: int | None = None) -> EmailSyncStatus:
    """Cheap status read for the Ledger strip — row + lock check, no IMAP."""
    account = get_account(db, owner_user_id)
    if account is None:
        return EmailSyncStatus(
            syncing=_SYNC_LOCK.locked(),
            last_synced_at=None,
            last_sync_error=None,
            enabled=False,
            interval_minutes=0,
        )
    return EmailSyncStatus(
        syncing=_SYNC_LOCK.locked(),
        last_synced_at=account.last_synced_at,
        last_sync_error=account.last_sync_error,
        enabled=bool(account.enabled),
        interval_minutes=int(account.sync_interval_minutes),
    )


def sync_all_accounts(db: Session) -> list[EmailSyncResult]:
    """Sync every enabled account in turn (used by the scheduler).

    Each account is synced under its own owner so the resulting entries carry
    the right ``owner_user_id``. A failure on one account is logged and does not
    abort the others. The ``_SYNC_LOCK`` is acquired once for the whole loop so a
    manual sync still raises ``SyncInProgressError`` while this runs.
    """
    if not _SYNC_LOCK.acquire(blocking=False):
        raise SyncInProgressError("a sync is already running")
    try:
        results: list[EmailSyncResult] = []
        for account in list_enabled_accounts(db):
            try:
                results.append(_sync_account_locked(db, account))
            except Exception:
                log.exception("scheduler: sync failed for account id=%s", account.id)
        return results
    finally:
        _SYNC_LOCK.release()


def _sync_account_locked(db: Session, account: EmailAccount) -> EmailSyncResult:
    """Sync a single (already-resolved) account. Caller holds ``_SYNC_LOCK``."""
    now = datetime.now(UTC).replace(tzinfo=None)
    since = account.last_synced_at or (now - timedelta(days=INITIAL_LOOKBACK_DAYS))

    imported = 0
    skipped = 0
    errors: list[str] = []
    existing_msgids = _existing_msgids(db)

    try:
        conn = _connect(account)
    except Exception as e:
        account.last_sync_error = f"connect: {e!s}"
        db.commit()
        raise

    account_domain = _domain_of(account.email)

    try:
        # Expand each configured root folder into itself + every selectable
        # subfolder, then iterate. Lets operators keep e.g. archive subfolders
        # under "Sent Items" without missing them.
        try:
            inbox_folders = _discover_folders(conn, account.inbox_folder)
        except Exception as e:
            errors.append(f"list inbox tree: {e!s}")
            inbox_folders = [account.inbox_folder]
        try:
            sent_folders = _discover_folders(conn, account.sent_folder)
        except Exception as e:
            errors.append(f"list sent tree: {e!s}")
            sent_folders = [account.sent_folder]

        targets: list[tuple[str, str]] = [
            *((f, "incoming") for f in inbox_folders),
            *((f, "outgoing") for f in sent_folders),
        ]

        for folder, direction in targets:
            try:
                msgs, pending = _fetch_folder(conn, folder, since)
            except Exception as e:
                errors.append(f"{folder}: {e!s}")
                continue
            if pending:
                # Folder had more matches than the per-sync fetch limit — surface
                # the backlog so a busy mailbox is discoverable. Re-run "Sync now".
                errors.append(f"{folder}: fetch limit hit ({pending} pending)")

            for _uid, msg in msgs:
                msg_id = msg.get("Message-ID", "")
                if not msg_id:
                    # Fabricate a deterministic ID from date+subject+sender so
                    # we still dedupe across runs.
                    msg_id = (
                        f"<no-id-{msg.get('Date', '')}-"
                        f"{msg.get('From', '')}-{msg.get('Subject', '')}>"
                    )
                tag = _msgid_tag(msg_id)
                if tag in existing_msgids:
                    entry_id, att_count = existing_msgids[tag]
                    if att_count == 0:
                        backfill_paths, backfill_cid_map = _save_and_enqueue_attachments(
                            db,
                            entry_id=entry_id,
                            msg=msg,
                            direction=direction,
                            owner_user_id=account.owner_user_id,
                        )
                        if backfill_paths:
                            existing_row = db.get(LedgerEntry, entry_id)
                            if existing_row is not None:
                                merged = list(existing_row.attachment_paths or [])
                                for p in backfill_paths:
                                    if p not in merged:
                                        merged.append(p)
                                existing_row.attachment_paths = merged
                                if backfill_cid_map:
                                    merged_cid = dict(existing_row.inline_images or {})
                                    merged_cid.update(backfill_cid_map)
                                    existing_row.inline_images = merged_cid
                                db.commit()
                                existing_msgids[tag] = (entry_id, len(merged))
                    # Back-fill empty recipient/message-id columns on historical
                    # rows so a single re-sync repopulates them (idempotent).
                    existing_row = db.get(LedgerEntry, entry_id)
                    if existing_row is not None and _apply_recipient_backfill(
                        existing_row, msg
                    ):
                        db.commit()
                    skipped += 1
                    continue
                try:
                    entry = _build_entry(
                        msg,
                        direction=direction,
                        msg_id_tag=tag,
                        account_domain=account_domain,
                        owner_user_id=account.owner_user_id,
                    )
                    db.add(entry)
                    # Flush so entry.id is assigned — we need it to name the
                    # attachment folder.
                    db.flush()

                    # Extract + persist attachments (and enqueue incoming ones)
                    saved_paths, cid_map = _save_and_enqueue_attachments(
                        db,
                        entry_id=entry.id,
                        msg=msg,
                        direction=direction,
                        owner_user_id=account.owner_user_id,
                    )
                    if saved_paths:
                        entry.attachment_paths = saved_paths
                    if cid_map:
                        entry.inline_images = cid_map

                    # Commit per-row so the write transaction is tiny and
                    # concurrent HTTP requests (link employee, save settings,
                    # add ledger entry) don't see SQLite "database is locked".
                    db.commit()

                    existing_msgids[tag] = (entry.id, len(saved_paths))
                    imported += 1
                except Exception as e:
                    errors.append(f"parse {msg_id}: {e!s}")
                    db.rollback()
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    # Cheap backfill: any previously-imported email entry whose counterparty
    # is clearly on the operator's domain is almost certainly internal — flip
    # it. This runs once per sync, idempotent. Imperfect (counterparty may be
    # a display name like "Ali Awad H" with no domain — those stay as-is),
    # but covers most cases without re-downloading history.
    if account_domain:
        domain_pattern = f"%@{account_domain.lower()}%"
        db.execute(
            text(
                "UPDATE ledger_entries "
                "SET direction = 'internal' "
                "WHERE channel = 'email' "
                "AND direction IN ('incoming', 'outgoing') "
                "AND lower(counterparty) LIKE :pat"
            ),
            {"pat": domain_pattern},
        )

    # Only advance the high-water mark on a CLEAN run. On a partial failure
    # (folder list/fetch/parse error, or a truncated folder) we keep the
    # previous ``since`` so the next run re-scans the same window — the
    # date-granular SINCE + idempotent msgid dedup re-catch anything missed,
    # and we never skip past an un-fetched message (RES-03).
    if not errors:
        account.last_synced_at = now
    account.last_sync_count = imported
    account.last_sync_error = "; ".join(errors)[:1000] if errors else None
    db.commit()

    return EmailSyncResult(
        imported=imported,
        skipped_duplicate=skipped,
        errors=errors,
        last_synced_at=account.last_synced_at or now,
    )
