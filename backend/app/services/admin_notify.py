from __future__ import annotations

import contextlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.roles import ADMIN_ROLE
from app.db.models import User
from app.services import push_service
from app.services.capability_catalog_service import CapabilityCatalogEntry

_ACCESS_URL = "/access-requests?tab=permission-requests"
_FIRST_STRONG_ISOLATE = "\u2068"
_POP_DIRECTIONAL_ISOLATE = "\u2069"


def _isolate(value: str) -> str:
    return f"{_FIRST_STRONG_ISOLATE}{value}{_POP_DIRECTIONAL_ISOLATE}"


def active_admins(db: Session) -> list[User]:
    return list(db.scalars(select(User).where(User.role == ADMIN_ROLE, User.status == "active")))


def notify_admins_new_request(
    db: Session,
    requester: User,
    *,
    capability_id: str,
    entry: CapabilityCatalogEntry | None,
    request_id: int,
) -> None:
    """Notify active admins using localized catalog labels."""
    name = requester.display_name or requester.email
    label_en = (entry.label_en if entry is not None else "").strip() or capability_id
    label_ar = (entry.label_ar if entry is not None and entry.label_ar else "").strip()
    label_ar = label_ar or label_en or capability_id
    messages = {
        "en": (
            "GSSG Manager",
            f"New access request\n{_isolate(name)} is requesting “{_isolate(label_en)}”",
        ),
        "ar": (
            "GSSG Manager",
            f"طلب صلاحية جديد\n{_isolate(name)} يطلب الوصول إلى ”{_isolate(label_ar)}“",
        ),
    }
    for admin in active_admins(db):
        with contextlib.suppress(Exception):
            push_service.send_to_user(db, admin.id, messages, _ACCESS_URL)
