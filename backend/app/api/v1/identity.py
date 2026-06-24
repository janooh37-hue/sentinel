"""Identity endpoints — /identity/me + /identity/transfer-admin.

Multi-user auth: "who is signed in" is the session ``User`` (role stored on the
row, authoritative). The EmailAccount link describes the *mailbox*, never the
*person*, so it is no longer an identity source here.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db.models import Employee, User
from app.db.session import get_db
from app.schemas.identity import IdentityRead, TransferAdminRequest
from app.services import identity_service

router = APIRouter(prefix="/identity", tags=["identity"])


@router.get("/me", response_model=IdentityRead)
def get_me(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> IdentityRead:
    # The signed-in user is the single, authoritative identity.
    return identity_service.get_identity(db, current_user)


@router.post("/transfer-admin", status_code=status.HTTP_204_NO_CONTENT)
def transfer_admin(
    body: TransferAdminRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
) -> Response:
    """Move the legacy admin slot (``settings.admin_employee_id``) to another
    employee. Admin-only. 404 if the target employee doesn't exist.
    """
    target = db.get(Employee, body.employee_id)
    if target is None:
        raise HTTPException(
            status_code=404, detail=f"employee {body.employee_id} not found"
        )
    identity_service.set_admin_id(db, body.employee_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
