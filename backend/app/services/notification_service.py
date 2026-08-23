"""Per-user notification counts — the shared seam behind the SSE stream
(Phase 4) and Web Push (Phase 5). Pure, read-only over (db, user).

Future upgrade (NOT built): replace the stream's poll-and-diff with explicit
asyncio event hooks fired from book_service/scan_inbox_service/email_service so
the stream wakes in ≈0ms instead of on the next ~2.5s tick. Worth it only at
larger scale; for a handful of users the diff loop is correct + trivial.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core import leave_lifecycle
from app.db.models import User
from app.schemas.notifications import NotificationCounts
from app.services import (
    book_service,
    leave_service,
    perm_service,
    scan_inbox_service,
)


@dataclass(frozen=True)
class ActionableItem:
    """One owned, actionable item for Web Push — carries its own deep link."""

    kind: str  # 'approval' (sign) | 'review' | 'scan' | 'scanback'
    ref: str
    url: str
    label: str
    subject: str | None = None
    requester: str | None = None




def actionable_items(db: Session, user: User) -> list[ActionableItem]:
    """Return owned approval, scan, and scan-back actions for Web Push."""
    items: list[ActionableItem] = []

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

    for state in ("awaiting_confirmation", "unrouted"):
        for s in scan_inbox_service.list_items(db, owner_user_id=user.id, state=state):
            items.append(ActionableItem("scan", f"scan:{s.id}", "/scan-inbox", f"#{s.id}"))

    if perm_service.has_capability(db, user, "books.manage"):
        for book in book_service.list_awaiting_scan(db, user_id=user.id):
            items.append(
                ActionableItem(
                    "scanback",
                    f"book:{book.id}",
                    f"/books/{book.id}",
                    book.ref_number or f"#{book.id}",
                    subject=book.subject,
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
            if leave_lifecycle.needs_action(r.leave_type, r.status, str(r.end_date), today_iso):
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
    """Compute per-user approval and scan counts from existing queries."""
    today_iso = datetime.now(UTC).date().isoformat()
    approvals = (
        len(book_service.list_awaiting(db, user_id=user.id))
        if perm_service.has_capability(db, user, "books.approve")
        else 0
    )
    scans = scan_inbox_service.counts(db, owner_user_id=user.id)["total"]
    leaves = (
        precomputed_leaves
        if precomputed_leaves is not None
        else _leaves_needing_action(db, today_iso)
    )
    return NotificationCounts(approvals=approvals, leaves=leaves, scans=scans)
