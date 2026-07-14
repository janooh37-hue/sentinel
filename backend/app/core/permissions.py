"""Capability catalog + role-default presets — single source of truth.

Authorization is capability-based. A capability is a ``domain.action`` string
(e.g. ``settings.edit``). Roles (operator/manager/admin) are *presets*: each
maps to a default bundle of capabilities. An admin can then layer per-user
``grant``/``deny`` overrides on top (see ``services.perm_service``).

The admin role short-circuits to "all capabilities" so an admin can never lock
themselves out of user management.
"""

from __future__ import annotations

from typing import Final, NamedTuple

from app.core.roles import ADMIN_ROLE, MANAGER_ROLE, OPERATOR_ROLE


class Capability(NamedTuple):
    """One capability: its id, the domain it groups under, a label, and a description."""

    id: str
    domain: str
    label: str
    description: str


# ─── Catalog ──────────────────────────────────────────────────────────────────
# Ordered by domain so the admin matrix can render collapsible domain groups.
# ``app.access`` is the baseline every signed-in user gets (dashboard, template
# field lists, managers list, system/info — the read-only chrome).

CAPABILITIES: Final[tuple[Capability, ...]] = (
    Capability(
        "app.access",
        "app",
        "Access the app",
        "Sign in and see the dashboard, document fields, and read-only chrome.",
    ),
    Capability(
        "employees.view",
        "employees",
        "View employees",
        "See the employee directory and individual employee records.",
    ),
    Capability(
        "employees.edit",
        "employees",
        "Create / edit employees + vault",
        "Add and edit employees and manage their document vault.",
    ),
    Capability(
        "employees.notify",
        "employees",
        "Notify employees",
        "Send WhatsApp (with SMS fallback) confirmations to employees for leaves, duty resumptions, and violations.",
    ),
    Capability("leaves.view", "leaves", "View leaves", "See leave records and their status."),
    Capability(
        "leaves.edit", "leaves", "Edit / delete leaves", "Create, edit, and delete leave records."
    ),
    Capability("violations.view", "violations", "View violations", "See recorded violations."),
    Capability(
        "violations.manage",
        "violations",
        "Create / edit / delete violations",
        "Record, edit, and remove violations.",
    ),
    Capability(
        "documents.generate",
        "documents",
        "Generate documents",
        "Create official documents from templates.",
    ),
    Capability(
        "documents.scan",
        "documents",
        "Scan documents with OCR",
        "Upload scans and run OCR to import documents.",
    ),
    Capability("books.view", "books", "View books", "Browse the records/books register."),
    Capability(
        "books.manage",
        "books",
        "Create / edit / delete books",
        "Create records, edit them, submit for approval, and delete.",
    ),
    Capability(
        "books.approve",
        "books",
        "Approve / reject books",
        "Approve, sign, or reject documents in the approval queue.",
    ),
    Capability("ledger.view", "ledger", "View ledger", "Read correspondence ledger entries."),
    Capability(
        "ledger.edit",
        "ledger",
        "Edit ledger entries + drafts",
        "Create and edit ledger entries and email drafts.",
    ),
    Capability(
        "ledger.send",
        "ledger",
        "Send email from the ledger",
        "Send email messages from the ledger as yourself.",
    ),
    Capability("email.manage", "email", "Manage your mailbox", "Link and sync your own mailbox."),
    Capability("settings.view", "settings", "View settings", "See application settings."),
    Capability("settings.edit", "settings", "Change settings", "Change application settings."),
    Capability(
        "submitters.manage",
        "submitters",
        "Manage submitters",
        "Manage the list of document submitters.",
    ),
    Capability(
        "editor_templates.manage",
        "editor_templates",
        "Manage editor templates",
        "Create and edit document editor templates.",
    ),
    Capability(
        "users.manage",
        "users",
        "Manage users + permissions",
        "Manage user accounts and their permissions (admin-only).",
    ),
    Capability(
        "system.admin",
        "system",
        "Admin key + v3 migration",
        "Use the admin key and run system/migration tools (admin-only).",
    ),
    Capability(
        "messages.broadcast",
        "messages",
        "Send group announcements",
        "Post announcements (text or a document) to WhatsApp groups.",
    ),
)

CAPABILITY_IDS: Final[frozenset[str]] = frozenset(c.id for c in CAPABILITIES)

# Convenience: the complete set (what the admin preset resolves to).
ALL_CAPABILITIES: Final[frozenset[str]] = CAPABILITY_IDS


# ─── Role presets ───────────────────────────────────────────────────────────────
# Operator: read-only across the app + the two daily-work write surfaces
# (document generation, ledger entries). Manager: adds the management write
# capabilities. Admin: everything.

_OPERATOR_CAPS: Final[frozenset[str]] = frozenset(
    {
        "app.access",
        "employees.view",
        "leaves.view",
        "violations.view",
        "documents.generate",
        "documents.scan",
        "books.view",
        "ledger.view",
        "ledger.edit",
        "ledger.send",  # Phase 3: send as yourself
        "email.manage",  # Phase 3: link/sync your OWN mailbox
        "settings.view",
    }
)

_MANAGER_CAPS: Final[frozenset[str]] = _OPERATOR_CAPS | frozenset(
    {
        "employees.edit",
        "employees.notify",
        "leaves.edit",
        "violations.manage",
        "books.manage",
        "books.approve",
        "ledger.send",
        "submitters.manage",
        "editor_templates.manage",
    }
)

ROLE_DEFAULTS: Final[dict[str, frozenset[str]]] = {
    OPERATOR_ROLE: _OPERATOR_CAPS,
    MANAGER_ROLE: _MANAGER_CAPS,
    ADMIN_ROLE: ALL_CAPABILITIES,
}


def default_caps_for_role(role: str) -> frozenset[str]:
    """Role-preset capability bundle. Unknown roles get the operator default."""
    return ROLE_DEFAULTS.get(role, _OPERATOR_CAPS)


__all__ = [
    "ALL_CAPABILITIES",
    "CAPABILITIES",
    "CAPABILITY_IDS",
    "ROLE_DEFAULTS",
    "Capability",
    "default_caps_for_role",
]
