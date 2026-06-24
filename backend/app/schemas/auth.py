"""Pydantic schemas for the multi-user auth endpoints.

We avoid pydantic ``EmailStr`` (it pulls the optional ``email-validator``
dependency that isn't bundled); a light ``@`` check in the service is enough
for an internal IONOS-only roster.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    """Request-access (or bootstrap-admin) payload."""

    email: str = Field(min_length=3, max_length=256)
    g_number: str | None = Field(default=None, max_length=16)
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=256)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=256)
    password: str = Field(min_length=1, max_length=128)


class VerifyPasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class SessionUser(BaseModel):
    """The signed-in user, shaped for the frontend auth context."""

    id: int
    email: str
    employee_id: str | None = None
    name_en: str | None = None
    name_ar: str | None = None
    position: str | None = None
    department: str | None = None
    photo_url: str | None = None
    role: str
    status: str
    is_admin: bool = False
    is_manager: bool = False
    has_signature: bool = False


class RegisterResult(BaseModel):
    """Outcome of ``POST /auth/register``.

    ``status='active'`` means the account was the first one and was
    auto-promoted to admin (``user`` is populated + a session is set);
    ``status='pending'`` means it awaits admin approval.
    """

    status: str
    is_first: bool
    user: SessionUser | None = None


class AdminUserRead(BaseModel):
    id: int
    email: str
    employee_id: str | None = None
    display_name: str | None = None
    name_en: str | None = None
    role: str
    status: str
    failed_attempts: int
    last_login_at: datetime | None = None
    created_at: datetime | None = None
    is_default_manager: bool = False


class ApproveRequest(BaseModel):
    role: str = "operator"
    employee_id: str | None = Field(default=None, max_length=16)


class SetRoleRequest(BaseModel):
    role: str


class DefaultManagerRequest(BaseModel):
    """Set/clear the single-holder default-manager flag (spec 2026-06-11 §5)."""

    enabled: bool


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class RejectRequest(BaseModel):
    """Decline a pending request. ``reason`` is recorded in the audit log."""

    reason: str | None = Field(default=None, max_length=512)


class AuditEntryRead(BaseModel):
    """One user-management event, projected for the History tab."""

    id: int
    action: str
    actor: str | None = None
    target_email: str | None = None
    target_g: str | None = None
    target_name: str | None = None
    role: str | None = None
    reason: str | None = None
    ts: datetime


# ─── Permission matrix ──────────────────────────────────────────────────────


class CapabilityRead(BaseModel):
    """One capability in the catalog, with which roles grant it by default."""

    id: str
    domain: str
    label: str
    default_roles: list[str]


class UserPermissionRead(BaseModel):
    """A user's effective capabilities + the per-capability override state.

    ``effective`` is the resolved set (role defaults ± overrides). ``overrides``
    maps capability id → ``grant``/``deny`` for the rows the admin has set.
    ``role_defaults`` is the user's role preset, so the UI can show
    inherited-vs-overridden.
    """

    user_id: int
    role: str
    is_admin: bool
    effective: list[str]
    role_defaults: list[str]
    overrides: dict[str, str]


class SetPermissionRequest(BaseModel):
    """Set or clear a single per-user capability override.

    ``effect`` is ``grant`` / ``deny`` to set, or ``null`` to clear (revert to
    the role default).
    """

    capability: str = Field(min_length=1, max_length=64)
    effect: str | None = None


__all__ = [
    "AdminUserRead",
    "ApproveRequest",
    "AuditEntryRead",
    "CapabilityRead",
    "LoginRequest",
    "RegisterRequest",
    "RegisterResult",
    "RejectRequest",
    "ResetPasswordRequest",
    "SessionUser",
    "SetPermissionRequest",
    "SetRoleRequest",
    "UserPermissionRead",
    "VerifyPasswordRequest",
]
