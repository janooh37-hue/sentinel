"""Web Push subscription endpoints (Phase 5).

All routes behind the global auth gate (mounted with ``dependencies=auth_gate``
in main.py).  The vapid-public-key endpoint is also behind auth so the VAPID
key isn't exposed to unauthenticated callers.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core import vapid
from app.db.models import User
from app.db.session import get_db
from app.schemas.push import EndpointIn, PushSubscriptionIn, VapidKeyOut
from app.services import push_service

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key", response_model=VapidKeyOut)
def vapid_public_key() -> VapidKeyOut:
    """Return the VAPID application server key the browser needs to subscribe."""
    return VapidKeyOut(public_key=vapid.public_key())


@router.post("/subscribe", status_code=status.HTTP_201_CREATED)
def subscribe(
    payload: PushSubscriptionIn,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """Upsert a push subscription for the signed-in user."""
    push_service.store_subscription(
        db, user.id, payload, request.headers.get("user-agent"), payload.locale
    )
    return Response(status_code=status.HTTP_201_CREATED)


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    payload: EndpointIn,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """Remove the push subscription for the given endpoint."""
    push_service.remove_subscription(db, user.id, payload.endpoint)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
