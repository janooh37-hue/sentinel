"""Per-user recipient (distribution) lists service — Ledger compose.

Owner-scoped CRUD. A list name is unique per owner: create / rename collisions
raise ``ConflictError`` (409); missing or cross-owner ids raise ``NotFoundError``
(404). ``members`` is stored as a JSON list of {field, address, display_name}
dicts. Owner always comes from the session.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError
from app.db.models import RecipientList
from app.schemas.recipient_lists import (
    RecipientListCreate,
    RecipientListMember,
    RecipientListUpdate,
)


def list_lists(db: Session, *, owner_user_id: int) -> list[RecipientList]:
    """The owner's lists, ordered by name."""
    stmt = (
        select(RecipientList)
        .where(RecipientList.owner_user_id == owner_user_id)
        .order_by(RecipientList.name.asc())
    )
    return list(db.execute(stmt).scalars())


def _name_taken(
    db: Session, *, owner_user_id: int, name: str, exclude_id: int | None = None
) -> bool:
    stmt = select(RecipientList.id).where(
        RecipientList.owner_user_id == owner_user_id,
        RecipientList.name == name,
    )
    if exclude_id is not None:
        stmt = stmt.where(RecipientList.id != exclude_id)
    return db.execute(stmt).first() is not None


def _members_payload(payload_members: list[RecipientListMember]) -> list[dict[str, str]]:
    return [m.model_dump() for m in payload_members]


def create_list(
    db: Session, *, owner_user_id: int, payload: RecipientListCreate
) -> RecipientList:
    name = payload.name.strip()
    if _name_taken(db, owner_user_id=owner_user_id, name=name):
        raise ConflictError("RECIPIENT_LIST_NAME_TAKEN", f"A list named {name!r} already exists")
    row = RecipientList(
        owner_user_id=owner_user_id,
        name=name,
        members=_members_payload(payload.members),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_list(
    db: Session, *, owner_user_id: int, list_id: int, payload: RecipientListUpdate
) -> RecipientList:
    row = db.execute(
        select(RecipientList).where(
            RecipientList.id == list_id,
            RecipientList.owner_user_id == owner_user_id,
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "RECIPIENT_LIST_NOT_FOUND", f"List {list_id} does not exist", id=list_id
        )
    if payload.name is not None:
        name = payload.name.strip()
        if _name_taken(db, owner_user_id=owner_user_id, name=name, exclude_id=row.id):
            raise ConflictError("RECIPIENT_LIST_NAME_TAKEN", f"A list named {name!r} already exists")
        row.name = name
    if payload.members is not None:
        row.members = _members_payload(payload.members)
    db.commit()
    db.refresh(row)
    return row


def delete_list(db: Session, *, owner_user_id: int, list_id: int) -> None:
    row = db.execute(
        select(RecipientList).where(
            RecipientList.id == list_id,
            RecipientList.owner_user_id == owner_user_id,
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError(
            "RECIPIENT_LIST_NOT_FOUND", f"List {list_id} does not exist", id=list_id
        )
    db.delete(row)
    db.commit()


__all__ = ["create_list", "delete_list", "list_lists", "update_list"]
