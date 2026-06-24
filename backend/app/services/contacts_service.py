"""Per-user address book service — Ledger→Outlook Phase 2.

Owner-scoped CRUD for saved compose contacts. ``save_contact`` upserts on the
UNIQUE ``(owner_user_id, address)`` key so saving the same address twice is an
update, not an error. ``list_contacts`` mirrors ``ledger_service.list_counterparties``
(prefix/substring autocomplete). Owner always comes from the session.
"""

from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.db.models import AddressBookContact

LIST_DEFAULT_LIMIT = 20
LIST_MAX_LIMIT = 100


def save_contact(
    db: Session,
    *,
    owner_user_id: int,
    display_name: str,
    address: str,
) -> AddressBookContact:
    """Idempotent upsert on (owner_user_id, address).

    Saving an existing address updates its display name and returns the same
    row; a new address inserts. Never raises on a duplicate address.
    """
    address = address.strip()
    existing = db.execute(
        select(AddressBookContact).where(
            AddressBookContact.owner_user_id == owner_user_id,
            AddressBookContact.address == address,
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.display_name = display_name
        db.commit()
        db.refresh(existing)
        return existing
    row = AddressBookContact(
        owner_user_id=owner_user_id,
        display_name=display_name,
        address=address,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_contacts(
    db: Session,
    *,
    owner_user_id: int,
    q: str | None = None,
    limit: int = LIST_DEFAULT_LIMIT,
) -> list[AddressBookContact]:
    """The owner's saved contacts. ``q`` matches display_name OR address
    (case-insensitive substring), ordered by display_name then address."""
    limit = max(1, min(limit, LIST_MAX_LIMIT))
    stmt = select(AddressBookContact).where(
        AddressBookContact.owner_user_id == owner_user_id
    )
    if q and q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                AddressBookContact.display_name.ilike(needle),
                AddressBookContact.address.ilike(needle),
            )
        )
    stmt = stmt.order_by(
        AddressBookContact.display_name.asc(), AddressBookContact.address.asc()
    ).limit(limit)
    return list(db.execute(stmt).scalars())


def delete_contact(db: Session, *, owner_user_id: int, contact_id: int) -> None:
    """Delete the owner's own contact. Cross-owner (or missing) → NotFoundError."""
    row = db.execute(
        select(AddressBookContact).where(
            AddressBookContact.id == contact_id,
            AddressBookContact.owner_user_id == owner_user_id,
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "CONTACT_NOT_FOUND",
            f"Contact {contact_id} does not exist",
            id=contact_id,
        )
    db.delete(row)
    db.commit()


__all__ = [
    "LIST_DEFAULT_LIMIT",
    "LIST_MAX_LIMIT",
    "delete_contact",
    "list_contacts",
    "save_contact",
]
