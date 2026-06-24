"""Shared FastAPI dependencies (DB session, settings, auth gates).

The ``gssg_session`` cookie carries an opaque token; ``get_optional_user``
resolves it to the active ``User`` (or ``None``). ``get_current_user`` is the
401 gate; ``require_admin`` the 403 gate; ``require_capability("x")`` the
capability-aware 403 gate (effective caps = role defaults ± per-user overrides).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated

from fastapi import Cookie, Depends
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import Settings, get_settings
from app.core.roles import ADMIN_ROLE
from app.db.models import User
from app.db.session import get_db
from app.services import auth_service, perm_service

COOKIE_NAME = "gssg_session"


def settings_dep() -> Settings:
    return get_settings()


def get_optional_user(
    db: Annotated[Session, Depends(get_db)],
    gssg_session: Annotated[str | None, Cookie()] = None,
) -> User | None:
    if not gssg_session:
        return None
    return auth_service.resolve_session(db, gssg_session)


def get_current_user(
    user: Annotated[User | None, Depends(get_optional_user)],
) -> User:
    if user is None:
        raise AppError("NOT_AUTHENTICATED", "Not signed in.", http_status=401)
    return user


def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != ADMIN_ROLE:
        raise AppError("FORBIDDEN", "Admin access required.", http_status=403)
    return user


def require_capability(capability: str) -> Callable[..., User]:
    """Build a dependency that 401s if anon, 403s if the user lacks ``capability``.

    Effective capabilities are role defaults ± per-user overrides; admins always
    pass (see ``perm_service.effective_caps``).
    """

    def _dep(
        user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ) -> User:
        if not perm_service.has_capability(db, user, capability):
            raise AppError(
                "FORBIDDEN",
                f"Missing capability: {capability}",
                http_status=403,
            )
        return user

    return _dep


__all__ = [
    "COOKIE_NAME",
    "get_current_user",
    "get_optional_user",
    "require_admin",
    "require_capability",
    "settings_dep",
]
