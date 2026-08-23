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
        "employees.create",
        "employees",
        "Create employees",
        "Add new employees to the directory.",
    ),
    Capability(
        "employees.edit",
        "employees",
        "Edit employee profiles",
        "Edit profiles, photos, signature, and passport data.",
    ),
    Capability(
        "employees.vault.manage",
        "employees",
        "Manage document vaults",
        "Upload and organise files inside employee vaults.",
    ),
    Capability(
        "employees.notify",
        "employees",
        "Notify employees",
        "Send WhatsApp (with SMS fallback) confirmations to employees for leaves, "
        "duty resumptions, and violations.",
    ),
    Capability(
        "leaves.view",
        "leaves",
        "View leaves",
        "See leave records and their status.",
    ),
    Capability(
        "timesheet.view",
        "timesheet",
        "View the time sheet",
        "See the monthly attendance grid and download the sheets.",
    ),
    Capability(
        "timesheet.edit",
        "timesheet",
        "Correct and close the time sheet",
        "Mark absence, correct cells, set the post count, and close or reopen a month.",
    ),
    Capability(
        "leaves.create",
        "leaves",
        "Create leaves",
        "Record new leave requests.",
    ),
    Capability(
        "leaves.edit",
        "leaves",
        "Edit leaves",
        "Amend leaves, attach certificates, and record duty returns.",
    ),
    Capability(
        "leaves.delete",
        "leaves",
        "Delete leaves",
        "Remove leave records.",
    ),
    Capability(
        "violations.view",
        "violations",
        "View violations",
        "See recorded violations.",
    ),
    Capability(
        "violations.create",
        "violations",
        "Create violations",
        "Record new violations.",
    ),
    Capability(
        "violations.edit",
        "violations",
        "Edit violations",
        "Correct violation details.",
    ),
    Capability(
        "violations.delete",
        "violations",
        "Delete violations",
        "Remove violations.",
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
    Capability(
        "books.view",
        "books",
        "View records",
        "Browse the records register.",
    ),
    Capability(
        "books.create",
        "books",
        "Create records",
        "Start new records from forms or templates.",
    ),
    Capability(
        "books.edit",
        "books",
        "Edit records & attachments",
        "Edit fields, reviewers, attachments, and file scan-backs.",
    ),
    Capability(
        "books.submit",
        "books",
        "Submit for approval",
        "Send records into the approval chain.",
    ),
    Capability(
        "books.approve",
        "books",
        "Approve / reject records",
        "Approve, sign, or reject documents in the approval queue.",
    ),
    Capability(
        "books.override_state",
        "books",
        "Force a record's state",
        "Set any record to any state — draft, awaiting signature, awaiting scan, "
        "approved, returned, rejected, or voided — bypassing the approval chain. "
        "Admin-grade: it overrides who signed what.",
    ),
    Capability(
        "books.templates",
        "books",
        "Manage Word templates",
        "Edit the shared Word templates records are composed from.",
    ),
    Capability(
        "books.delete",
        "books",
        "Delete records",
        "Move records to the bin.",
    ),
    Capability(
        "permits.view",
        "permits",
        "View security permits",
        "See the security-zone entry-permit register and its status.",
    ),
    Capability(
        "permits.create",
        "permits",
        "Issue permits",
        "Register new security-zone entry permits.",
    ),
    Capability(
        "permits.edit",
        "permits",
        "Amend & renew permits",
        "Edit people, vehicles, and documents; renew permits.",
    ),
    Capability(
        "permits.revoke",
        "permits",
        "Revoke permits",
        "Revoke active entry permits.",
    ),
    Capability(
        "permits.delete",
        "permits",
        "Delete permits",
        "Remove permit records.",
    ),
    Capability(
        "ledger.view",
        "ledger",
        "View correspondence log",
        "Read correspondence ledger entries.",
    ),
    Capability(
        "ledger.create",
        "ledger",
        "Create entries & drafts",
        "Compose new entries, drafts, contacts, and recipient lists.",
    ),
    Capability(
        "ledger.edit",
        "ledger",
        "Edit entries & address book",
        "Edit entries and lists, flag, star, and attach files.",
    ),
    Capability(
        "ledger.send",
        "ledger",
        "Send email from the ledger",
        "Send email messages from the ledger as yourself.",
    ),
    Capability(
        "ledger.delete",
        "ledger",
        "Delete entries & drafts",
        "Remove entries, drafts, contacts, and lists.",
    ),
    Capability(
        "email.manage",
        "email",
        "Manage your mailbox",
        "Link and sync your own mailbox.",
    ),
    Capability(
        "settings.view",
        "settings",
        "View settings",
        "See application settings.",
    ),
    Capability(
        "settings.edit",
        "settings",
        "Change settings",
        "Change application settings.",
    ),
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
        "messages.broadcast",
        "messages",
        "Send group announcements",
        "Post announcements (text or a document) to WhatsApp groups.",
    ),
    Capability(
        "workforce.self.view",
        "workforce",
        "View own workforce record",
        "View your own schedule, attendance punches, and leave.",
    ),
    Capability(
        "workforce.dashboard.view",
        "workforce",
        "View workforce dashboard",
        "View aggregate workforce dashboard data inside assigned scope.",
    ),
    Capability(
        "workforce.people.view",
        "workforce",
        "View workforce people",
        "View roster and attendance details inside assigned scope.",
    ),
    Capability(
        "workforce.schedule.manage",
        "workforce",
        "Manage workforce schedules",
        "Manage crews, rotations, memberships, and schedule overrides.",
    ),
    Capability(
        "workforce.policy.manage",
        "workforce",
        "Manage workforce policies",
        "Manage staffing requirements, attendance policies, and excusing leave kinds.",
    ),
    Capability(
        "workforce.attendance.review",
        "workforce",
        "Review workforce attendance",
        "Review workforce attendance cases, exceptions, and source facts.",
    ),
    Capability(
        "workforce.attendance.correct",
        "workforce",
        "Correct workforce attendance",
        "Create audited workforce attendance adjustments.",
    ),
    Capability(
        "workforce.integration.manage",
        "workforce",
        "Manage workforce integration",
        "Manage workforce provider status, mappings, tests, and synchronization.",
    ),
    Capability(
        "system.admin",
        "system",
        "Admin key + v3 migration",
        "Use the admin key and run system/migration tools (admin-only).",
    ),
)

CAPABILITY_IDS: Final[frozenset[str]] = frozenset(c.id for c in CAPABILITIES)

# Convenience: the complete set (what the admin preset resolves to).
ALL_CAPABILITIES: Final[frozenset[str]] = CAPABILITY_IDS


# ─── Role presets ───────────────────────────────────────────────────────────────
# Operator: read-only across the app + the daily-work write surfaces (document
# generation, ledger entries/drafts). Manager: adds the management writes.
# Admin: everything.
_OPERATOR_CAPS: Final[frozenset[str]] = frozenset(
    {
        "app.access",
        "employees.view",
        "leaves.view",
        "timesheet.view",
        "violations.view",
        "documents.generate",
        "documents.scan",
        "books.view",
        "permits.view",
        "ledger.view",
        "ledger.create",
        "ledger.edit",
        "ledger.send",
        "email.manage",
        "settings.view",
        "workforce.self.view",
    }
)

# Atomic equivalents of the old bundled manager grants, plus the newer
# per-domain grants upstream presets carry (timesheet). Workforce is
# intentionally absent: it always needs an explicit grant + scope.
_MANAGER_EXTRA: Final[frozenset[str]] = frozenset(
    {
        "employees.create",
        "employees.edit",
        "employees.vault.manage",
        "employees.notify",
        "leaves.create",
        "leaves.edit",
        "leaves.delete",
        "violations.create",
        "violations.edit",
        "violations.delete",
        "books.create",
        "books.edit",
        "books.submit",
        "books.templates",
        "books.delete",
        "books.approve",
        "permits.create",
        "permits.edit",
        "permits.revoke",
        "permits.delete",
        "ledger.delete",
        "submitters.manage",
        "editor_templates.manage",
        "timesheet.edit",
    }
)

_MANAGER_CAPS: Final[frozenset[str]] = (_OPERATOR_CAPS | _MANAGER_EXTRA) - frozenset(
    {"workforce.self.view"}
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
