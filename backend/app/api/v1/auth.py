"""Multi-user authentication endpoints.

  POST /auth/register          → request access (or bootstrap the first admin)
  POST /auth/login             → verify + set the gssg_session cookie
  POST /auth/logout            → revoke session + clear cookie
  GET  /auth/me                → the signed-in user (401 if not signed in)
  POST /auth/verify-password   → re-auth for the lock screen

  Admin (require_admin):
  GET   /auth/users
  POST  /auth/users/{id}/approve
  POST  /auth/users/{id}/reset-password
  PATCH /auth/users/{id}/role
  POST  /auth/users/{id}/lock | /unlock
  POST  /auth/users/{id}/default-manager
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import COOKIE_NAME, get_current_user, require_admin
from app.config import get_settings
from app.core import ratelimit
from app.core.permissions import CAPABILITIES, ROLE_DEFAULTS
from app.db.models import User
from app.db.session import get_db
from app.schemas.auth import (
    AdminUserRead,
    ApproveRequest,
    AuditEntryRead,
    CapabilityRead,
    DefaultManagerRequest,
    LinkSelfRequest,
    LoginRequest,
    RegisterRequest,
    RegisterResult,
    RejectRequest,
    ResetPasswordRequest,
    SessionUser,
    SetPermissionRequest,
    SetRoleRequest,
    UserPermissionRead,
    VerifyPasswordRequest,
)
from app.services import auth_service, perm_service, user_signature_service

router = APIRouter(prefix="/auth", tags=["auth"])

_MAX_AGE = int(auth_service.SESSION_TTL.total_seconds())


def _actor(admin: User) -> str:
    """Human-readable actor label for the audit log."""
    return admin.display_name or admin.email


def _set_session_cookie(response: Response, token: str) -> None:
    # Secure is gated on settings so LAN-HTTP dev works (False by default)
    # while production-HTTPS (Caddy terminator) flips it on via
    # GSSG_SECURE_COOKIES=1 in the service environment.
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=get_settings().secure_cookies,
        path="/",
    )


@router.post("/register", response_model=RegisterResult)
def register(
    payload: RegisterRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> RegisterResult:
    user, is_first = auth_service.register(
        db,
        email=payload.email,
        password=payload.password,
        g_number=payload.g_number,
        display_name=payload.display_name,
    )
    if is_first:
        token = auth_service.start_session(db, user)
        _set_session_cookie(response, token)
        return RegisterResult(
            status="active",
            is_first=True,
            user=auth_service.to_session_user(db, user),
        )
    return RegisterResult(status="pending", is_first=False, user=None)


@router.post("/login", response_model=SessionUser)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> SessionUser:
    # Global per-IP throttle so credential-stuffing / enumeration spray can't
    # hammer login at full speed (the per-account lockout doesn't cover spray
    # across many accounts) — AUTH-03.
    ratelimit.enforce(ratelimit.login_limiter, request)
    user = auth_service.authenticate(db, payload.email, payload.password)
    token = auth_service.start_session(
        db, user, user_agent=request.headers.get("user-agent")
    )
    _set_session_cookie(response, token)
    return auth_service.to_session_user(db, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        auth_service.revoke_session(db, token)
    resp = Response(status_code=status.HTTP_204_NO_CONTENT)
    resp.delete_cookie(COOKIE_NAME, path="/")
    return resp


@router.get("/me", response_model=SessionUser)
def me(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SessionUser:
    return auth_service.to_session_user(db, user)


@router.post("/verify-password", status_code=status.HTTP_204_NO_CONTENT)
def verify_password(
    payload: VerifyPasswordRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """Re-auth the signed-in user (lock-screen unlock).

    Routes through the shared failed-attempt counter + lockout so the lock
    screen can't bypass the login lockout.
    """
    auth_service.verify_password_for(db, user, payload.password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/me/link", response_model=SessionUser)
def link_my_employee(
    body: LinkSelfRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SessionUser:
    """Link the signed-in user to their own employee record (G-number).

    Sets ``User.employee_id`` — the authoritative identity source — so the
    "Link your employee record" picker actually flips ``identity.linked``.
    Changing/clearing an existing link is admin-only (enforced in the service).
    """
    updated = auth_service.link_self(db, user, employee_id=body.employee_id)
    return auth_service.to_session_user(db, updated)


@router.post("/me/signature", response_model=SessionUser)
async def upload_my_signature(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: Annotated[UploadFile, File()],
) -> SessionUser:
    data = await file.read()
    user_signature_service.save_signature(db, user, file.filename or "sig.png", data)
    return auth_service.to_session_user(db, user)


@router.delete("/me/signature", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_signature(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    user_signature_service.clear_signature(db, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/capabilities", response_model=list[str])
def my_capabilities(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[str]:
    """The signed-in user's own effective capabilities — drives the UI gates."""
    return sorted(perm_service.effective_caps(db, user))


# ─── Admin user management ──────────────────────────────────────────────────────


@router.get("/users", response_model=list[AdminUserRead])
def list_users(
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> list[AdminUserRead]:
    return auth_service.list_users(db)


@router.get("/audit", response_model=list[AuditEntryRead])
def list_audit(
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = 50,
) -> list[AuditEntryRead]:
    return auth_service.list_audit(db, limit=min(max(limit, 1), 200))


@router.post("/users/{user_id}/approve", response_model=AdminUserRead)
def approve_user(
    user_id: int,
    body: ApproveRequest,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserRead:
    user = auth_service.approve_user(
        db, user_id, role=body.role, employee_id=body.employee_id, actor=_actor(admin)
    )
    return auth_service.admin_read(db, user)


@router.post("/users/{user_id}/reject", response_model=AdminUserRead)
def reject_user(
    user_id: int,
    body: RejectRequest,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserRead:
    user = auth_service.reject_user(
        db, user_id, reason=body.reason, actor=_actor(admin)
    )
    return auth_service.admin_read(db, user)


@router.post("/users/{user_id}/reset-password", response_model=AdminUserRead)
def reset_password(
    user_id: int,
    body: ResetPasswordRequest,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserRead:
    user = auth_service.reset_password(db, user_id, body.password, actor=_actor(admin))
    return auth_service.admin_read(db, user)


@router.patch("/users/{user_id}/role", response_model=AdminUserRead)
def set_role(
    user_id: int,
    body: SetRoleRequest,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserRead:
    user = auth_service.set_role(db, user_id, body.role, actor=_actor(admin))
    return auth_service.admin_read(db, user)


@router.post("/users/{user_id}/lock", response_model=AdminUserRead)
def lock_user(
    user_id: int,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserRead:
    user = auth_service.set_status(db, user_id, "locked", actor=_actor(admin))
    return auth_service.admin_read(db, user)


@router.post("/users/{user_id}/unlock", response_model=AdminUserRead)
def unlock_user(
    user_id: int,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserRead:
    user = auth_service.set_status(db, user_id, "active", actor=_actor(admin))
    return auth_service.admin_read(db, user)


@router.post("/users/{user_id}/default-manager", response_model=AdminUserRead)
def set_default_manager(
    user_id: int,
    body: DefaultManagerRequest,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminUserRead:
    """Set/clear the single default manager — in_app forms auto-submit to them.

    Eligibility (when enabling): active + ``books.approve`` + uploaded
    signature, else 422 ``NOT_ELIGIBLE``. Any previous holder is cleared in
    the same transaction (single-holder invariant).
    """
    user = auth_service.set_default_manager(
        db, user_id, enabled=body.enabled, actor=_actor(admin)
    )
    return auth_service.admin_read(db, user)


# ─── Permission matrix (admin) ───────────────────────────────────────────────


@router.get("/capabilities", response_model=list[CapabilityRead])
def list_capabilities(
    _admin: Annotated[User, Depends(require_admin)],
) -> list[CapabilityRead]:
    """The full capability catalog + which roles grant each by default."""
    return [
        CapabilityRead(
            id=cap.id,
            domain=cap.domain,
            label=cap.label,
            default_roles=[
                role for role, caps in ROLE_DEFAULTS.items() if cap.id in caps
            ],
        )
        for cap in CAPABILITIES
    ]


@router.get("/users/{user_id}/permissions", response_model=UserPermissionRead)
def get_user_permissions(
    user_id: int,
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> UserPermissionRead:
    """The target user's effective capabilities + per-capability overrides."""
    user = auth_service.require_user(db, user_id)
    return UserPermissionRead(
        user_id=user.id,
        role=user.role,
        is_admin=user.role == "admin",
        effective=sorted(perm_service.effective_caps(db, user)),
        role_defaults=sorted(perm_service.role_default_caps(db, user.role)),
        overrides=perm_service.get_user_overrides(db, user.id),
    )


@router.put("/users/{user_id}/permissions", response_model=UserPermissionRead)
def set_user_permission(
    user_id: int,
    body: SetPermissionRequest,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> UserPermissionRead:
    """Set or clear one per-user capability override (grant/deny/null)."""
    user = auth_service.require_user(db, user_id)
    perm_service.set_user_override(db, user.id, body.capability, body.effect, actor=admin)
    auth_service.audit_permission_change(
        db, actor=_actor(admin), user=user, capability=body.capability, effect=body.effect
    )
    return UserPermissionRead(
        user_id=user.id,
        role=user.role,
        is_admin=user.role == "admin",
        effective=sorted(perm_service.effective_caps(db, user)),
        role_defaults=sorted(perm_service.role_default_caps(db, user.role)),
        overrides=perm_service.get_user_overrides(db, user.id),
    )


__all__ = ["router"]
