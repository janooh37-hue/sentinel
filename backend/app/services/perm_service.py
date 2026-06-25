"""Permission resolution + seeding + per-user override management.

``effective_caps(user)`` is the one function the ``require_capability`` gate
calls. Resolution: role defaults plus user grants minus user denies, with the
admin role short-circuiting to "all" so an admin can never lock themselves out.

The role-default map lives in the ``role_permissions`` table (seeded from
``core.permissions.ROLE_DEFAULTS`` by migration 0018). We read it from the DB
so an operator can later edit presets without a code change; if a role has no
rows yet (fresh ``metadata.create_all`` in tests) we fall back to the in-code
defaults so the gate works without a seed step.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.core.permissions import (
    ALL_CAPABILITIES,
    CAPABILITY_IDS,
    ROLE_DEFAULTS,
    default_caps_for_role,
)
from app.core.roles import ADMIN_ROLE
from app.db.models import RolePermission, User, UserPermission

# Capabilities that must never be reachable via a per-user override: they are
# the keys to user management / admin tooling and are admin-only by role. A
# grant here would let an admin (or a future buggy gate) hand out self-escalation
# paths; a deny would silently break an admin (admins short-circuit to "all",
# but this keeps the matrix honest). Admin-grade access comes from the role.
_SENSITIVE_CAPS: frozenset[str] = frozenset({"users.manage", "system.admin"})


def role_default_caps(db: Session, role: str) -> set[str]:
    """Default capabilities for a role, read from ``role_permissions``.

    Falls back to the in-code preset when the table has no rows for the role
    (e.g. a test DB built via ``metadata.create_all`` with no seed).
    """
    rows = (
        db.execute(select(RolePermission.capability).where(RolePermission.role == role))
        .scalars()
        .all()
    )
    if rows:
        return set(rows)
    return set(default_caps_for_role(role))


def effective_caps(db: Session, user: User) -> set[str]:
    """Resolve the user's effective capabilities.

    Admins always get the full set (lockout protection). Everyone else gets
    ``role_defaults plus grants minus denies``.
    """
    if user.role == ADMIN_ROLE:
        return set(ALL_CAPABILITIES)

    caps = role_default_caps(db, user.role)
    overrides = (
        db.execute(
            select(UserPermission).where(UserPermission.user_id == user.id)
        )
        .scalars()
        .all()
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    for ov in overrides:
        if ov.effect == "grant":
            if ov.expires_at is not None and ov.expires_at <= now:
                continue  # expired temporary grant
            caps.add(ov.capability)
        elif ov.effect == "deny":
            caps.discard(ov.capability)
    return caps


def has_capability(db: Session, user: User, capability: str) -> bool:
    return capability in effective_caps(db, user)


# ─── Override management (admin matrix) ───────────────────────────────────────


def get_user_overrides(db: Session, user_id: int) -> dict[str, str]:
    """Return ``{capability: effect}`` for the user's stored overrides."""
    rows = (
        db.execute(
            select(UserPermission).where(UserPermission.user_id == user_id)
        )
        .scalars()
        .all()
    )
    return {r.capability: r.effect for r in rows}


def set_user_override(
    db: Session,
    user_id: int,
    capability: str,
    effect: str | None,
    *,
    actor: User | None = None,
) -> None:
    """Set or clear a single per-user override.

    ``effect`` is ``grant`` / ``deny`` to set, or ``None`` to clear (revert to
    the role default). Validates the capability id and effect.

    Defensive guards (defence-in-depth on top of the admin-only route):
    * Sensitive caps (``users.manage`` / ``system.admin``) can never be
      *granted* via an override — admin-grade access comes from the role, not a
      grant, so a grant here can't be used to mint a self-escalation path. A
      ``deny`` is still allowed (it's a no-op on admins, who short-circuit to
      all, and harmless on non-admins who lack the cap by default).
    * An admin can't target their own row, so they can't deny themselves out of
      a capability they're managing.
    """
    if capability not in CAPABILITY_IDS:
        raise AppError("UNKNOWN_CAPABILITY", f"Unknown capability {capability!r}")
    if effect not in ("grant", "deny", None):
        raise AppError("INVALID_EFFECT", f"Effect must be grant/deny/null, got {effect!r}")
    if effect == "grant" and capability in _SENSITIVE_CAPS:
        raise AppError(
            "FORBIDDEN_OVERRIDE",
            f"{capability!r} cannot be granted via a per-user override; "
            "it is granted by the admin role only.",
            http_status=400,
        )
    if actor is not None and actor.id == user_id:
        raise AppError(
            "FORBIDDEN_OVERRIDE",
            "You cannot change your own permissions.",
            http_status=400,
        )

    existing = db.get(UserPermission, (user_id, capability))
    if effect is None:
        if existing is not None:
            db.delete(existing)
    elif existing is None:
        db.add(UserPermission(user_id=user_id, capability=capability, effect=effect))
    else:
        existing.effect = effect
    db.commit()


# ─── Seeding (used by migration 0018 + idempotent boot safety) ────────────────


def seed_role_defaults(db: Session) -> None:
    """Idempotently populate ``role_permissions`` from the in-code presets.

    Only adds missing (role, capability) rows; never deletes, so an operator's
    later edits to presets survive a re-run.
    """
    existing = {
        (r.role, r.capability)
        for r in db.execute(select(RolePermission)).scalars().all()
    }
    for role, caps in ROLE_DEFAULTS.items():
        for cap in caps:
            if (role, cap) not in existing:
                db.add(RolePermission(role=role, capability=cap))
    db.commit()


__all__ = [
    "effective_caps",
    "get_user_overrides",
    "has_capability",
    "role_default_caps",
    "seed_role_defaults",
    "set_user_override",
]
