"""Web Push sender + subscription lifecycle (Phase 5).

Responsibilities:
- ``store_subscription`` — upsert one (user, endpoint) row.
- ``remove_subscription`` — delete by (user, endpoint).
- ``send_to_user`` — VAPID-sign and POST a push to every subscription for a
  user; prune dead rows on 410/404 Gone.

The VAPID private key lives off-DB at ``<data_dir>/.vapid_key`` (see
``core/vapid.py``).  ``pywebpush.webpush`` is called synchronously on the
scheduler thread; the round-trip to the push service is typically < 1 s.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from collections.abc import Iterable

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core import vapid
from app.db.models import PushSent, PushSubscription
from app.schemas.push import PushSubscriptionIn

log = logging.getLogger(__name__)

# VAPID 'sub' claim — a contact URL/email the push service can use to reach
# the operator in case of problems.  Change to the real ops address.
_VAPID_SUB = "mailto:it@gssg.ae"


def store_subscription(
    db: Session,
    user_id: int,
    sub: PushSubscriptionIn,
    user_agent: str | None,
    locale: str | None = None,
) -> None:
    """Upsert a push subscription row for (user_id, endpoint).

    ``locale`` is the device's UI language ('en'/'ar') so pushes to this
    endpoint can be localized; re-subscribing refreshes it.
    """
    # An endpoint identifies one device/browser, owned by whoever is currently
    # signed in there. Drop any claim on it by a DIFFERENT user so a shared
    # device (e.g. two people signing in on the same phone) doesn't receive
    # both users' notifications — the "double message" bug.
    db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == sub.endpoint,
            PushSubscription.user_id != user_id,
        )
    )
    existing = db.scalar(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == sub.endpoint,
        )
    )
    if existing:
        existing.p256dh = sub.keys.p256dh
        existing.auth = sub.keys.auth
        existing.user_agent = user_agent
        existing.locale = locale
    else:
        db.add(
            PushSubscription(
                user_id=user_id,
                endpoint=sub.endpoint,
                p256dh=sub.keys.p256dh,
                auth=sub.keys.auth,
                user_agent=user_agent,
                locale=locale,
            )
        )
    db.commit()


def remove_subscription(db: Session, user_id: int, endpoint: str) -> int:
    """Delete the subscription row for (user_id, endpoint). Returns row count."""
    res = db.execute(
        delete(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == endpoint,
        )
    )
    db.commit()
    rowcount: int = getattr(res, "rowcount", 0) or 0
    return rowcount


def _prune(db: Session, sub_id: int) -> None:
    db.execute(delete(PushSubscription).where(PushSubscription.id == sub_id))
    db.commit()


def send_to_user(
    db: Session,
    user_id: int,
    messages: dict[str, tuple[str, str]],
    url: str = "/",
) -> int:
    """Send a localized push to every registered endpoint for ``user_id``.

    ``messages`` maps a locale ('en'/'ar') to a ``(title, body)`` pair; each
    subscription is delivered the message for its own ``locale`` (falling back
    to 'en', then any). The click payload includes ``url`` so the service
    worker can deep-link to the item. Dead endpoints (404/410) are pruned.
    """
    subs = list(
        db.scalars(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        )
    )
    delivered = 0
    for s in subs:
        loc = (s.locale or "en").split("-")[0].lower()
        title, body = (
            messages.get(loc) or messages.get("en") or next(iter(messages.values()))
        )
        data = json.dumps({"title": title, "body": body, "url": url})
        try:
            webpush(
                subscription_info={
                    "endpoint": s.endpoint,
                    "keys": {"p256dh": s.p256dh, "auth": s.auth},
                },
                data=data,
                vapid_private_key=vapid.private_pem_path(),
                vapid_claims={"sub": _VAPID_SUB},
            )
            s.last_used_at = datetime.now(UTC).replace(tzinfo=None)
            db.commit()
            delivered += 1
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):
                log.info(
                    "push: pruning dead subscription %s (HTTP %s)", s.id, code
                )
                _prune(db, s.id)
            else:
                log.warning("push: send failed for sub %s: %s", s.id, e)
    return delivered


# ---------------------------------------------------------------------------
# Durable "already notified" ledger (push_sent) — so each actionable item is
# pushed exactly once and the notifier survives process restarts.
# ---------------------------------------------------------------------------


def sent_refs(db: Session, user_id: int, kind: str) -> set[str]:
    """The set of item refs already pushed to ``user_id`` for ``kind``."""
    return set(
        db.scalars(
            select(PushSent.ref).where(
                PushSent.user_id == user_id, PushSent.kind == kind
            )
        )
    )


def mark_sent(db: Session, user_id: int, kind: str, refs: Iterable[str]) -> None:
    """Record ``refs`` as notified for (user, kind). Caller passes only new refs."""
    added = False
    for ref in refs:
        db.add(PushSent(user_id=user_id, kind=kind, ref=ref))
        added = True
    if added:
        db.commit()


def prune_sent(
    db: Session, user_id: int, kind: str, current_refs: set[str]
) -> None:
    """Drop ledger rows for items no longer actionable.

    Keeps the table small and lets a genuinely-recurring item (same ref that
    disappears then returns) notify again.
    """
    rows = (
        db.execute(
            select(PushSent).where(
                PushSent.user_id == user_id, PushSent.kind == kind
            )
        )
        .scalars()
        .all()
    )
    removed = False
    for row in rows:
        if row.ref not in current_refs:
            db.delete(row)
            removed = True
    if removed:
        db.commit()
