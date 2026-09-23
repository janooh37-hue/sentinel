"""Shared FastAPI dependencies (DB session, settings, auth gates).

The ``gssg_session`` cookie carries an opaque token; ``get_optional_user``
resolves it to the active ``User`` (or ``None``). ``get_current_user`` is the
401 gate; ``require_admin`` the 403 gate; ``require_capability("x")`` the
capability-aware 403 gate (effective caps = role defaults ± per-user overrides).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated

from fastapi import Cookie, Depends, Request
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import Settings, get_settings
from app.core.roles import ADMIN_ROLE, INMATE_REPORTER_ROLE
from app.db.models import User
from app.db.session import get_db
from app.services import auth_service, perm_service

COOKIE_NAME = "gssg_session"

#: The complete authenticated-route surface for ``inmate_reporter`` — a fixed
#: allowlist, not a capability policy: capability filtering alone does not
#: close self-signature, dashboard summary, manager lists, permission
#: requests, monthly statistics, notification, attachment, Word, review, or
#: admin APIs. (method, registered route TEMPLATE path) — never a prefix
#: test, so a new route is closed by default. Public login/logout/password-
#: setup routes don't depend on ``get_current_user`` and are unaffected.
_INMATE_REPORTER_ALLOWED_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/v1/auth/me"),
        ("POST", "/api/v1/auth/verify-password"),
        ("PATCH", "/api/v1/auth/me/lock-timer"),
        ("PATCH", "/api/v1/auth/me/lock-layout"),
        ("GET", "/api/v1/auth/me/capabilities"),
        ("GET", "/api/v1/identity/me"),
        ("GET", "/api/v1/templates"),
        ("GET", "/api/v1/templates/{template_id}/fields"),
        ("GET", "/api/v1/inmate-violations/nationalities"),
        ("GET", "/api/v1/book-categories"),
        ("GET", "/api/v1/books"),
        ("GET", "/api/v1/books/facets"),
        ("GET", "/api/v1/books/by-ref/{ref}"),
        ("GET", "/api/v1/books/{book_id}"),
        ("GET", "/api/v1/books/{book_id}/versions/{version_id}/fields"),
        ("GET", "/api/v1/books/{book_id}/versions/{version_id}/annotations"),
        ("GET", "/api/v1/books/{book_id}/versions/{version_id}/signed-document"),
        ("GET", "/api/v1/books/{book_id}/imported-document"),
        ("POST", "/api/v1/books/{book_id}/submit"),
        ("POST", "/api/v1/documents/generate"),
        ("GET", "/api/v1/jobs/{job_id}"),
        ("GET", "/api/v1/documents/{document_id}/download"),
    }
)


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
) -> User:
    if user is None:
        raise AppError("NOT_AUTHENTICATED", "Not signed in.", http_status=401)
    if user.role == INMATE_REPORTER_ROLE:
        route = request.scope.get("route")
        path = getattr(route, "path", None)
        # Missing route metadata fails closed — never fall through to "allow".
        if path is None or (request.method, path) not in _INMATE_REPORTER_ALLOWED_ROUTES:
            raise AppError(
                "INMATE_REPORTER_ROUTE_FORBIDDEN",
                "This role cannot use this endpoint.",
                http_status=403,
            )
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
                details={"capability": capability},
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
