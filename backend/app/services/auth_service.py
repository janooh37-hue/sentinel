"""Multi-user authentication service.

Owns the user lifecycle (register → pending → approved), password checks with
lockout, and server-side sessions backing the ``gssg_session`` cookie.

Decisions (see ``docs/superpowers/plans/2026-05-24-multi-user-login.md``):

* The **first** registered account is auto-approved, made ``admin``, and fills
  the ``settings.admin_employee_id`` slot. Every later account is ``pending``.
* Wrong passwords increment ``failed_attempts``; the 5th failure flips
  ``status`` to ``locked`` (an admin clears it).
* Roles are stored on the user row and are authoritative for auth.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, func, select, update
from sqlalchemy.orm import Session

from app.api.errors import AppError, ValidationFailedError
from app.config import get_settings
from app.core import security
from app.core.roles import ADMIN_ROLE, MANAGER_ROLE, OPERATOR_ROLE
from app.db.models import AuditLog, Employee, User
from app.db.models import AuthSession as AuthSessionModel
from app.schemas.auth import AdminUserRead, AuditEntryRead, SessionUser
from app.services import account_mailer, account_token_service, identity_service, perm_service

log = logging.getLogger(__name__)

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
# 7 days: shortened from 14 when gssg.app went public — bounds how long a
# stolen cookie stays valid on a lost/unattended device (cookie max-age in
# api/v1/auth.py derives from this).
SESSION_TTL = timedelta(days=7)
# Refresh ``last_seen_at`` at most this often to avoid a commit on every request.
SESSION_TOUCH_INTERVAL = timedelta(seconds=60)
_VALID_ROLES = (OPERATOR_ROLE, MANAGER_ROLE, ADMIN_ROLE)


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _verification_required(user: User) -> bool:
    """True when ``user`` must confirm their email before signing in/approval.

    Gated on ``settings.account_mail_enabled`` — while the flag is off,
    verification is not enforced anywhere (today's behaviour).
    """
    return get_settings().account_mail_enabled and user.email_verified_at is None


# ─── Lookups ──────────────────────────────────────────────────────────────────


def get_by_email(db: Session, email: str) -> User | None:
    return db.execute(select(User).where(User.email == normalize_email(email))).scalar_one_or_none()


def count_users(db: Session) -> int:
    return db.execute(select(func.count()).select_from(User)).scalar_one()


def count_active_admins(db: Session) -> int:
    """Number of users who are both ``admin`` and ``active`` (can sign in)."""
    return db.execute(
        select(func.count())
        .select_from(User)
        .where(User.role == ADMIN_ROLE, User.status == "active")
    ).scalar_one()


def _is_last_active_admin(db: Session, user: User) -> bool:
    """True if ``user`` is currently the only active admin."""
    return user.role == ADMIN_ROLE and user.status == "active" and count_active_admins(db) <= 1


# ─── Register / approve ─────────────────────────────────────────────────────────


def register(
    db: Session,
    *,
    email: str,
    password: str,
    g_number: str | None = None,
    display_name: str | None = None,
) -> tuple[User, bool]:
    """Create an account. Returns ``(user, is_first)``.

    First account → active + admin + fills the admin slot. Otherwise pending.
    Raises ``AppError`` on bad email or a taken address.
    """
    normalized = normalize_email(email)
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
        raise AppError("INVALID_EMAIL", "Enter a valid email address.")
    if get_by_email(db, normalized) is not None:
        raise AppError(
            "EMAIL_TAKEN",
            "An account with this email already exists.",
            http_status=409,
        )

    g = (g_number or "").strip().upper() or None
    employee = db.get(Employee, g) if g else None

    is_first = count_users(db) == 0
    user = User(
        email=normalized,
        password_hash=security.hash_password(password),
        employee_id=employee.id if employee is not None else None,
        display_name=display_name or (employee.name_en if employee else None),
        role=ADMIN_ROLE if is_first else OPERATOR_ROLE,
        status="active" if is_first else "pending",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    if is_first and user.employee_id:
        identity_service.promote_to_admin_if_vacant(db, user.employee_id)
        log.info("auth: bootstrapped first account %s as admin", normalized)
    elif is_first:
        log.info("auth: bootstrapped first account %s as admin (no employee link)", normalized)

    return user, is_first


def approve_user(
    db: Session,
    user_id: int,
    *,
    role: str,
    employee_id: str | None,
    actor: str | None = None,
) -> User:
    user = _require_user(db, user_id)
    if _verification_required(user):
        raise AppError(
            "EMAIL_NOT_VERIFIED",
            "This user has not confirmed their email address yet.",
            http_status=409,
        )
    _validate_role(role)
    if employee_id:
        g = employee_id.strip().upper()
        if db.get(Employee, g) is None:
            raise AppError("EMPLOYEE_NOT_FOUND", f"Employee {g} not found", http_status=404)
        user.employee_id = g
    user.role = role
    user.status = "active"
    user.failed_attempts = 0
    user.locked_at = None
    _audit(db, actor, "approve", user)
    db.commit()
    db.refresh(user)
    return user


def link_self(db: Session, user: User, *, employee_id: str | None) -> User:
    """Set the signed-in user's *own* ``employee_id`` (self-service link).

    This is the path the AccountMenu/Email-settings "Link your employee record"
    picker uses. Identity is derived from ``User.employee_id`` (not the email
    account), so this is what actually flips ``identity.linked``.

    Policy (mirrors the UI gating): the initial claim is self-service, but
    *changing* or *clearing* an existing link is admin-only — an operator can't
    hop identities once linked. Raises ``AppError`` on a forbidden change or an
    unknown employee.
    """
    is_admin = user.role == ADMIN_ROLE
    target = (employee_id or "").strip().upper() or None

    if user.employee_id is not None and target != user.employee_id and not is_admin:
        raise AppError(
            "LINK_CHANGE_FORBIDDEN",
            "Only an admin can change an existing employee link.",
            http_status=403,
        )

    if target is not None and db.get(Employee, target) is None:
        raise AppError("EMPLOYEE_NOT_FOUND", f"Employee {target} not found", http_status=404)

    user.employee_id = target
    # Keep the display_name useful when the account had none (e.g. bootstrap
    # admin that registered before the roster existed).
    if target is not None and not user.display_name:
        employee = db.get(Employee, target)
        if employee is not None:
            user.display_name = employee.name_en
    _audit(db, user.display_name or user.email, "link_self", user)
    db.commit()
    db.refresh(user)

    # Fill the legacy admin slot if this admin is the first to claim an employee.
    if target is not None and is_admin:
        identity_service.promote_to_admin_if_vacant(db, target)

    return user


def reject_user(
    db: Session, user_id: int, *, reason: str | None = None, actor: str | None = None
) -> User:
    """Decline a request. Status → ``rejected`` (can't sign in; on file for audit)."""
    user = _require_user(db, user_id)
    user.status = "rejected"
    _audit(db, actor, "reject", user, {"reason": reason})
    db.commit()
    db.refresh(user)
    return user


def set_role(db: Session, user_id: int, role: str, *, actor: str | None = None) -> User:
    user = _require_user(db, user_id)
    _validate_role(role)
    if role != ADMIN_ROLE and _is_last_active_admin(db, user):
        raise AppError(
            "LAST_ADMIN",
            "Cannot demote the last active admin. Promote another admin first.",
            http_status=409,
        )
    user.role = role
    _audit(db, actor, "set_role", user)
    db.commit()
    db.refresh(user)
    return user


def set_status(db: Session, user_id: int, status: str, *, actor: str | None = None) -> User:
    if status not in ("active", "locked", "disabled", "pending", "rejected"):
        raise AppError("INVALID_STATUS", f"Unknown status {status!r}")
    user = _require_user(db, user_id)
    if status != "active" and _is_last_active_admin(db, user):
        raise AppError(
            "LAST_ADMIN",
            "Cannot lock or disable the last active admin. Promote another admin first.",
            http_status=409,
        )
    was_locked = user.status == "locked"
    user.status = status
    if status == "active":
        user.failed_attempts = 0
        user.locked_at = None
    elif status == "locked":
        user.locked_at = _utcnow()
    action = (
        "unlock"
        if (status == "active" and was_locked)
        else ("lock" if status == "locked" else "set_status")
    )
    _audit(db, actor, action, user, {"status": status})
    db.commit()
    db.refresh(user)
    # A status that blocks sign-in must also kill live sessions.
    if status in ("locked", "disabled"):
        revoke_user_sessions(db, user.id)
    return user


def set_default_manager(
    db: Session, user_id: int, *, enabled: bool, actor: str | None = None
) -> User:
    """Set or clear the single-holder default-manager flag (spec 2026-06-11 §5).

    Enabling requires an active account that holds ``books.approve`` and has an
    uploaded signature (the in_app auto-submit assigns this user as signer);
    any previous holder is cleared in the same transaction.
    """
    user = _require_user(db, user_id)
    if enabled:
        if (
            user.status != "active"
            or not user.signature_path
            or not perm_service.has_capability(db, user, "books.approve")
        ):
            raise ValidationFailedError(
                "NOT_ELIGIBLE",
                "Needs an active account, books.approve and an uploaded signature.",
            )
        db.execute(
            update(User).where(User.is_default_manager.is_(True)).values(is_default_manager=False)
        )
        user.is_default_manager = True
    else:
        user.is_default_manager = False
    _audit(db, actor, "default_manager", user, {"enabled": "true" if enabled else "false"})
    db.commit()
    db.refresh(user)
    return user


def _apply_password_reset(db: Session, user: User, new_password: str, *, actor: str | None) -> None:
    user.password_hash = security.hash_password(new_password)
    user.failed_attempts = 0
    user.locked_at = None
    if user.status == "locked":
        user.status = "active"
    _audit(db, actor, "reset_password", user)
    db.commit()
    db.refresh(user)
    # Kill any live sessions so the old password's cookies can't keep a seat.
    revoke_user_sessions(db, user.id)


def reset_password(
    db: Session, user_id: int, new_password: str, *, actor: str | None = None
) -> User:
    user = _require_user(db, user_id)
    _apply_password_reset(db, user, new_password, actor=actor)
    return user


# ─── Authenticate ───────────────────────────────────────────────────────────────


def _maybe_auto_unlock(db: Session, user: User) -> bool:
    """Clear a lock that has aged past ``LOCKOUT_MINUTES``.

    Returns True when the account was auto-unlocked (status reset to ``active``
    and ``failed_attempts`` cleared). The admin manual-unlock path is unaffected;
    this only relaxes the *automatic* 5-strike lock once the window elapses.
    """
    if user.status != "locked":
        return False
    if user.locked_at is None:
        # Locked without a timestamp (e.g. admin-locked) → no auto-clear.
        return False
    if _utcnow() - user.locked_at < timedelta(minutes=LOCKOUT_MINUTES):
        return False
    user.status = "active"
    user.failed_attempts = 0
    user.locked_at = None
    db.commit()
    db.refresh(user)
    return True


def _register_failed_attempt(db: Session, user: User) -> int:
    """Atomically increment ``failed_attempts`` and return the new value.

    Uses a single ``UPDATE ... SET failed_attempts = failed_attempts + 1`` so
    concurrent wrong-password requests can't read-modify-write the same stale
    count. Locks the account on the configured threshold.
    """
    db.execute(
        update(User).where(User.id == user.id).values(failed_attempts=User.failed_attempts + 1)
    )
    db.refresh(user)
    if user.failed_attempts >= MAX_FAILED_ATTEMPTS and user.status == "active":
        user.status = "locked"
        user.locked_at = _utcnow()
    db.commit()
    db.refresh(user)
    return user.failed_attempts


# One identical failure for a missing account, a wrong password, or a
# non-active account that fails the password check — so an attacker who does
# not hold the password can't tell valid emails / account states apart
# (AUTH-03). Account-state messages (pending/locked/...) are only revealed
# *after* a correct password, to a principal who already proved they own it.
_GENERIC_CRED_ERROR = AppError(
    "INVALID_CREDENTIALS", "Incorrect email or password.", http_status=401
)


def authenticate(db: Session, email: str, password: str) -> User:
    """Verify credentials, applying status + lockout rules.

    Returns the active ``User`` on success. On failure raises one identical
    generic ``INVALID_CREDENTIALS`` (no account-existence / state oracle, no
    ``attempts_left``); account-state messages are only surfaced once the
    password is proven correct.
    """
    user = get_by_email(db, email)
    if user is None:
        # Don't reveal whether the email exists.
        raise _GENERIC_CRED_ERROR

    # Auto-clear the 5-strike lock once it has aged out (status side effect only;
    # state is not revealed here — the password is checked first below).
    if user.status == "locked":
        _maybe_auto_unlock(db, user)

    if not security.verify_password(password, user.password_hash):
        # A wrong password against any account (active or not) is the same
        # generic failure. Still count the strike against active accounts so the
        # per-account lockout holds.
        if user.status == "active":
            _register_failed_attempt(db, user)
        raise _GENERIC_CRED_ERROR

    # Password is correct — now it is safe to disclose a non-active state to the
    # principal who proved ownership of the account.
    if _verification_required(user):
        raise AppError(
            "ACCOUNT_EMAIL_UNVERIFIED",
            "Confirm your email address first — check your inbox for the verification link.",
            http_status=403,
        )
    if user.status == "pending":
        raise AppError(
            "ACCOUNT_PENDING",
            "Your account is awaiting admin approval.",
            http_status=403,
        )
    if user.status == "rejected":
        raise AppError(
            "ACCOUNT_REJECTED",
            "Your access request was declined. Contact IT.",
            http_status=403,
        )
    if user.status == "disabled":
        raise AppError("ACCOUNT_DISABLED", "This account is disabled.", http_status=403)
    if user.status == "locked":
        raise AppError("ACCOUNT_LOCKED", "Account locked. Contact IT to unlock.", http_status=403)

    user.failed_attempts = 0
    user.last_login_at = _utcnow()
    db.commit()
    db.refresh(user)
    return user


def verify_password_for(db: Session, user: User, password: str) -> None:
    """Re-auth an already-signed-in user (lock-screen unlock), with lockout.

    Shares the failed-attempt counter + auto-clearing lock with ``authenticate``
    so the lock screen can't be used to brute-force around the login lockout.
    Raises ``AppError`` on a locked account or a wrong password.
    """
    if user.status == "locked" and not _maybe_auto_unlock(db, user):
        raise AppError("ACCOUNT_LOCKED", "Account locked. Contact IT to unlock.", http_status=403)
    if not security.verify_password(password, user.password_hash):
        _register_failed_attempt(db, user)
        if user.status == "locked":
            raise AppError(
                "ACCOUNT_LOCKED",
                "Too many failed attempts. Account locked.",
                http_status=403,
            )
        raise AppError("INVALID_CREDENTIALS", "Incorrect password.", http_status=401)
    if user.failed_attempts:
        user.failed_attempts = 0
        db.commit()
        db.refresh(user)


# ─── Sessions ───────────────────────────────────────────────────────────────────


def start_session(db: Session, user: User, *, user_agent: str | None = None) -> str:
    """Create a session row and return the raw cookie token."""
    raw = security.new_opaque_token()
    db.add(
        AuthSessionModel(
            user_id=user.id,
            token_hash=security.hash_token(raw),
            expires_at=_utcnow() + SESSION_TTL,
            user_agent=(user_agent or "")[:256] or None,
        )
    )
    db.commit()
    return raw


def resolve_session(db: Session, raw_token: str) -> User | None:
    """Return the active user for a cookie token, or ``None``."""
    if not raw_token:
        return None
    row = db.execute(
        select(AuthSessionModel).where(
            AuthSessionModel.token_hash == security.hash_token(raw_token)
        )
    ).scalar_one_or_none()
    if row is None or row.revoked or row.expires_at < _utcnow():
        return None
    user = db.get(User, row.user_id)
    if user is None or user.status != "active" or _verification_required(user):
        return None
    # Throttle the last_seen_at write so we don't commit on every request.
    now = _utcnow()
    if row.last_seen_at is None or (now - row.last_seen_at) >= SESSION_TOUCH_INTERVAL:
        row.last_seen_at = now
        db.commit()
    return user


def revoke_user_sessions(db: Session, user_id: int) -> int:
    """Mark every one of a user's sessions revoked. Returns the count.

    Used when a password is reset or the account is locked/disabled so any
    live cookie dies immediately. Caller need not commit — this commits.
    """
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(AuthSessionModel)
            .where(AuthSessionModel.user_id == user_id, AuthSessionModel.revoked.is_(False))
            .values(revoked=True)
        ),
    )
    db.commit()
    return int(result.rowcount or 0)


def revoke_session(db: Session, raw_token: str) -> None:
    if not raw_token:
        return
    row = db.execute(
        select(AuthSessionModel).where(
            AuthSessionModel.token_hash == security.hash_token(raw_token)
        )
    ).scalar_one_or_none()
    if row is not None and not row.revoked:
        row.revoked = True
        db.commit()


# ─── Email verification / password reset ───────────────────────────────────────


def verify_email(db: Session, raw_token: str) -> User:
    """Consume a verify-purpose link token and mark the owning user confirmed.

    Idempotent: a user already verified by an earlier link still gets a 200 —
    the token claim (and its ``used_at`` write) is committed either way.
    """
    row = account_token_service.claim(db, raw_token, account_token_service.PURPOSE_VERIFY)
    if row is None:
        raise AppError(
            "EMAIL_LINK_INVALID",
            "This link is invalid or has expired. Request a new one.",
            http_status=400,
        )
    user = db.get(User, row.user_id)
    if user is None:
        raise AppError(
            "EMAIL_LINK_INVALID",
            "This link is invalid or has expired. Request a new one.",
            http_status=400,
        )
    if user.email_verified_at is None:
        user.email_verified_at = _utcnow()
        _audit(db, "self-service", "email_verified", user)
    db.commit()
    db.refresh(user)
    return user


def complete_password_reset(db: Session, raw_token: str, new_password: str) -> User:
    """Consume a reset-purpose link token and set the owning user's password.

    Never creates a session — the caller (route layer) drops any existing
    cookie instead, since ``_apply_password_reset`` already revokes every
    live session for the account.
    """
    row = account_token_service.claim(db, raw_token, account_token_service.PURPOSE_RESET)
    invalid = AppError(
        "PASSWORD_RESET_LINK_INVALID",
        "This reset link is invalid, expired or already used.",
        http_status=400,
    )
    if row is None:
        db.rollback()
        raise invalid
    user = db.get(User, row.user_id)
    if user is None or user.status not in ("active", "locked") or user.email_verified_at is None:
        db.rollback()
        raise invalid
    # Defensive: also close out any other open reset tokens for this user.
    account_token_service.invalidate_open(
        db, user.id, account_token_service.PURPOSE_RESET, now=_utcnow()
    )
    _apply_password_reset(db, user, new_password, actor="self-service")
    return user


def request_email_link(email: str, purpose: str, locale: str) -> None:
    """Background-task entry: issue + mail a one-time link. Opens its own session.

    Silent on every ineligible input (unknown address, already-verified user
    requesting ``verify``, unverified/rejected/pending user requesting
    ``reset``) — the route layer always returns 202 so this never becomes an
    email-enumeration oracle. A mailer failure invalidates the just-issued
    token (so a retry mints a fresh one) and logs a sanitized warning — never
    the recipient, token, or URL.
    """
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        user = get_by_email(db, email)
        if user is None:
            return
        if purpose == account_token_service.PURPOSE_VERIFY:
            eligible = user.email_verified_at is None
        else:
            eligible = user.status in ("active", "locked") and user.email_verified_at is not None
        if not eligible:
            return
        raw = account_token_service.issue(db, user, purpose)
        try:
            if purpose == account_token_service.PURPOSE_VERIFY:
                account_mailer.send_verification_email(
                    recipient=user.email, raw_token=raw, locale=locale
                )
            else:
                account_mailer.send_password_reset_email(
                    recipient=user.email, raw_token=raw, locale=locale
                )
        except Exception as exc:  # mailer failure must not raise into the background-task queue
            account_token_service.invalidate_open(db, user.id, purpose, now=_utcnow())
            db.commit()
            log.warning(
                "account mail: %s link not delivered (user_id=%s): %s",
                purpose,
                user.id,
                exc.__class__.__name__,
            )


# ─── Projection ─────────────────────────────────────────────────────────────────


def to_session_user(db: Session, user: User) -> SessionUser:
    employee = db.get(Employee, user.employee_id) if user.employee_id else None
    return SessionUser(
        id=user.id,
        email=user.email,
        employee_id=user.employee_id,
        name_en=employee.name_en if employee else user.display_name,
        name_ar=employee.name_ar if employee else None,
        position=employee.position if employee else None,
        department=employee.department if employee else None,
        photo_url=(identity_service.photo_url_for(db, employee.id) if employee else None),
        role=user.role,
        status=user.status,
        is_admin=user.role == ADMIN_ROLE,
        is_manager=user.role in (ADMIN_ROLE, MANAGER_ROLE),
        has_signature=bool(user.signature_path),
        idle_lock_seconds=user.idle_lock_seconds,
        lock_layout=user.lock_layout,
    )


def set_lock_timer(db: Session, user: User, seconds: int) -> User:
    """Persist the signed-in user's lock-screen idle timeout."""

    user.idle_lock_seconds = seconds
    db.commit()
    db.refresh(user)
    return user


def set_lock_layout(db: Session, user: User, layout: str) -> User:
    """Persist the signed-in user's lock-screen layout choice."""

    user.lock_layout = layout
    db.commit()
    db.refresh(user)
    return user


def admin_read(db: Session, user: User) -> AdminUserRead:
    employee = db.get(Employee, user.employee_id) if user.employee_id else None
    return AdminUserRead(
        id=user.id,
        email=user.email,
        employee_id=user.employee_id,
        display_name=user.display_name,
        name_en=employee.name_en if employee else None,
        role=user.role,
        status=user.status,
        failed_attempts=user.failed_attempts,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        is_default_manager=user.is_default_manager,
        email_verified_at=user.email_verified_at,
    )


def list_users(db: Session) -> list[AdminUserRead]:
    users = db.execute(select(User).order_by(User.created_at.asc())).scalars().all()
    return [admin_read(db, u) for u in users]


# ─── Audit ──────────────────────────────────────────────────────────────────────


def _audit(
    db: Session,
    actor: str | None,
    action: str,
    user: User,
    extra: dict[str, str | None] | None = None,
) -> None:
    """Stage an ``audit_log`` row for a user-management action (caller commits).

    Snapshots the target's identity into ``payload`` so the History tab can
    render without re-joining (and survives the target being relinked later).
    """
    payload: dict[str, str | None] = {
        "email": user.email,
        "g_number": user.employee_id,
        "name": user.display_name,
        "role": user.role,
    }
    if extra:
        payload.update({k: v for k, v in extra.items() if v is not None})
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            entity_type="user",
            entity_id=str(user.id),
            payload=json.dumps(payload, ensure_ascii=False),
        )
    )


def audit_permission_change(
    db: Session,
    *,
    actor: str | None,
    user: User,
    capability: str,
    effect: str | None,
) -> None:
    """Record a per-user capability override change in the audit log."""
    _audit(
        db,
        actor,
        "set_permission",
        user,
        {"capability": capability, "effect": effect or "default"},
    )
    db.commit()


def list_audit(db: Session, *, limit: int = 50) -> list[AuditEntryRead]:
    rows = (
        db.execute(
            select(AuditLog)
            .where(AuditLog.entity_type == "user")
            .order_by(AuditLog.ts.desc(), AuditLog.id.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    out: list[AuditEntryRead] = []
    for r in rows:
        data: dict[str, str | None] = json.loads(r.payload) if r.payload else {}
        out.append(
            AuditEntryRead(
                id=r.id,
                action=r.action,
                actor=r.actor,
                target_email=data.get("email"),
                target_g=data.get("g_number"),
                target_name=data.get("name"),
                role=data.get("role"),
                reason=data.get("reason"),
                ts=r.ts,
            )
        )
    return out


# ─── Helpers ────────────────────────────────────────────────────────────────────


def require_user(db: Session, user_id: int) -> User:
    """Fetch a user by id or raise 404 (public helper for the API layer)."""
    user = db.get(User, user_id)
    if user is None:
        raise AppError("USER_NOT_FOUND", f"User {user_id} not found", http_status=404)
    return user


# Internal alias kept for existing call sites in this module.
_require_user = require_user


def _validate_role(role: str) -> None:
    if role not in _VALID_ROLES:
        raise AppError("INVALID_ROLE", f"Unknown role {role!r}")


__all__ = [
    "MAX_FAILED_ATTEMPTS",
    "admin_read",
    "approve_user",
    "audit_permission_change",
    "authenticate",
    "complete_password_reset",
    "count_active_admins",
    "count_users",
    "get_by_email",
    "link_self",
    "list_audit",
    "list_users",
    "normalize_email",
    "register",
    "reject_user",
    "request_email_link",
    "require_user",
    "reset_password",
    "resolve_session",
    "revoke_session",
    "revoke_user_sessions",
    "set_role",
    "set_status",
    "start_session",
    "to_session_user",
    "verify_email",
    "verify_password_for",
]
