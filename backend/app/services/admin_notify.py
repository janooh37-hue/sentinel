from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.roles import ADMIN_ROLE
from app.db.models import User
from app.services import push_service

_ACCESS_URL = "/access-requests?tab=permission-requests"


def active_admins(db: Session) -> list[User]:
    return list(db.scalars(select(User).where(User.role == ADMIN_ROLE, User.status == "active")))


def notify_admins_new_request(db: Session, requester: User, capability_label: str, request_id: int) -> None:
    name = requester.display_name or requester.email
    messages = {
        "en": ("GSSG Manager", f"{name} requested '{capability_label}' access"),
        "ar": ("مدير GSSG", f"طلب {name} صلاحية '{capability_label}'"),
    }
    for admin in active_admins(db):
        try:
            push_service.send_to_user(db, admin.id, messages, _ACCESS_URL)
        except Exception:
            pass
