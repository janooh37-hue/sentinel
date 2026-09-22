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
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import AppError, ValidationFailedError
from app.config import get_settings
from app.core import security
from app.core.roles import ADMIN_ROLE, MANAGER_ROLE, OPERATOR_ROLE
from app.db.models import AuditLog, Employee, User
from app.db.models import AuthSession as AuthSessionModel
from app.schemas.auth import AdminUserRead, AuditEntryRead, SessionUser
from app.services import identity_service, perm_service, user_signature_service

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


def _normalize_email(email: str) -> str:
    return email.strip().lower()


# ─── Lookups ──────────────────────────────────────────────────────────────────


def get_by_email(db: Session, email: str) -> User | None:
    return db.execute(
        select(User).where(User.email == _normalize_email(email))
    ).scalar_one_or_none()


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
    normalized = _validate_new_email(db, email)

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


def _validate_new_email(db: Session, email: str) -> str:
    """Normalize and validate a new account's email.

    Raises ``AppError`` on a malformed address or one already on file.
    Shared by ``register`` (self-service) and ``create_user`` (admin-issued).
    """
    normalized = _normalize_email(email)
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
        raise AppError("INVALID_EMAIL", "Enter a valid email address.")
    if get_by_email(db, normalized) is not None:
        raise AppError(
            "EMAIL_TAKEN",
            "An account with this email already exists.",
            http_status=409,
        )
    return normalized


def create_user(
    db: Session,
    *,
    email: str,
    employee_id: str | None,
    role: str,
    display_name: str | None = None,
    actor: str | None = None,
) -> tuple[User, str]:
    """Admin-issued account. Active immediately, with a generated temporary
    password the owner must replace before signing in (``start_session``
    enforces this). Returns ``(user, temporary_password)`` — the plaintext is
    not retained anywhere; only this one response ever carries it.

    Raises ``AppError`` on bad/taken email, an unknown ``employee_id``, or an
    invalid role.
    """
    _validate_role(role)
    normalized = _validate_new_email(db, email)

    g = (employee_id or "").strip().upper() or None
    employee = db.get(Employee, g) if g else None
    if g is not None and employee is None:
        raise AppError("EMPLOYEE_NOT_FOUND", f"Employee {g} not found", http_status=404)

    temporary_password = secrets.token_urlsafe(12)
    user = User(
        email=normalized,
        password_hash=security.hash_password(temporary_password),
        password_change_required=True,
        employee_id=g,
        display_name=(display_name or "").strip() or (employee.name_en if employee else None),
        role=role,
        status="active",
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        if get_by_email(db, normalized) is not None:
            raise AppError(
                "EMAIL_TAKEN",
                "An account with this email already exists.",
                http_status=409,
            ) from None
        raise
    _audit(db, actor, "create_user", user)
    db.commit()
    db.refresh(user)
    return user, temporary_password


def approve_user(
    db: Session,
    user_id: int,
    *,
    role: str,
    employee_id: str | None,
    actor: str | None = None,
) -> User:
    """Approve a pending request, setting role and the admin-confirmed link.

    ``employee_id`` is always applied — ``None`` explicitly clears whatever
    the requester self-claimed at register time; a value must resolve to an
    existing employee. Only a currently ``pending`` account can be approved;
    the transition is a conditional UPDATE so a concurrent approve/reject
    can't silently clobber one another.
    """
    user = _require_user(db, user_id)
    _validate_role(role)
    if user.status != "pending":
        raise AppError(
            "INVALID_ACCOUNT_STATE",
            "This account is not in a state that allows this action.",
            http_status=409,
        )
    g = (employee_id or "").strip().upper() or None
    if g is not None and db.get(Employee, g) is None:
        raise AppError("EMPLOYEE_NOT_FOUND", f"Employee {g} not found", http_status=404)
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(User)
            .where(User.id == user_id, User.status == "pending")
            .values(employee_id=g, role=role, status="active", failed_attempts=0, locked_at=None)
        ),
    )
    if not result.rowcount:
        db.rollback()
        raise AppError(
            "INVALID_ACCOUNT_STATE",
            "This account is not in a state that allows this action.",
            http_status=409,
        )
    db.refresh(user)
    g: str | None = None
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
    if g is not None:
        db.flush()
        user_signature_service.consolidate_or_raise(db, g, data_dir=get_settings().data_dir)
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
    if target is not None:
        db.flush()
        user_signature_service.consolidate_or_raise(db, target, data_dir=get_settings().data_dir)
    db.commit()
    db.refresh(user)

    # Fill the legacy admin slot if this admin is the first to claim an employee.
    if target is not None and is_admin:
        identity_service.promote_to_admin_if_vacant(db, target)

    return user


def reject_user(
    db: Session, user_id: int, *, reason: str | None = None, actor: str | None = None
) -> User:
    """Decline a pending request. Status → ``rejected`` (can't sign in; on
    file for audit). Only a currently ``pending`` account can be rejected."""
    user = _require_user(db, user_id)
    if user.status != "pending":
        raise AppError(
            "INVALID_ACCOUNT_STATE",
            "This account is not in a state that allows this action.",
            http_status=409,
        )
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(User)
            .where(User.id == user_id, User.status == "pending")
            .values(status="rejected")
        ),
    )
    if not result.rowcount:
        db.rollback()
        raise AppError(
            "INVALID_ACCOUNT_STATE",
            "This account is not in a state that allows this action.",
            http_status=409,
        )
    db.refresh(user)
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
    """Admin-driven ``disable``/restore (``active``) transition.

    Automatic bad-password lockout (``locked``) is a separate path in
    ``_register_failed_attempt`` — not reachable through this function.
    Disable accepts an active or locked account (idempotent if already
    disabled); restore accepts a locked or disabled account (idempotent if
    already active). A pending/rejected target is rejected with 409, since
    neither transition is meaningful before/after the approval lifecycle.
    """
    if status not in ("active", "disabled"):
        raise AppError("INVALID_STATUS", f"Unknown status {status!r}")
    user = _require_user(db, user_id)
    invalid_state = AppError(
        "INVALID_ACCOUNT_STATE",
        "This account is not in a state that allows this action.",
        http_status=409,
    )

    if status == "disabled":
        if user.status not in ("active", "locked", "disabled"):
            raise invalid_state
        if user.status == "disabled":
            return user
        if _is_last_active_admin(db, user):
            raise AppError(
                "LAST_ADMIN",
                "Cannot disable the last active admin. Promote another admin first.",
                http_status=409,
            )
        user.status = "disabled"
        user.locked_at = None
        _audit(db, actor, "disable", user)
        # Same commit as the session revocation below (it commits staged work).
        revoke_user_sessions(db, user.id)
        db.refresh(user)
        return user

    # status == "active": restore from a timed lock or a disable.
    if user.status not in ("locked", "disabled", "active"):
        raise invalid_state
    if user.status == "active":
        return user
    action = "reactivate" if user.status == "disabled" else "unlock"
    user.status = "active"
    user.failed_attempts = 0
    user.locked_at = None
    _audit(db, actor, action, user)
    db.commit()
    db.refresh(user)
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
            or user_signature_service.resolve_signature(user) is None
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


def reset_password(
    db: Session, user_id: int, new_password: str, *, actor: str | None = None
) -> User:
    user = _require_user(db, user_id)
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

    # last_login_at is set in start_session, not here — a temporary-password
    # verification (blocked before a session exists) must not count as a
    # completed login.
    user.failed_attempts = 0
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
    """Create a session row and return the raw cookie token.

    Raises ``AppError`` if the account still requires a password-setup step
    (an admin-issued temporary password not yet replaced) — a service
    invariant enforced here, not merely a frontend condition.
    """
    if user.password_change_required:
        raise AppError(
            "PASSWORD_CHANGE_REQUIRED",
            "Choose a new password before signing in.",
            http_status=403,
        )
    raw = security.new_session_token()
    db.add(
        AuthSessionModel(
            user_id=user.id,
            token_hash=security.hash_token(raw),
            expires_at=_utcnow() + SESSION_TTL,
            user_agent=(user_agent or "")[:256] or None,
        )
    )
    user.last_login_at = _utcnow()
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
    if user is None or user.status != "active" or user.password_change_required:
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


# ─── Password setup ──────────────────────────────────────────────────────────


def complete_password_setup(
    db: Session, *, email: str, temporary_password: str, new_password: str
) -> None:
    """Replace an admin-issued temporary password before first sign-in.

    Delegates credential/lockout/account-state checks to ``authenticate`` so
    that stays the single source of truth for who is allowed in. No session
    is created here — the frontend performs a normal login afterward.
    """
    user = authenticate(db, email, temporary_password)
    if not user.password_change_required:
        raise AppError(
            "PASSWORD_SETUP_NOT_REQUIRED",
            "Password setup is not required. Sign in normally.",
            http_status=409,
        )
    if security.verify_password(new_password, user.password_hash):
        raise ValidationFailedError(
            "PASSWORD_UNCHANGED",
            "Choose a different password from the temporary password.",
        )
    old_hash = user.password_hash
    new_hash = security.hash_password(new_password)
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(User)
            .where(
                User.id == user.id,
                User.password_hash == old_hash,
                User.status == "active",
                User.password_change_required.is_(True),
            )
            .values(
                password_hash=new_hash,
                password_change_required=False,
                failed_attempts=0,
                locked_at=None,
            )
        ),
    )
    if not result.rowcount:
        db.rollback()
        raise AppError(
            "PASSWORD_SETUP_CHANGED",
            "Account access changed. Sign in again or contact your administrator.",
            http_status=409,
        )
    db.refresh(user)
    _audit(db, user.display_name or user.email, "password_setup", user)
    revoke_user_sessions(db, user.id)


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
        has_signature=user_signature_service.resolve_signature(user) is not None,
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
        password_change_required=user.password_change_required,
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
    "complete_password_setup",
    "count_active_admins",
    "count_users",
    "create_user",
    "get_by_email",
    "link_self",
    "list_audit",
    "list_users",
    "register",
    "reject_user",
    "require_user",
    "reset_password",
    "resolve_session",
    "revoke_session",
    "revoke_user_sessions",
    "set_role",
    "set_status",
    "start_session",
    "to_session_user",
    "verify_password_for",
]
