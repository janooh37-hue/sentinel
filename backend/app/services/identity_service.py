"""Identity service — resolves "who is signed in" for the singleton install.

There is no real session. The "current user" is whichever employee the
EmailAccount row points at via ``linked_employee_id``. The admin slot is
tracked in a single AppSetting key, ``settings.admin_employee_id``.
"""

from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.roles import (
    ADMIN_ROLE,
    MANAGER_ROLE,
)
from app.db.models import AppSetting, Employee, User, VaultFile
from app.schemas.identity import IdentityRead

log = logging.getLogger(__name__)

_ADMIN_KEY = "settings.admin_employee_id"


# ─── Admin slot ──────────────────────────────────────────────────────────────


def get_admin_id(db: Session) -> str | None:
    row = db.execute(
        select(AppSetting).where(AppSetting.key == _ADMIN_KEY)
    ).scalar_one_or_none()
    if row is None:
        return None
    try:
        value = json.loads(row.value)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, str) else None


def set_admin_id(db: Session, employee_id: str | None) -> None:
    existing = db.execute(
        select(AppSetting).where(AppSetting.key == _ADMIN_KEY)
    ).scalar_one_or_none()
    encoded = json.dumps(employee_id)
    if existing is None:
        db.add(AppSetting(key=_ADMIN_KEY, value=encoded))
    else:
        existing.value = encoded
    db.commit()


def promote_to_admin_if_vacant(db: Session, employee_id: str) -> None:
    """Set ``admin_employee_id = employee_id`` iff no admin currently exists."""
    if get_admin_id(db) is None:
        set_admin_id(db, employee_id)
        log.info("identity: %s auto-promoted to admin (vacant slot)", employee_id)


# ─── Resolve identity ────────────────────────────────────────────────────────


def photo_url_for(db: Session, employee_id: str) -> str | None:
    row = db.execute(
        select(VaultFile)
        .where(VaultFile.employee_id == employee_id, VaultFile.kind == "photo")
        .order_by(VaultFile.created_at.asc())
        .limit(1)
    ).scalar_one_or_none()
    if row is None:
        return None
    return f"/api/v1/employees/{employee_id}/photo"


# Backwards-compatible private alias (kept for existing call sites).
_photo_url = photo_url_for


def _from_user(db: Session, user: User) -> IdentityRead:
    """Identity for a signed-in multi-user account. Role is stored on the user
    (admin-assigned), not derived. Email always comes from the user row."""
    role = user.role
    booleans = {
        "role": role,
        "is_admin": role == ADMIN_ROLE,
        "is_manager": role in (ADMIN_ROLE, MANAGER_ROLE),
    }
    employee = db.get(Employee, user.employee_id) if user.employee_id else None
    if employee is None:
        return IdentityRead(
            linked=False, email=user.email, name_en=user.display_name, **booleans
        )
    return IdentityRead(
        linked=True,
        employee_id=employee.id,
        email=user.email,
        name_en=employee.name_en,
        name_ar=employee.name_ar,
        position=employee.position,
        department=employee.department,
        photo_url=photo_url_for(db, employee.id),
        **booleans,
    )


def get_identity(db: Session, current_user: User) -> IdentityRead:
    # Multi-user auth: the signed-in user is the single authoritative identity.
    # The EmailAccount link describes the mailbox, not the person, so it is no
    # longer consulted here.
    return _from_user(db, current_user)


__all__ = [
    "get_admin_id",
    "get_identity",
    "photo_url_for",
    "promote_to_admin_if_vacant",
    "set_admin_id",
]
