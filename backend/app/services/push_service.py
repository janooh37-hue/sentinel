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

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core import vapid
from app.db.models import PushSubscription
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
) -> None:
    """Upsert a push subscription row for (user_id, endpoint)."""
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
    else:
        db.add(
            PushSubscription(
                user_id=user_id,
                endpoint=sub.endpoint,
                p256dh=sub.keys.p256dh,
                auth=sub.keys.auth,
                user_agent=user_agent,
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
    title: str,
    body: str,
    url: str = "/",
) -> int:
    """Send a push to every registered endpoint for ``user_id``.

    Returns the number of successfully delivered messages.  Dead endpoints
    (HTTP 404/410) are pruned from the table.
    """
    subs = list(
        db.scalars(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        )
    )
    data = json.dumps({"title": title, "body": body, "url": url})
    delivered = 0
    for s in subs:
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
