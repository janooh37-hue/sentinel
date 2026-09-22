"""Thin repo layer for BookEditSession used by the WebDAV router."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.db.models import BookEditSession, User


def get_active_session_by_token(db: Session, token: str) -> BookEditSession | None:
    """Return the active session for *token*, or None if unknown / not active
    / owned by an account that can no longer authenticate (disabled, pending,
    rejected, or still awaiting a password-setup step). The bearer token URL
    is DAV's sole auth mechanism (no cookies) — it must not outlive the
    owning account's ability to sign in.
    """
    return (
        db.query(BookEditSession)
        .join(User, User.id == BookEditSession.user_id)
        .filter(
            BookEditSession.token == token,
            BookEditSession.state == "active",
            User.status == "active",
            User.password_change_required.is_(False),
        )
        .first()
    )


def record_put(db: Session, session_id: int) -> None:
    """Stamp *last_put_at* on the session row and commit."""
    db.query(BookEditSession).filter(BookEditSession.id == session_id).update(
        {"last_put_at": datetime.now(UTC)},
        synchronize_session=False,
    )
    db.commit()
