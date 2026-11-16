"""Scoped roles: built-in roles with a fixed capability ceiling.

A scoped role is assigned by an administrator and never derived. Per-user
grants can never widen its ceiling (``perm_service`` masks effective caps and
refuses grant overrides outside it), and its authenticated routes fail closed
(``api.deps.get_current_user``).

Two route policies exist:

* an explicit allowlist of ``(method, route template)`` pairs
  (``inmate_reporter``: its exact historical surface);
* capability-derived (``route_allowlist is None``): a route is allowed when it
  carries at least one ``require_capability`` dependency and the user holds
  every such capability, or when it is in ``SCOPED_SHARED_ROUTES``.

Restrictions shared by every scoped role (no Direct send, never a send
recipient or in the user directory, no Level change, no derive, no folders,
PDF-only downloads) are expressed with ``is_scoped_role``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from app.core.permissions import FLEET_REPORTER_CAPS, INMATE_REPORTER_CAPS
from app.core.roles import FLEET_REPORTER_ROLE, INMATE_REPORTER_ROLE

if TYPE_CHECKING:
    from app.db.models import User

RouteKey = tuple[str, str]

#: The complete authenticated-route surface for ``inmate_reporter`` — a fixed
#: allowlist, not a capability policy: capability filtering alone does not
#: close self-signature, dashboard summary, manager lists, permission
#: requests, monthly statistics, notification, attachment, Word, review, or
#: admin APIs. (method, registered route TEMPLATE path) — never a prefix
#: test, so a new route is closed by default. Public login/logout/password-
#: setup routes don't depend on ``get_current_user`` and are unaffected.
INMATE_REPORTER_ALLOWED_ROUTES: Final[frozenset[RouteKey]] = frozenset(
    {
        ("GET", "/api/v1/auth/me"),
        ("POST", "/api/v1/auth/verify-password"),
        ("PATCH", "/api/v1/auth/me/lock-timer"),
        ("PATCH", "/api/v1/auth/me/lock-layout"),
        ("GET", "/api/v1/auth/me/capabilities"),
        ("GET", "/api/v1/identity/me"),
        ("GET", "/api/v1/signatures/me"),
        ("POST", "/api/v1/auth/me/signature"),
        ("POST", "/api/v1/books/word-sessions"),
        ("GET", "/api/v1/books/{book_id}/word-sessions/status"),
        ("GET", "/api/v1/books/{book_id}/word-sessions/preview"),
        ("POST", "/api/v1/books/{book_id}/word-sessions/finish"),
        ("DELETE", "/api/v1/books/{book_id}/word-sessions"),
        ("POST", "/api/v1/books/{book_id}/word-sessions"),
        ("GET", "/api/v1/employees/{employee_id}/photo"),
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

#: Routes with no ``require_capability`` dependency that a capability-derived
#: scoped role may still call. Each is either self-service or gated inside its
#: handler; the reasons are recorded in docs/permissions-enforcement.md.
SCOPED_SHARED_ROUTES: Final[frozenset[RouteKey]] = frozenset(
    {
        # Session, lock screen and UI capability gates.
        ("GET", "/api/v1/auth/me"),
        ("POST", "/api/v1/auth/verify-password"),
        ("PATCH", "/api/v1/auth/me/lock-timer"),
        ("PATCH", "/api/v1/auth/me/lock-layout"),
        ("GET", "/api/v1/auth/me/capabilities"),
        ("GET", "/api/v1/identity/me"),
        ("GET", "/api/v1/employees/{employee_id}/photo"),
        # Own signature: a Report is author-signed.
        ("GET", "/api/v1/signatures/me"),
        ("POST", "/api/v1/auth/me/signature"),
        # Rich-editor publication; authorized in the handler.
        ("GET", "/api/v1/templates"),
        ("GET", "/api/v1/templates/{template_id}/fields"),
        ("GET", "/api/v1/general-book/recipients"),
        ("POST", "/api/v1/documents/generate"),
        ("GET", "/api/v1/documents/{document_id}/download"),
        # Word authoring of own General Books and Reports; authorized in the handler.
        ("POST", "/api/v1/books/word-sessions"),
        ("GET", "/api/v1/books/{book_id}/word-sessions"),
        ("GET", "/api/v1/books/{book_id}/word-sessions/status"),
        ("GET", "/api/v1/books/{book_id}/word-sessions/preview"),
        ("POST", "/api/v1/books/{book_id}/word-sessions/finish"),
        ("DELETE", "/api/v1/books/{book_id}/word-sessions"),
        ("POST", "/api/v1/books/{book_id}/word-sessions"),
        # Record reads; resolve_book_read_access decides in the handler.
        ("GET", "/api/v1/books/by-ref/{ref}"),
        ("GET", "/api/v1/books/{book_id}"),
        ("GET", "/api/v1/books/{book_id}/versions/{version_id}/fields"),
        ("GET", "/api/v1/books/{book_id}/versions/{version_id}/annotations"),
        ("GET", "/api/v1/books/{book_id}/versions/{version_id}/signed-document"),
        ("GET", "/api/v1/books/{book_id}/imported-document"),
        # The author is told of return, reject and finish.
        ("GET", "/api/v1/notifications/decisions"),
        ("POST", "/api/v1/notifications/decisions/seen"),
        # Opening one decision marks it seen: own markers only, read-checked.
        ("POST", "/api/v1/books/{book_id}/seen"),
        ("GET", "/api/v1/push/vapid-public-key"),
        ("POST", "/api/v1/push/subscribe"),
        ("DELETE", "/api/v1/push/subscribe"),
    }
)


@dataclass(frozen=True, slots=True)
class ScopedRole:
    """A built-in role with a fixed capability ceiling and a fail-closed route policy."""

    role: str
    #: Capability ids the role can ever hold; grants outside it are refused.
    ceiling: frozenset[str]
    #: Error-code prefix (``<prefix>_ROUTE_FORBIDDEN``, ``<prefix>_SCOPE_FIXED``).
    error_prefix: str
    #: Explicit route allowlist, or ``None`` for the capability-derived policy.
    route_allowlist: frozenset[RouteKey] | None
    #: Submissions route to the account's admin-set line manager.
    routes_to_line_manager: bool = False
    #: Services authorised by their service capabilities alone: the record-category
    #: gate never applies to them for this role (create, open, list, submit, revise).
    category_exempt_services: frozenset[str] = frozenset()

    def allows_route(self, route: RouteKey, route_caps: frozenset[str], caps: set[str]) -> bool:
        if self.route_allowlist is not None:
            return route in self.route_allowlist
        if route_caps:
            return route_caps <= caps
        return route in SCOPED_SHARED_ROUTES


SCOPED_ROLES: Final[dict[str, ScopedRole]] = {
    INMATE_REPORTER_ROLE: ScopedRole(
        role=INMATE_REPORTER_ROLE,
        ceiling=INMATE_REPORTER_CAPS,
        error_prefix="INMATE_REPORTER",
        route_allowlist=INMATE_REPORTER_ALLOWED_ROUTES,
    ),
    FLEET_REPORTER_ROLE: ScopedRole(
        role=FLEET_REPORTER_ROLE,
        ceiling=FLEET_REPORTER_CAPS,
        error_prefix="SCOPED_ROLE",
        route_allowlist=None,
        routes_to_line_manager=True,
        # A Report has no classification; its record category (13/1) stays out
        # of the ceiling, so it answers to books.service/servicerecords.Report.
        category_exempt_services=frozenset({"Report"}),
    ),
}

#: Roles whose submissions route to the account's line manager.
LINE_MANAGER_ROLES: Final[frozenset[str]] = frozenset(
    role for role, scoped in SCOPED_ROLES.items() if scoped.routes_to_line_manager
)


def scoped_role(role: str | None) -> ScopedRole | None:
    return SCOPED_ROLES.get(role) if role is not None else None


def category_exempt_services(user: User) -> frozenset[str]:
    """Services the user's scoped role authorises without the record-category gate."""
    scoped = SCOPED_ROLES.get(user.role)
    return scoped.category_exempt_services if scoped is not None else frozenset()


def is_scoped_role(user: User) -> bool:
    return user.role in SCOPED_ROLES


def routes_to_line_manager(user: User) -> bool:
    return user.role in LINE_MANAGER_ROLES


__all__ = [
    "INMATE_REPORTER_ALLOWED_ROUTES",
    "LINE_MANAGER_ROLES",
    "SCOPED_ROLES",
    "SCOPED_SHARED_ROUTES",
    "ScopedRole",
    "category_exempt_services",
    "is_scoped_role",
    "routes_to_line_manager",
    "scoped_role",
]
