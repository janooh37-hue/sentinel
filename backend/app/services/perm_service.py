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

from sqlalchemy import literal, select, union_all
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.core.permissions import (
    ALL_CAPABILITIES,
    CAPABILITY_IDS,
    CATEGORY_CAP_PREFIX,
    ROLE_DEFAULTS,
    SERVICE_CAP_PREFIX,
    SERVICE_CAPABILITY_IDS,
    SERVICE_RECORDS_CAP_PREFIX,
    SERVICE_RECORDS_CAPABILITY_IDS,
    default_caps_for_role,
)
from app.core.roles import ADMIN_ROLE
from app.db.models import BookCategory, RolePermission, User, UserPermission

# Capabilities that must never be reachable via a per-user override: they are
# the keys to user management / admin tooling and are admin-only by role. A
# grant here would let an admin (or a future buggy gate) hand out self-escalation
# paths; a deny would silently break an admin (admins short-circuit to "all",
# but this keeps the matrix honest). Admin-grade access comes from the role.
_SENSITIVE_CAPS: frozenset[str] = frozenset({"users.manage", "system.admin"})


def _role_and_dynamic_caps(db: Session, role: str) -> tuple[set[str], set[str]]:
    """Load role defaults and category defaults together in one query."""
    tagged_caps = union_all(
        select(
            RolePermission.capability.label("capability"),
            literal(False).label("is_dynamic"),
        ).where(RolePermission.role == role),
        select(
            literal(CATEGORY_CAP_PREFIX).concat(BookCategory.id).label("capability"),
            literal(True).label("is_dynamic"),
        ),
    )
    role_caps: set[str] = set()
    dynamic_caps = set(SERVICE_CAPABILITY_IDS) | set(SERVICE_RECORDS_CAPABILITY_IDS)
    for capability, is_dynamic in db.execute(tagged_caps):
        if is_dynamic:
            dynamic_caps.add(capability)
        else:
            role_caps.add(capability)
    if not role_caps:
        role_caps = set(default_caps_for_role(role))
    return role_caps, dynamic_caps


def role_default_caps_with_dynamic(db: Session, role: str) -> set[str]:
    """Role defaults plus implicit service/category capabilities."""
    role_caps, dynamic_caps = _role_and_dynamic_caps(db, role)
    return role_caps | dynamic_caps


def category_capability_ids(db: Session) -> set[str]:
    """Dynamic deny-only capability ids for the current category catalog."""
    return {
        f"{CATEGORY_CAP_PREFIX}{category_id}"
        for category_id in db.scalars(select(BookCategory.id)).all()
    }


def dynamic_capability_ids(db: Session) -> set[str]:
    """Implicitly granted service and category capabilities."""
    return (
        set(SERVICE_CAPABILITY_IDS)
        | set(SERVICE_RECORDS_CAPABILITY_IDS)
        | category_capability_ids(db)
    )


def dynamic_capability_label(db: Session, capability_id: str) -> str:
    """Human label for a dynamic capability, or the id for non-dynamic input."""
    if capability_id.startswith(CATEGORY_CAP_PREFIX):
        category_id = capability_id.removeprefix(CATEGORY_CAP_PREFIX)
        category = db.get(BookCategory, category_id)
        if category is None:
            return category_id
        return category.name_en or category_id
    if capability_id.startswith(SERVICE_RECORDS_CAP_PREFIX):
        service_id = capability_id.removeprefix(SERVICE_RECORDS_CAP_PREFIX)
        service_label = dynamic_capability_label(
            db,
            f"{SERVICE_CAP_PREFIX}{service_id}",
        )
        return f"Records: {service_label}"
    if capability_id.startswith(SERVICE_CAP_PREFIX):
        return capability_id.removeprefix(SERVICE_CAP_PREFIX)
    return capability_id


def effective_caps(db: Session, user: User) -> set[str]:
    """Resolve the user's effective capabilities.

    Admins always get the full set (lockout protection). Everyone else gets
    ``role_defaults plus grants minus denies``.

    Memoized on the ``User`` instance (request-scoped — one instance per request
    via ``get_current_user``) so the repeated ``has_capability`` checks a single
    request makes don't re-run the two permission queries each time.
    """
    cached: frozenset[str] | None = getattr(user, "_effective_caps_cache", None)
    if cached is not None:
        return set(cached)

    role_caps, dynamic_caps = _role_and_dynamic_caps(db, user.role)
    if user.role == ADMIN_ROLE:
        caps = set(ALL_CAPABILITIES) | dynamic_caps
    else:
        caps = role_caps | dynamic_caps
        overrides = (
            db.execute(select(UserPermission).where(UserPermission.user_id == user.id))
            .scalars()
            .all()
        )
        now = datetime.now(UTC).replace(tzinfo=None)
        for ov in overrides:
            if ov.effect == "grant":
                if ov.expires_at is not None and ov.expires_at <= now:
                    if ov.capability in dynamic_caps:
                        caps.discard(ov.capability)
                    continue
                caps.add(ov.capability)
            elif ov.effect == "deny":
                caps.discard(ov.capability)

    user._effective_caps_cache = frozenset(caps)
    return caps


def has_capability(db: Session, user: User, capability: str) -> bool:
    if user.role == ADMIN_ROLE:
        return True
    return capability in effective_caps(db, user)


def _invalidate_caps_cache(db: Session, user_id: int) -> None:
    """Drop the memoized caps for a user after their permissions change.

    Uses the session identity map: ``db.get`` returns the *same* User instance
    the caller may still hold (no query on a hit), so a re-check in the same
    request/session sees the change instead of a stale cached set."""
    target = db.get(User, user_id)
    if target is not None:
        target._effective_caps_cache = None


# ─── Override management (admin matrix) ───────────────────────────────────────


def get_user_overrides(db: Session, user_id: int) -> dict[str, str]:
    """Return ``{capability: effect}`` for the user's stored overrides."""
    rows = (
        db.execute(select(UserPermission).where(UserPermission.user_id == user_id)).scalars().all()
    )
    return {r.capability: r.effect for r in rows}


def _validate_temporary_dynamic_grant(
    capability: str,
    effect: str | None,
    expires_at: datetime | None,
    dynamic_caps: set[str],
    existing: UserPermission | None,
) -> None:
    unswept_expired_grant = (
        existing is not None
        and existing.effect == "grant"
        and existing.expires_at is not None
        and existing.expires_at <= datetime.now(UTC).replace(tzinfo=None)
    )
    restores_prior_deny = (
        existing is not None and existing.effect == "deny"
    ) or unswept_expired_grant
    if (
        effect == "grant"
        and expires_at is not None
        and capability in dynamic_caps
        and not restores_prior_deny
    ):
        raise AppError(
            "TEMPORARY_GRANT_REQUIRES_DENY",
            "A temporary dynamic grant must replace an existing deny override.",
            http_status=400,
        )


def _validate_override_item(
    db: Session,
    capability: str,
    effect: str | None,
    *,
    dynamic_caps: set[str] | None = None,
) -> set[str]:
    dynamic_caps = dynamic_capability_ids(db) if dynamic_caps is None else dynamic_caps
    if capability not in CAPABILITY_IDS and capability not in dynamic_caps:
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
    return dynamic_caps


def set_user_override(
    db: Session,
    user_id: int,
    capability: str,
    effect: str | None,
    *,
    actor: User | None = None,
    expires_at: datetime | None = None,
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
    dynamic_caps = _validate_override_item(db, capability, effect)
    if actor is not None and actor.id == user_id:
        raise AppError(
            "FORBIDDEN_OVERRIDE",
            "You cannot change your own permissions.",
            http_status=400,
        )
    existing = db.get(UserPermission, (user_id, capability))
    _validate_temporary_dynamic_grant(
        capability,
        effect,
        expires_at,
        dynamic_caps,
        existing,
    )

    if effect is None:
        if existing is not None:
            db.delete(existing)
    elif existing is None:
        db.add(
            UserPermission(
                user_id=user_id, capability=capability, effect=effect, expires_at=expires_at
            )
        )
    else:
        existing.effect = effect
        existing.expires_at = expires_at
    db.commit()
    _invalidate_caps_cache(db, user_id)


def set_user_overrides(
    db: Session,
    user_id: int,
    items: list[tuple[str, str | None, datetime | None]],
    *,
    actor: User | None = None,
) -> None:
    """Apply a batch of override changes all-or-nothing (one commit).

    Validates every item BEFORE touching the session so a bad capability or a
    sensitive grant refuses the whole batch. Reuses set_user_override's rules;
    the per-item commit is skipped by writing rows directly.
    """
    if actor is not None and actor.id == user_id:
        raise AppError(
            "FORBIDDEN_OVERRIDE", "You cannot change your own permissions.", http_status=400
        )
    # Collapse duplicate capabilities keeping the LAST occurrence. Production
    # sessions run autoflush=False, so two items for one capability would both
    # reach db.add() before any flush assigns the first a PK → IntegrityError
    # at commit (500) or silently partial application. dict keeps insertion
    # order, so non-duplicate batches are unchanged.
    collapsed: dict[str, tuple[str | None, datetime | None]] = {}
    for capability, effect, expires_at in items:
        collapsed[capability] = (effect, expires_at)
    items = [(cap, eff, exp) for cap, (eff, exp) in collapsed.items()]
    dynamic_caps = dynamic_capability_ids(db)
    existing_by_capability: dict[str, UserPermission | None] = {}
    for capability, effect, expires_at in items:
        _validate_override_item(
            db,
            capability,
            effect,
            dynamic_caps=dynamic_caps,
        )
        existing = db.get(UserPermission, (user_id, capability))
        _validate_temporary_dynamic_grant(
            capability,
            effect,
            expires_at,
            dynamic_caps,
            existing,
        )
        existing_by_capability[capability] = existing
    for capability, effect, expires_at in items:
        existing = existing_by_capability[capability]
        if effect is None:
            if existing is not None:
                db.delete(existing)
        elif existing is None:
            db.add(
                UserPermission(
                    user_id=user_id, capability=capability, effect=effect, expires_at=expires_at
                )
            )
        else:
            existing.effect = effect
            existing.expires_at = expires_at
    db.commit()
    _invalidate_caps_cache(db, user_id)


def denied_record_types(db: Session, user: User) -> tuple[set[str], set[str]]:
    """Return bare service/category ids explicitly hidden from ``user``."""
    denied = dynamic_capability_ids(db) - effective_caps(db, user)
    denied_services = {
        capability.removeprefix(SERVICE_RECORDS_CAP_PREFIX)
        for capability in denied
        if capability.startswith(SERVICE_RECORDS_CAP_PREFIX)
    }
    denied_categories = {
        capability.removeprefix(CATEGORY_CAP_PREFIX)
        for capability in denied
        if capability.startswith(CATEGORY_CAP_PREFIX)
    }
    return denied_services, denied_categories


# ─── Expiry sweep ─────────────────────────────────────────────────────────────


def sweep_expired_grants(db: Session) -> int:
    """Clean expired grants, restoring dynamic caps to their prior deny."""
    now = datetime.now(UTC).replace(tzinfo=None)
    expired = list(
        db.scalars(
            select(UserPermission).where(
                UserPermission.effect == "grant",
                UserPermission.expires_at.is_not(None),
                UserPermission.expires_at <= now,
            )
        ).all()
    )
    dynamic_caps = dynamic_capability_ids(db)
    affected_user_ids: set[int] = set()
    for row in expired:
        affected_user_ids.add(row.user_id)
        if row.capability in dynamic_caps:
            row.effect = "deny"
            row.expires_at = None
        else:
            db.delete(row)
    db.commit()
    for user_id in affected_user_ids:
        _invalidate_caps_cache(db, user_id)
    return len(expired)


# ─── Seeding (used by migration 0018 + idempotent boot safety) ────────────────


def seed_role_defaults(db: Session) -> None:
    """Idempotently populate ``role_permissions`` from the in-code presets.

    Only adds missing (role, capability) rows; never deletes, so an operator's
    later edits to presets survive a re-run.
    """
    existing = {(r.role, r.capability) for r in db.execute(select(RolePermission)).scalars().all()}
    for role, caps in ROLE_DEFAULTS.items():
        for cap in caps:
            if (role, cap) not in existing:
                db.add(RolePermission(role=role, capability=cap))
    db.commit()


__all__ = [
    "category_capability_ids",
    "denied_record_types",
    "dynamic_capability_ids",
    "dynamic_capability_label",
    "effective_caps",
    "get_user_overrides",
    "has_capability",
    "role_default_caps_with_dynamic",
    "seed_role_defaults",
    "set_user_override",
    "set_user_overrides",
    "sweep_expired_grants",
]
