"""Canonical workforce scope resolution and request-time narrowing.

Workforce capabilities answer *what* a principal may do.  This module answers
*which employees* they may act on.  The resolved scope is immutable so callers
can safely pass it through service layers without accidentally widening it.

``department`` is an optional dimension: this roster is placed by duty unit, and
only part of it carries a recorded department.  A grant therefore constrains
exactly the dimensions it names - a ``duty_unit`` grant without a department
covers that unit under any department, while one that names a department still
pins both.
"""

from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.roles import ADMIN_ROLE
from app.db.models import UserWorkforceScope

if TYPE_CHECKING:
    from app.db.models import User


ScopeKind = Literal["organization", "department", "duty_unit", "duty_post", "self"]
_PERSISTED_SCOPE_KINDS = frozenset({"organization", "department", "duty_unit", "duty_post"})


def normalize_scope_value(value: str | None) -> str | None:
    """Trim an optional hierarchy value; blank input is absent, never a scope."""
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


@dataclass(frozen=True, slots=True)
class WorkforceScopeEntry:
    """One normalized allow-list leg in a resolved scope.

    ``self`` entries are synthesized from a linked account and only match their
    employee id.  The other entries mirror the valid hierarchy prefixes stored
    in ``user_workforce_scopes``.
    """

    scope_kind: ScopeKind
    department: str | None = None
    duty_unit: str | None = None
    duty_post: str | None = None
    employee_id: str | None = None

    def canonical_payload(self) -> dict[str, str | None]:
        return {
            "scope_kind": self.scope_kind,
            "department": self.department,
            "duty_unit": self.duty_unit,
            "duty_post": self.duty_post,
            "employee_id": self.employee_id,
        }


def _entry_sort_key(entry: WorkforceScopeEntry) -> tuple[str, str, str, str, str]:
    return (
        entry.scope_kind,
        entry.department or "",
        entry.duty_unit or "",
        entry.duty_post or "",
        entry.employee_id or "",
    )


def normalize_scope_entry(
    *,
    scope_kind: str,
    department: str | None,
    duty_unit: str | None,
    duty_post: str | None,
) -> WorkforceScopeEntry:
    """Return one canonical persisted scope entry or reject an invalid prefix.

    The database constraint is the source of truth for persisted rows.  This
    validation is deliberately repeated at the service boundary because route
    payloads and legacy rows must not become implicit wildcard grants.
    ``department`` is optional on a unit or post grant; the required levels are
    the grant's own and, for a post, the unit that contains it.
    """
    normalized_kind = scope_kind.strip()
    normalized_department = normalize_scope_value(department)
    normalized_unit = normalize_scope_value(duty_unit)
    normalized_post = normalize_scope_value(duty_post)

    if normalized_kind == "organization":
        if any((normalized_department, normalized_unit, normalized_post)):
            raise ValueError("organization scope cannot carry hierarchy values")
    elif normalized_kind == "department":
        if normalized_department is None or normalized_unit is not None or normalized_post is not None:
            raise ValueError("department scope requires only department")
    elif normalized_kind == "duty_unit":
        if normalized_unit is None or normalized_post is not None:
            raise ValueError("duty_unit scope requires duty_unit and no duty_post")
    elif normalized_kind == "duty_post":
        if normalized_unit is None or normalized_post is None:
            raise ValueError("duty_post scope requires duty_unit and duty_post")
    else:
        raise ValueError(f"unknown workforce scope kind {scope_kind!r}")

    return WorkforceScopeEntry(
        scope_kind=cast(ScopeKind, normalized_kind),
        department=normalized_department,
        duty_unit=normalized_unit,
        duty_post=normalized_post,
    )


@dataclass(frozen=True, slots=True)
class WorkforceScope:
    """An immutable union of self and persisted workforce scope entries.

    ``requested_*`` fields represent an already-intersected route filter.  They
    never originate from a grant and therefore can only remove employees from
    the original union.
    """

    entries: tuple[WorkforceScopeEntry, ...] = ()
    requested_department: str | None = None
    requested_duty_unit: str | None = None
    requested_duty_post: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "entries",
            tuple(sorted(set(self.entries), key=_entry_sort_key)),
        )
        object.__setattr__(self, "requested_department", normalize_scope_value(self.requested_department))
        object.__setattr__(self, "requested_duty_unit", normalize_scope_value(self.requested_duty_unit))
        object.__setattr__(self, "requested_duty_post", normalize_scope_value(self.requested_duty_post))

    @property
    def is_organization(self) -> bool:
        """Whether this scope contains an explicit organization-wide grant."""
        return any(entry.scope_kind == "organization" for entry in self.entries)

    @property
    def workforce_access_tier(self) -> Literal["none", "self", "scoped", "organization"]:
        """The session-safe summary used by clients to choose workforce UI."""
        if self.is_organization:
            return "organization"
        if any(entry.scope_kind != "self" for entry in self.entries):
            return "scoped"
        if any(entry.scope_kind == "self" for entry in self.entries):
            return "self"
        return "none"

    @property
    def persisted_entries(self) -> tuple[WorkforceScopeEntry, ...]:
        """Normalized database-backed entries, excluding the synthesized self leg."""
        return tuple(entry for entry in self.entries if entry.scope_kind != "self")

    def canonical_payload(self) -> dict[str, object]:
        """Stable JSON-ready data suitable for authorization version hashing."""
        return {
            "entries": [entry.canonical_payload() for entry in self.entries],
            "requested_department": self.requested_department,
            "requested_duty_unit": self.requested_duty_unit,
            "requested_duty_post": self.requested_duty_post,
        }

    def allows_employee(
        self,
        *,
        employee_id: str,
        department: str | None,
        duty_unit: str | None,
        duty_post: str | None,
    ) -> bool:
        """Return whether a fully identified employee is inside this scope.

        Each entry constrains only the dimensions it names, so a unit or post
        grant with no department matches that unit under any department -
        including the employees whose department was never recorded.  A
        ``department`` grant still requires an exact department, so an employee
        without one is inside no department grant.  Employee dimensions are
        normalized before comparison so accidental surrounding whitespace in
        legacy employee data does not silently widen an assigned scope.
        """
        normalized_employee_id = normalize_scope_value(employee_id)
        if normalized_employee_id is None:
            return False
        normalized_department = normalize_scope_value(department)
        normalized_unit = normalize_scope_value(duty_unit)
        normalized_post = normalize_scope_value(duty_post)

        if (
            self.requested_department is not None
            and normalized_department != self.requested_department
        ):
            return False
        if self.requested_duty_unit is not None and normalized_unit != self.requested_duty_unit:
            return False
        if self.requested_duty_post is not None and normalized_post != self.requested_duty_post:
            return False

        for entry in self.entries:
            if entry.scope_kind == "organization":
                return True
            if entry.scope_kind == "self":
                if entry.employee_id == normalized_employee_id:
                    return True
                continue
            if entry.department is not None and entry.department != normalized_department:
                continue
            if entry.scope_kind == "department":
                return True
            if entry.duty_unit != normalized_unit:
                continue
            if entry.scope_kind == "duty_unit":
                return True
            if entry.scope_kind == "duty_post" and entry.duty_post == normalized_post:
                return True
        return False


def resolve_workforce_scope(db: Session, user: User) -> WorkforceScope:
    """Resolve a user's canonical union of linked self and persisted scope.

    Administrators receive an explicit organization entry rather than relying
    on a role-only bypass.  Other users receive only their own linked employee
    plus valid normalized rows assigned to their account.
    """
    if user.role == ADMIN_ROLE:
        return WorkforceScope(entries=(WorkforceScopeEntry(scope_kind="organization"),))

    entries: list[WorkforceScopeEntry] = []
    employee_id = normalize_scope_value(user.employee_id)
    if employee_id is not None:
        entries.append(WorkforceScopeEntry(scope_kind="self", employee_id=employee_id))

    rows = db.execute(
        select(UserWorkforceScope).where(UserWorkforceScope.user_id == user.id)
    ).scalars()
    for row in rows:
        if row.scope_kind not in _PERSISTED_SCOPE_KINDS:
            continue
        try:
            entries.append(
                normalize_scope_entry(
                    scope_kind=row.scope_kind,
                    department=row.department,
                    duty_unit=row.duty_unit,
                    duty_post=row.duty_post,
                )
            )
        except ValueError:
            # Invalid legacy data is not a wildcard.  Ignore it until an
            # authorized scope replacement repairs the row.
            continue
    return WorkforceScope(entries=tuple(entries))


def intersect_workforce_scope(
    scope: WorkforceScope,
    *,
    department: str | None = None,
    duty_unit: str | None = None,
    duty_post: str | None = None,
) -> WorkforceScope:
    """Return a scope restricted by optional request filters.

    A different value at an already-restricted level has an empty intersection;
    omitted filters preserve the existing restriction.  No call path can clear
    a prior restriction or add a new allow-list leg.
    """
    requested = (
        ("requested_department", normalize_scope_value(department)),
        ("requested_duty_unit", normalize_scope_value(duty_unit)),
        ("requested_duty_post", normalize_scope_value(duty_post)),
    )
    current = {
        "requested_department": scope.requested_department,
        "requested_duty_unit": scope.requested_duty_unit,
        "requested_duty_post": scope.requested_duty_post,
    }
    for key, value in requested:
        if value is not None and current[key] is not None and current[key] != value:
            return WorkforceScope(
                requested_department=scope.requested_department,
                requested_duty_unit=scope.requested_duty_unit,
                requested_duty_post=scope.requested_duty_post,
            )
        if value is not None:
            current[key] = value

    return WorkforceScope(
        entries=scope.entries,
        requested_department=current["requested_department"],
        requested_duty_unit=current["requested_duty_unit"],
        requested_duty_post=current["requested_duty_post"],
    )



def scope_allows(
    scope: WorkforceScope,
    *,
    employee_id: str,
    department: str | None,
    duty_unit: str | None,
    duty_post: str | None,
) -> bool:
    """Convenience predicate for an employee row's workforce dimensions."""
    return scope.allows_employee(
        employee_id=employee_id,
        department=department,
        duty_unit=duty_unit,
        duty_post=duty_post,
    )


def encode_cursor(payload: Mapping[str, object]) -> str:
    """Encode a canonical, URL-safe opaque pagination cursor.

    Callers include the endpoint, resolved-scope fingerprint, and sort position
    in ``payload``.  ``decode_cursor`` validates only the transport envelope;
    the endpoint must reject a payload whose endpoint/scope fields differ from
    the active request.
    """
    encoded = json.dumps(dict(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return base64.urlsafe_b64encode(encoded.encode("utf-8")).rstrip(b"=").decode("ascii")


def decode_cursor(cursor: str | None) -> dict[str, object] | None:
    """Decode an opaque cursor or reject malformed/non-object input."""
    if cursor is None:
        return None
    if not cursor or len(cursor) > 4096:
        raise ValueError("invalid cursor")
    try:
        raw = base64.b64decode(
            (cursor + "=" * (-len(cursor) % 4)).encode("ascii"),
            altchars=b"-_",
            validate=True,
        )
        payload = json.loads(raw.decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise ValueError("invalid cursor") from exc
    if not isinstance(payload, dict) or not all(isinstance(key, str) for key in payload):
        raise ValueError("invalid cursor")
    return payload


__all__ = [
    "ScopeKind",
    "WorkforceScope",
    "WorkforceScopeEntry",
    "decode_cursor",
    "encode_cursor",
    "intersect_workforce_scope",
    "normalize_scope_entry",
    "normalize_scope_value",
    "resolve_workforce_scope",
    "scope_allows",
]
