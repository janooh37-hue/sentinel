"""General Book recipients endpoints — list / create / delete.

Mounted under ``/api/v1/general-book/recipients``. Read is open to any signed-in
user (matches the chrome a logged-in operator already gets); write requires
``books.manage`` to mirror the books-management gate.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.recipient import RecipientCreate, RecipientRead
from app.services import recipient_service

router = APIRouter(prefix="/general-book/recipients", tags=["general-book"])


@router.get("", response_model=list[RecipientRead])
def list_recipients(db: Annotated[Session, Depends(get_db)]) -> list[RecipientRead]:
    rows = recipient_service.list_recipients(db)
    return [RecipientRead.model_validate(r) for r in rows]


@router.post("", response_model=RecipientRead, status_code=status.HTTP_201_CREATED)
def create_recipient(
    payload: RecipientCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> RecipientRead:
    row = recipient_service.create_recipient(db, payload)
    return RecipientRead.model_validate(row)


@router.delete("/{recipient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipient(
    recipient_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> Response:
    recipient_service.delete_recipient(db, recipient_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
