from __future__ import annotations
from datetime import UTC, datetime, time, timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.errors import AppError
from app.core.permissions import CAPABILITY_IDS
from app.db.models import PermissionRequest, User
from app.services import perm_service

_SENSITIVE = frozenset({"users.manage", "system.admin"})


def expires_from_window(window: str) -> datetime:
    now = datetime.now(UTC).replace(tzinfo=None)
    if window == "2h":
        return now + timedelta(hours=2)
    if window == "today":
        return datetime.combine(now.date(), time(23, 59, 59))
    if window == "week":
        return now + timedelta(days=7)
    raise AppError("INVALID_WINDOW", f"Unknown window {window!r}", http_status=400)


def create_request(db: Session, user: User, capability: str) -> PermissionRequest:
    if capability not in CAPABILITY_IDS:
        raise AppError("UNKNOWN_CAPABILITY", f"Unknown capability {capability!r}", http_status=400)
    if capability in _SENSITIVE:
        raise AppError("FORBIDDEN_REQUEST", "This permission can't be requested.", http_status=400)
    if perm_service.has_capability(db, user, capability):
        raise AppError("ALREADY_GRANTED", "You already have this permission.", http_status=400)
    existing = db.scalar(
        select(PermissionRequest).where(
            PermissionRequest.user_id == user.id,
            PermissionRequest.capability == capability,
            PermissionRequest.status == "pending",
        )
    )
    if existing is not None:
        existing.created_at = datetime.now(UTC).replace(tzinfo=None)
        db.commit()
        return existing
    row = PermissionRequest(user_id=user.id, capability=capability, status="pending")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_pending(db: Session) -> list[PermissionRequest]:
    return list(db.scalars(
        select(PermissionRequest).where(PermissionRequest.status == "pending").order_by(PermissionRequest.created_at.desc())
    ))


def decide(db, request_id, *, admin, decision, window=None, note=None) -> PermissionRequest:
    row = db.get(PermissionRequest, request_id)
    if row is None or row.status != "pending":
        raise AppError("REQUEST_NOT_PENDING", "Request not found or already decided.", http_status=404)
    target = db.get(User, row.user_id)
    if decision == "permanent":
        perm_service.set_user_override(db, target.id, row.capability, "grant", actor=admin)
        row.status, row.decision = "granted", "permanent"
    elif decision == "once":
        if not window:
            raise AppError("INVALID_WINDOW", "A window is required for a one-time grant.", http_status=400)
        perm_service.set_user_override(db, target.id, row.capability, "grant", actor=admin, expires_at=expires_from_window(window))
        row.status, row.decision = "granted", "once"
    elif decision == "refused":
        row.status, row.decision, row.note = "refused", "refused", note
    else:
        raise AppError("INVALID_DECISION", f"Unknown decision {decision!r}", http_status=400)
    row.decided_by_user_id = admin.id
    row.decided_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()
    db.refresh(row)
    return row
