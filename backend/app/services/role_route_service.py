"""Pure fixed-role route restrictions shared by auth and access diagnostics."""

from __future__ import annotations

from app.api.errors import AppError
from app.core.roles import INMATE_REPORTER_ROLE
from app.services.action_guard_service import GuardDecision

# Registered route templates, never prefixes. New routes fail closed for this
# fixed-scope role. Public auth routes do not depend on the authenticated gate.
_INMATE_REPORTER_ALLOWED_ROUTES: frozenset[tuple[str, str]] = frozenset(
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


def role_route_decision(role: str, method: str, route_path: str | None) -> GuardDecision:
    """Decide the actual authenticated-route boundary without request state."""
    if role != INMATE_REPORTER_ROLE or (method, route_path) in _INMATE_REPORTER_ALLOWED_ROUTES:
        return GuardDecision(True, "role.route")
    return GuardDecision(
        False,
        "role.route",
        error=AppError(
            "INMATE_REPORTER_ROUTE_FORBIDDEN",
            "This role cannot use this endpoint.",
            http_status=403,
        ),
    )
