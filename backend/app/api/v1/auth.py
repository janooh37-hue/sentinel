"""Multi-user authentication endpoints.

POST /auth/register               → request access (or bootstrap the first admin)
POST /auth/login                  → verify + set the gssg_session cookie
POST /auth/logout                 → revoke session + clear cookie
GET  /auth/me                     → the signed-in user (401 if not signed in)
POST /auth/verify-password        → re-auth for the lock screen

Public, unauthenticated (email-mail feature; disabled → 503 where applicable):
GET  /auth/features               → { account_mail: bool }
POST /auth/verify-email/request   → mail a fresh confirmation link
POST /auth/verify-email           → consume a confirmation link
POST /auth/password-reset/request → mail a fresh reset link
POST /auth/password-reset/complete → consume a reset link, set new password

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

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import COOKIE_NAME, get_current_user, require_admin
from app.api.errors import AppError
from app.config import get_settings
from app.core import ratelimit
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
from app.core.permissions import (
    CAPABILITIES,
    CATEGORY_CAP_PREFIX,
    ROLE_DEFAULTS,
    SERVICE_CAP_PREFIX,
    SERVICE_RECORDS_CAP_PREFIX,
)
from app.db.models import BookCategory, User
from app.db.session import get_db
from app.schemas.auth import (
    AcceptedResult,
    AdminUserRead,
    ApproveRequest,
    AuditEntryRead,
    AuthFeatures,
    CapabilityRead,
    DefaultManagerRequest,
    EmailLinkRequest,
    LinkSelfRequest,
    LockLayoutRequest,
    LockTimerRequest,
    LoginRequest,
    PasswordResetCompleteRequest,
    PasswordResetCompleteResult,
    RegisterRequest,
    RegisterResult,
    RejectRequest,
    ResetPasswordRequest,
    SessionUser,
    SetPermissionBulkRequest,
    SetPermissionRequest,
    SetRoleRequest,
    TokenRequest,
    UserPermissionRead,
    VerifyEmailResult,
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
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
) -> RegisterResult:
    # Throttle anonymous account creation (internet-reachable via gssg.app):
    # every attempt costs a password hash, and unbounded signups would flood
    # the pending-approval queue — companion to the login limiter (AUTH-03).
    ratelimit.enforce(ratelimit.register_limiter, request)
    user, is_first = auth_service.register(
        db,
        email=payload.email,
        password=payload.password,
        g_number=payload.g_number,
        display_name=payload.display_name,
    )
    if get_settings().account_mail_enabled:
        # Every account — including the first — must confirm its email before
        # it can sign in or be approved, so no cookie is set here either way.
        background_tasks.add_task(
            auth_service.request_email_link, user.email, "verify", payload.locale
        )
        return RegisterResult(status="verify_email", is_first=is_first, user=None)
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
    token = auth_service.start_session(db, user, user_agent=request.headers.get("user-agent"))
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


# ─── Account mail: verification + self-service password reset (public) ─────


@router.get("/features", response_model=AuthFeatures)
def auth_features() -> AuthFeatures:
    return AuthFeatures(account_mail=get_settings().account_mail_enabled)


@router.post(
    "/verify-email/request", response_model=AcceptedResult, status_code=status.HTTP_202_ACCEPTED
)
def request_email_verification(
    payload: EmailLinkRequest,
    request: Request,
    background_tasks: BackgroundTasks,
) -> AcceptedResult:
    if not get_settings().account_mail_enabled:
        raise AppError(
            "ACCOUNT_MAIL_DISABLED",
            "Email delivery is not configured. Contact IT.",
            http_status=503,
        )
    ratelimit.enforce(ratelimit.email_verify_limiter, request)
    normalized = auth_service.normalize_email(payload.email)
    # Never reveal whether the address exists: always 202, lookup happens in
    # the background task after this response is sent.
    if ratelimit.email_address_limiter.allow(normalized):
        background_tasks.add_task(
            auth_service.request_email_link, normalized, "verify", payload.locale
        )
    return AcceptedResult()


@router.post("/verify-email", response_model=VerifyEmailResult)
def verify_email(
    payload: TokenRequest, request: Request, db: Annotated[Session, Depends(get_db)]
) -> VerifyEmailResult:
    ratelimit.enforce(ratelimit.email_verify_limiter, request)
    auth_service.verify_email(db, payload.token)
    return VerifyEmailResult()


@router.post(
    "/password-reset/request",
    response_model=AcceptedResult,
    status_code=status.HTTP_202_ACCEPTED,
)
def request_password_reset(
    payload: EmailLinkRequest,
    request: Request,
    background_tasks: BackgroundTasks,
) -> AcceptedResult:
    if not get_settings().account_mail_enabled:
        raise AppError(
            "ACCOUNT_MAIL_DISABLED",
            "Email delivery is not configured. Contact IT.",
            http_status=503,
        )
    ratelimit.enforce(ratelimit.password_reset_limiter, request)
    normalized = auth_service.normalize_email(payload.email)
    if ratelimit.email_address_limiter.allow(normalized):
        background_tasks.add_task(
            auth_service.request_email_link, normalized, "reset", payload.locale
        )
    return AcceptedResult()


@router.post("/password-reset/complete", response_model=PasswordResetCompleteResult)
def complete_password_reset(
    payload: PasswordResetCompleteRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> PasswordResetCompleteResult:
    ratelimit.enforce(ratelimit.password_reset_limiter, request)
    auth_service.complete_password_reset(db, payload.token, payload.password)
    # An already-signed-in browser's cookie was just revoked server-side —
    # drop it client-side too so the app doesn't keep presenting a dead session.
    response.delete_cookie(COOKIE_NAME, path="/")
    return PasswordResetCompleteResult()


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


@router.patch("/me/lock-timer", response_model=SessionUser)
def set_my_lock_timer(
    body: LockTimerRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SessionUser:
    """Set the signed-in user's per-account lock-screen idle timeout."""

    updated = auth_service.set_lock_timer(db, user, body.idle_lock_seconds)
    return auth_service.to_session_user(db, updated)


@router.patch("/me/lock-layout", response_model=SessionUser)
def set_my_lock_layout(
    body: LockLayoutRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SessionUser:
    """Set the signed-in user's per-account lock-screen layout."""

    updated = auth_service.set_lock_layout(db, user, body.lock_layout)
    return auth_service.to_session_user(db, updated)


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
    user = auth_service.reject_user(db, user_id, reason=body.reason, actor=_actor(admin))
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
    user = auth_service.set_default_manager(db, user_id, enabled=body.enabled, actor=_actor(admin))
    return auth_service.admin_read(db, user)


# ─── Permission matrix (admin) ───────────────────────────────────────────────


@router.get("/capabilities", response_model=list[CapabilityRead])
def list_capabilities(
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> list[CapabilityRead]:
    """The static catalog followed by dynamic service/category capabilities."""
    default_roles = ["operator", "manager", "admin"]
    static = [
        CapabilityRead(
            id=cap.id,
            domain=cap.domain,
            label=cap.label,
            description=cap.description,
            default_roles=[role for role, caps in ROLE_DEFAULTS.items() if cap.id in caps],
        )
        for cap in CAPABILITIES
    ]
    services = [
        CapabilityRead(
            id=f"{SERVICE_CAP_PREFIX}{service_id}",
            domain="services",
            label="Other" if service_id == OTHER_SERVICE_ID else service_id,
            description="",
            default_roles=default_roles,
        )
        for service_id in (*SERVICE_IDS, OTHER_SERVICE_ID)
    ]
    service_records = [
        CapabilityRead(
            id=f"{SERVICE_RECORDS_CAP_PREFIX}{service_id}",
            domain="books",
            label=(
                "Records: Other" if service_id == OTHER_SERVICE_ID else f"Records: {service_id}"
            ),
            description="",
            default_roles=default_roles,
        )
        for service_id in (*SERVICE_IDS, OTHER_SERVICE_ID)
    ]
    categories = [
        CapabilityRead(
            id=f"{CATEGORY_CAP_PREFIX}{row.id}",
            domain="categories",
            label=row.name_en or row.id,
            description=row.name_ar or "",
            default_roles=default_roles,
        )
        for row in db.scalars(select(BookCategory).order_by(BookCategory.id)).all()
    ]
    return [*static, *services, *service_records, *categories]


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
        role_defaults=sorted(perm_service.role_default_caps_with_dynamic(db, user.role)),
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
    perm_service.set_user_override(
        db, user.id, body.capability, body.effect, actor=admin, expires_at=body.expires_at
    )
    auth_service.audit_permission_change(
        db, actor=_actor(admin), user=user, capability=body.capability, effect=body.effect
    )
    return UserPermissionRead(
        user_id=user.id,
        role=user.role,
        is_admin=user.role == "admin",
        effective=sorted(perm_service.effective_caps(db, user)),
        role_defaults=sorted(perm_service.role_default_caps_with_dynamic(db, user.role)),
        overrides=perm_service.get_user_overrides(db, user.id),
    )


@router.put("/users/{user_id}/permissions/bulk", response_model=UserPermissionRead)
def set_user_permissions_bulk(
    user_id: int,
    body: SetPermissionBulkRequest,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> UserPermissionRead:
    """Apply several override changes in one all-or-nothing call."""
    user = auth_service.require_user(db, user_id)
    perm_service.set_user_overrides(
        db, user.id, [(i.capability, i.effect, i.expires_at) for i in body.items], actor=admin
    )
    for item in body.items:
        auth_service.audit_permission_change(
            db, actor=_actor(admin), user=user, capability=item.capability, effect=item.effect
        )
    return UserPermissionRead(
        user_id=user.id,
        role=user.role,
        is_admin=user.role == "admin",
        effective=sorted(perm_service.effective_caps(db, user)),
        role_defaults=sorted(perm_service.role_default_caps_with_dynamic(db, user.role)),
        overrides=perm_service.get_user_overrides(db, user.id),
    )


__all__ = ["router"]
