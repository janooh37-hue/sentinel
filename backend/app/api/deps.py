"""Shared FastAPI dependencies (DB session, settings, auth gates).

The ``gssg_session`` cookie carries an opaque token; ``get_optional_user``
resolves it to the active ``User`` (or ``None``). ``get_current_user`` is the
401 gate and applies the scoped-role route policy (``core.scoped_roles``);
``require_admin`` the 403 gate; ``require_capability("x")`` the
capability-aware 403 gate (effective caps = role defaults ± per-user overrides).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Cookie, Depends, Request
from fastapi.dependencies.models import Dependant
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import Settings, get_settings
from app.core.roles import ADMIN_ROLE, MANAGER_ROLE
from app.core.scoped_roles import scoped_role
from app.db.models import User
from app.db.session import get_db
from app.services import auth_service, perm_service

COOKIE_NAME = "gssg_session"

#: Attribute memoizing, on each matched route, the capabilities it requires through
#: ``require_capability`` dependencies (router- and route-level, nested). Stored on
#: the route, not keyed by ``id(route)``: an id outlives its route and is reused by
#: a later app's route (every test builds an app), which then read another's caps.
_ROUTE_CAPS_ATTR = "_gssg_required_capabilities"


def _dependant_caps(dependant: Dependant) -> set[str]:
    caps: set[str] = set()
    for sub in dependant.dependencies:
        capability = getattr(sub.call, "required_capability", None)
        if isinstance(capability, str):
            caps.add(capability)
        caps |= _dependant_caps(sub)
    return caps


def route_capabilities(route: Any) -> frozenset[str]:
    """The ``require_capability`` ids a matched route depends on."""
    cached: frozenset[str] | None = getattr(route, _ROUTE_CAPS_ATTR, None)
    if cached is None:
        dependant = getattr(route, "dependant", None)
        cached = frozenset(_dependant_caps(dependant)) if dependant is not None else frozenset()
        setattr(route, _ROUTE_CAPS_ATTR, cached)
    return cached


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
    request: Request,
    user: Annotated[User | None, Depends(get_optional_user)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if user is None:
        raise AppError("NOT_AUTHENTICATED", "Not signed in.", http_status=401)
    scoped = scoped_role(user.role)
    if scoped is not None:
        route = request.scope.get("route")
        path = getattr(route, "path", None)
        # Missing route metadata fails closed — never fall through to "allow".
        if path is None or not scoped.allows_route(
            (request.method, path),
            route_capabilities(route),
            perm_service.effective_caps(db, user),
        ):
            raise AppError(
                f"{scoped.error_prefix}_ROUTE_FORBIDDEN",
                "This role cannot use this endpoint.",
                http_status=403,
            )
    return user


def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != ADMIN_ROLE:
        raise AppError("FORBIDDEN", "Admin access required.", http_status=403)
    return user


def require_admin_or_manager(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role not in (ADMIN_ROLE, MANAGER_ROLE):
        raise AppError("FORBIDDEN", "Admin or manager access required.", http_status=403)
    return user


def require_capability(capability: str) -> Callable[..., User]:
    """Build a dependency that 401s if anon, 403s if the user lacks ``capability``.

    Effective capabilities are role defaults ± per-user overrides; admins always
    pass (see ``perm_service.effective_caps``). The capability is also recorded
    on the dependency so the scoped-role route policy can read a route's gates.
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
                details={"capability": capability},
            )
        return user

    _dep.required_capability = capability  # type: ignore[attr-defined]
    return _dep


__all__ = [
    "COOKIE_NAME",
    "get_current_user",
    "get_optional_user",
    "require_admin",
    "require_admin_or_manager",
    "require_capability",
    "route_capabilities",
    "settings_dep",
]
