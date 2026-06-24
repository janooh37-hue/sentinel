"""General Book recipient service — list, create, delete, resolve."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError
from app.db.models import GeneralBookRecipient
from app.schemas.recipient import RecipientCreate


def list_recipients(db: Session) -> list[GeneralBookRecipient]:
    """Return all recipients sorted by name."""
    rows = db.execute(
        select(GeneralBookRecipient).order_by(GeneralBookRecipient.name)
    ).scalars().all()
    return list(rows)


def create_recipient(db: Session, payload: RecipientCreate) -> GeneralBookRecipient:
    """Create a recipient. 409 if name is already taken."""
    existing = db.execute(
        select(GeneralBookRecipient).where(GeneralBookRecipient.name == payload.name)
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(
            "RECIPIENT_EXISTS",
            f"Recipient '{payload.name}' already exists",
        )
    row = GeneralBookRecipient(name=payload.name, name_ar=payload.name_ar)
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "RECIPIENT_EXISTS",
            f"Recipient '{payload.name}' already exists",
        ) from exc
    db.refresh(row)
    return row


def delete_recipient(db: Session, recipient_id: int) -> None:
    """Hard-delete a recipient row. 404 if the id is unknown."""
    row = db.get(GeneralBookRecipient, recipient_id)
    if row is None:
        raise NotFoundError("RECIPIENT_NOT_FOUND", f"Recipient {recipient_id} not found")
    db.delete(row)
    db.commit()


def resolve_name(db: Session, recipient_id: int) -> str | None:
    """Return the recipient's display name for ``recipient_id``, or None."""
    row = db.get(GeneralBookRecipient, recipient_id)
    if row is None:
        return None
    return row.name


__all__ = [
    "create_recipient",
    "delete_recipient",
    "list_recipients",
    "resolve_name",
]
