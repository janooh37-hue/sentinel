"""Per-user notification counts — the shared seam behind the SSE stream
(Phase 4) and Web Push (Phase 5). Pure, read-only over (db, user).

Future upgrade (NOT built): replace the stream's poll-and-diff with explicit
asyncio event hooks fired from book_service/scan_inbox_service/email_service so
the stream wakes in ≈0ms instead of on the next ~2.5s tick. Worth it only at
larger scale; for a handful of users the diff loop is correct + trivial.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core import leave_lifecycle
from app.db.models import User
from app.schemas.notifications import NotificationCounts
from app.services import (
    book_service,
    leave_service,
    ledger_service,
    perm_service,
    scan_inbox_service,
)


@dataclass(frozen=True)
class ActionableItem:
    """One owned, actionable item for Web Push — carries its own deep link."""

    kind: str  # 'approval' (sign) | 'review' | 'scan' | 'email'
    ref: str  # opaque, stable per-kind key, e.g. 'book:42'
    url: str  # frontend deep-link path the notification click navigates to
    label: str  # short human label (ref number / id) for the body text
    subject: str | None = None  # richer context for single-item bodies
    requester: str | None = None  # who submitted it / email sender
    preview: str | None = None  # short plain-text content preview (emails)
    attachments: int = 0  # attachment count, for the email body's "size" line


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_ADDR_RE = re.compile(r"\s*<[^>]*>\s*$")


def _email_preview(notes_html: str | None, limit: int = 140) -> str:
    """Flatten an email body's HTML to a single-line plain-text preview.

    Block tags become spaces so words don't run together; remaining tags are
    stripped and whitespace collapsed. Truncated on a word boundary with an
    ellipsis so the push body reads like a real mail preview.
    """
    if not notes_html:
        return ""
    text = re.sub(r"(?i)<\s*(br|/p|/div|/li|/tr|/h[1-6])\s*/?>", " ", notes_html)
    text = _WS_RE.sub(" ", _TAG_RE.sub("", text)).strip()
    if len(text) <= limit:
        return text
    cut = text[: limit + 1]
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > limit * 0.6 else cut[:limit]).rstrip() + "…"


def _sender_name(counterparty: str | None) -> str:
    """Display name for a "Name <addr@host>" counterparty — the name if present,
    otherwise the bare address. Never the raw "Name <addr>" pair (too long)."""
    cp = (counterparty or "").strip()
    if not cp:
        return "Unknown sender"
    name = _ADDR_RE.sub("", cp).strip().strip('"')
    return name or cp


def actionable_items(db: Session, user: User) -> list[ActionableItem]:
    """Per-user OWNED actionable items for Web Push, each with a deep link.

    Mirrors the *owned* categories of ``relevant_counts`` (approvals, scans,
    emails) but returns the actual items (with ids) so the notifier pushes each
    one exactly once and the click deep-links to it. Org-wide **leaves** are
    intentionally excluded here: they have no owner, so a per-user push would
    ping every user about every leave. Leaves stay in the in-app bell via
    ``relevant_counts``.

    Approval-chain items are split by the user's role on the pending step so
    the copy is correct: ``approval`` (the signing manager → "sign") vs
    ``review`` (an advisory reviewer → "review"). Assignment to the step IS the
    authorization to act, so — unlike the books.approve-gated bell count — we
    notify every assignee, including reviewers who don't hold books.approve.
    """
    items: list[ActionableItem] = []

    # Approval chain — books whose current pending step is assigned to this user.
    for book in book_service.list_awaiting(db, user_id=user.id):
        role = book_service.your_step_kind(book, user.id)
        kind = "review" if role == "reviewer" else "approval"
        label = book.ref_number or book.subject or f"#{book.id}"
        items.append(
            ActionableItem(
                kind,
                f"book:{book.id}",
                f"/books/{book.id}",
                label,
                subject=book.subject,
                requester=book_service.submitter_name(db, book),
            )
        )

    # Scans — owned inbox items needing action (matches counts()'s "total").
    for state in ("awaiting_confirmation", "unrouted"):
        for s in scan_inbox_service.list_items(
            db, owner_user_id=user.id, state=state
        ):
            items.append(ActionableItem("scan", f"scan:{s.id}", "/scan-inbox", f"#{s.id}"))

    # Emails — unread received mail in this user's mailbox. Carry the sender,
    # subject, a content preview and attachment count so the push body says what
    # the mail actually is, not just "1 unread email".
    for e in ledger_service.unread_emails(db, owner_user_id=user.id):
        items.append(
            ActionableItem(
                "email",
                f"email:{e.id}",
                "/ledger",
                f"#{e.id}",
                subject=e.subject,
                requester=_sender_name(e.counterparty),
                preview=_email_preview(e.notes_html),
                attachments=len(e.attachment_paths or []),
            )
        )

    return items

_LEAVE_PAGE = 500  # == leaves LIST_MAX_LIMIT in api/v1/leaves.py


def _leaves_needing_action(db: Session, today_iso: str) -> int:
    total_seen = 0
    offset = 0
    need = 0
    while True:
        rows, total = leave_service.list_leaves(db, limit=_LEAVE_PAGE, offset=offset)
        for r in rows:
            if leave_lifecycle.needs_action(
                r.leave_type, r.status, str(r.end_date), today_iso
            ):
                need += 1
        total_seen += len(rows)
        if not rows or total_seen >= total:
            break
        offset = total_seen
    return need


def leaves_needing_action(db: Session) -> int:
    """Return the org-wide leave-action count.

    Exposed so the scheduler can compute this ONCE per tick and share the
    result across all per-user ``relevant_counts`` calls, avoiding repeated
    full-table leave pages when there are many active users.
    """
    return _leaves_needing_action(db, datetime.now(UTC).date().isoformat())


def relevant_counts(
    db: Session,
    user: User,
    *,
    precomputed_leaves: int | None = None,
) -> NotificationCounts:
    """Compute per-user notification counts from existing queries.

    - approvals: books whose current pending step is assigned to this user.
    - leaves:    org-wide leave rows that need someone's action (pending requests,
                 overdue awaiting-return). No per-user filter — leaves have no owner.
                 Pass ``precomputed_leaves`` to reuse a value computed earlier in
                 the same tick (avoids repeating the org-wide paging per user).
    - scans:     scan-inbox items owned by this user (awaiting_confirmation + unrouted).
    - emails:    unread incoming email in this user's mailbox.

    This is the Phase 5 contract: Phase 5 Web Push calls the same function.
    Keep it pure (no side effects, no request objects).
    """
    today_iso = datetime.now(UTC).date().isoformat()
    # Only count pending approval steps when the user actually holds books.approve.
    # Without the cap the bell row is hidden, so a non-zero count here would be
    # misleading (SSE/push would fire for an action the user can't take).
    if perm_service.has_capability(db, user, "books.approve"):
        approvals = len(book_service.list_awaiting(db, user_id=user.id))
    else:
        approvals = 0
    scans = scan_inbox_service.counts(db, owner_user_id=user.id)["total"]
    emails = ledger_service.unread_email_count(db, owner_user_id=user.id)
    leaves = (
        precomputed_leaves
        if precomputed_leaves is not None
        else _leaves_needing_action(db, today_iso)
    )
    return NotificationCounts(
        approvals=approvals, leaves=leaves, scans=scans, emails=emails
    )
