"""Permission-request endpoints (Task 9).

All routes behind the global auth gate (mounted with ``dependencies=auth_gate``
in main.py).  Per-endpoint capability gates layer on top where admin access is
required.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_capability
from app.core.permissions import CAPABILITIES
from app.db.models import PermissionRequest, User
from app.db.session import get_db
from app.schemas.permission_request import (
    CreateRequestIn,
    DecideIn,
    PermissionRequestRead,
)
from app.services import book_service, permission_request_service

router = APIRouter(prefix="/permissions", tags=["permissions"])


def _to_read(row: PermissionRequest, db: Session) -> PermissionRequestRead:
    """Convert a PermissionRequest ORM row to PermissionRequestRead, resolving names."""
    # Resolve requester display name
    requester_name = book_service.resolve_user_name_by_id(db, row.user_id)
    if not requester_name:
        # Fall back to user email/display_name
        user = db.get(User, row.user_id)
        if user is not None:
            requester_name = getattr(user, "display_name", None) or user.email
        else:
            requester_name = str(row.user_id)

    # Resolve capability label from catalog
    capability_label = next(
        (c.label for c in CAPABILITIES if c.id == row.capability),
        row.capability,
    )

    return PermissionRequestRead(
        id=row.id,
        user_id=row.user_id,
        requester_name=requester_name,
        capability=row.capability,
        capability_label=capability_label,
        status=row.status,
        decision=row.decision,
        created_at=row.created_at,
    )


@router.post(
    "/requests",
    status_code=status.HTTP_201_CREATED,
    response_model=PermissionRequestRead,
)
def create_request(
    body: CreateRequestIn,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PermissionRequestRead:
    """Any signed-in user can request a capability."""
    row = permission_request_service.create_request(db, user, body.capability)
    return _to_read(row, db)


@router.get(
    "/requests",
    response_model=list[PermissionRequestRead],
)
def list_requests(
    _admin: Annotated[User, Depends(require_capability("users.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> list[PermissionRequestRead]:
    """List all pending permission requests. Requires users.manage capability."""
    rows = permission_request_service.list_pending(db)
    return [_to_read(row, db) for row in rows]


@router.post(
    "/requests/{request_id}/decide",
    response_model=PermissionRequestRead,
)
def decide_request(
    request_id: int,
    body: DecideIn,
    admin: Annotated[User, Depends(require_capability("users.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> PermissionRequestRead:
    """Approve or refuse a permission request. Requires users.manage capability."""
    row = permission_request_service.decide(
        db,
        request_id,
        admin=admin,
        decision=body.decision,
        window=body.window,
        note=body.note,
    )
    return _to_read(row, db)
