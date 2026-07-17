"""Thin repo layer for BookEditSession used by the WebDAV router."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.db.models import BookEditSession


def get_active_session_by_token(db: Session, token: str) -> BookEditSession | None:
    """Return the active session for *token*, or None if unknown / not active."""
    return (
        db.query(BookEditSession)
        .filter(BookEditSession.token == token, BookEditSession.state == "active")
        .first()
    )


def record_put(db: Session, session_id: int) -> None:
    """Stamp *last_put_at* on the session row and commit."""
    db.query(BookEditSession).filter(BookEditSession.id == session_id).update(
        {"last_put_at": datetime.now(UTC)},
        synchronize_session=False,
    )
    db.commit()
