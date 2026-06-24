"""Resolve the mailbox-read scope for the Ledger email-read endpoints.

Phase 6 (private inbox): every email-read route is own-scoped by default.
Admins may widen to the whole office (legacy null-owner mail included) via
``?scope=all``. This helper is the single place that enforces the admin gate —
a non-admin passing ``scope=all`` is pinned to their own id, never ``None``.
"""

from __future__ import annotations

from app.core.roles import ADMIN_ROLE
from app.db.models import User

SCOPE_ALL = "all"


def resolve_mail_scope(current_user: User, scope: str) -> int | None:
    """Return the ``owner_user_id`` filter for an email-read query.

    - ``None`` → whole office (no owner filter) — ONLY for ``scope == "all"``
      AND an admin caller.
    - ``current_user.id`` → own mailbox — for ``scope == "mine"`` (default) and
      for any non-admin caller regardless of the param (no privilege escalation).
    """
    if scope == SCOPE_ALL and current_user.role == ADMIN_ROLE:
        return None
    return current_user.id


__all__ = ["SCOPE_ALL", "resolve_mail_scope"]
