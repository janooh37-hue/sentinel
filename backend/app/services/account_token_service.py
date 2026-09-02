"""One-time email link tokens (verify / reset).

Leaf module: only ``security``, models, and SQLAlchemy — no ``auth_service``
import, so ``auth_service`` can depend on this without a cycle. Raw tokens are
never persisted; only their sha256 hash (``security.hash_token``) is stored,
mirroring session-cookie tokens.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, select, update
from sqlalchemy.orm import Session

from app.core import security
from app.db.models import AccountEmailToken, User

VERIFY_TTL = timedelta(hours=24)
RESET_TTL = timedelta(minutes=30)
PURPOSE_VERIFY = "verify"
PURPOSE_RESET = "reset"

_TTL_BY_PURPOSE = {PURPOSE_VERIFY: VERIFY_TTL, PURPOSE_RESET: RESET_TTL}


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def invalidate_open(db: Session, user_id: int, purpose: str, *, now: datetime) -> None:
    """Mark every unused ``purpose`` token for ``user_id`` as used. Caller commits."""
    db.execute(
        update(AccountEmailToken)
        .where(
            AccountEmailToken.user_id == user_id,
            AccountEmailToken.purpose == purpose,
            AccountEmailToken.used_at.is_(None),
        )
        .values(used_at=now)
    )


def issue(db: Session, user: User, purpose: str) -> str:
    """Invalidate any open token of the same purpose and mint a fresh one.

    Returns the raw token (only ever handed to the mailer, never persisted).
    Commits.
    """
    now = _utcnow()
    invalidate_open(db, user.id, purpose, now=now)
    raw = security.new_opaque_token()
    db.add(
        AccountEmailToken(
            user_id=user.id,
            purpose=purpose,
            token_hash=security.hash_token(raw),
            expires_at=now + _TTL_BY_PURPOSE[purpose],
        )
    )
    db.commit()
    return raw


def claim(db: Session, raw: str, purpose: str) -> AccountEmailToken | None:
    """Atomically consume a valid, unused, unexpired token of ``purpose``.

    A single ``UPDATE ... WHERE used_at IS NULL AND expires_at > now`` is what
    makes concurrent claims of the same token yield exactly one winner: only
    one request's UPDATE can match the still-open row. Returns ``None`` (no
    commit) when the token is missing/used/expired/wrong-purpose; the caller
    commits together with its own mutation on success.
    """
    now = _utcnow()
    token_hash = security.hash_token(raw)
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(AccountEmailToken)
            .where(
                AccountEmailToken.token_hash == token_hash,
                AccountEmailToken.purpose == purpose,
                AccountEmailToken.used_at.is_(None),
                AccountEmailToken.expires_at > now,
            )
            .values(used_at=now)
        ),
    )
    if (result.rowcount or 0) != 1:
        return None
    return db.execute(
        select(AccountEmailToken).where(AccountEmailToken.token_hash == token_hash)
    ).scalar_one()


__all__ = [
    "PURPOSE_RESET",
    "PURPOSE_VERIFY",
    "RESET_TTL",
    "VERIFY_TTL",
    "claim",
    "invalidate_open",
    "issue",
]
