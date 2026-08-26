# Granular Permissions Split + Arabic i18n + Sheet Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the six bundled capabilities (`employees.edit`, `leaves.edit`, `violations.manage`, `books.manage`, `permits.manage`, `ledger.edit`) into atomic per-action capabilities, migrate all stored data so nobody gains/loses access, add a search + per-domain bulk actions to the permissions sheet, and translate every capability label and description into Arabic (fixing the English-descriptions-in-RTL bug).

**Architecture:** The capability catalog in `backend/app/core/permissions.py` is the single source of truth; routes re-gate onto atomic ids, an Alembic data migration expands old stored grants/denies/role-rows to their children, and the admin sheet (`UserPermissionsSheet`) gains search + bulk controls backed by one new batch endpoint. Locale files carry `access.permissions.caps.<id>` labels and `perms.caps.<id>.desc` descriptions; `CapabilityGate` localizes through i18n with catalog fallback. A cross-stack completeness test parses the Python catalog and asserts every id has EN+AR label, description, and domain keys.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend), React + TanStack Query + i18next + vitest (frontend), pytest (backend).

## Global Constraints

- Old capability ids (`employees.edit`, `leaves.edit`, `violations.manage`, `books.manage`, `permits.manage`, `ledger.edit`) are **removed** from the catalog — no aliasing layer. Backend and frontend ship together (pywebview bundles both).
- **Access is preserved exactly**: every stored grant/deny on an old id expands to *all* of its children; role presets re-seed to the atomic equivalents of what each role held before.
- `_SENSITIVE_CAPS = {"users.manage", "system.admin"}` unchanged — never grantable via override.
- Admin role short-circuits to `ALL_CAPABILITIES` (lockout protection) — unchanged.
- All UI strings go through i18next; **no hardcoded user-facing strings** in components. Arabic uses the existing `access.permissions.*` / `perms.caps.*` key namespaces.
- RTL safety: only logical CSS utilities (`ms-*`, `me-*`, `border-e`, `text-start`) in touched components.
- Migration number: **0074** (latest is 0073).
- Comments only where they explain *why*; match existing file style (docstring headers, `# ───` section rules).
- Every task ends green: `pytest` for backend tasks, `vitest` + `tsc` for frontend tasks.

**Expansion map (single source of truth for Tasks 1, 2 and referenced everywhere):**

```
employees.edit    → employees.create, employees.edit, employees.vault.manage
leaves.edit       → leaves.create, leaves.edit, leaves.delete
violations.manage → violations.create, violations.edit, violations.delete
books.manage      → books.create, books.edit, books.submit, books.templates, books.delete
permits.manage    → permits.create, permits.edit, permits.revoke, permits.delete
ledger.edit       → ledger.create, ledger.edit, ledger.delete
```

**Route re-gating map (authoritative for Tasks 3–5):**

| File:line (approx) | Route | Old gate | New gate |
| --- | --- | --- | --- |
| `employees.py:121` | POST `/employees` | employees.edit | employees.create |
| `employees.py:193` | PATCH `/employees/{id}` | employees.edit | employees.edit |
| `employees.py:407` | POST `/employees/{id}/signature` | employees.edit | employees.edit |
| `employees.py:458` | DELETE `/employees/{id}/signature` | employees.edit | employees.edit |
| `employees.py:473` | POST `/employees/{id}/photo` | employees.edit | employees.edit |
| `employees.py:491` | DELETE `/employees/{id}/photo` | employees.edit | employees.edit |
| `employees.py:549` | POST `/employees/{id}/passport/extract` | employees.edit | employees.edit |
| `employees.py:309` | POST vault node | employees.edit | employees.vault.manage |
| `employees.py:337` | DELETE vault node | employees.edit | employees.vault.manage |
| `org_tree.py:32` | POST org-tree node | employees.edit | employees.edit |
| `employees.py:259` | POST violation | violations.manage | violations.create |
| `employees.py:274` | PATCH violation | violations.manage | violations.edit |
| `employees.py:284` | DELETE violation | violations.manage | violations.delete |
| `leaves.py:100` | POST `/leaves` | leaves.edit | leaves.create |
| `leaves.py:122` | PATCH `/leaves/{id}` | leaves.edit | leaves.edit |
| `leaves.py:133` | POST amend | leaves.edit | leaves.edit |
| `leaves.py:148` | POST certificate | leaves.edit | leaves.edit |
| `leaves.py:162` | POST return | leaves.edit | leaves.edit |
| `leaves.py:205` | DELETE `/leaves/{id}` | leaves.edit | leaves.delete |
| `books.py:158,169,180,190` | word-templates list/patch/table/delete | books.manage | books.templates |
| `books.py:320` | POST save-as-template | books.manage | books.templates |
| `books.py:200,240,257,280,303` | word-sessions create/finish/preview/retokenize/delete | books.manage | books.edit |
| `books.py:509` | GET awaiting-scan | books.manage | books.edit |
| `books.py:528,540` | GET approvers / reviewer-candidates | books.manage | books.edit |
| `books.py:742` | GET version fields | books.manage | books.edit |
| `books.py:829` | POST `/books` | books.manage | books.create |
| `books.py:839` | PATCH `/books/{id}` | books.manage | books.edit |
| `books.py:850` | DELETE `/books/{id}` | books.manage | books.delete |
| `books.py:865` | POST submit | books.manage | books.submit |
| `books.py:981,995` | reviewers add/remove | books.manage | books.edit |
| `books.py:1014,1063,1083` | attachments add/delete/update | books.manage | books.edit |
| `books.py:1099,1116` | signed-copy put/delete | books.manage | books.edit |
| `notify.py:76` | POST refresh-delivery | books.manage | books.edit |
| `recipients.py:34,44` | recipients list/save | books.manage | books.edit |
| `permits.py:139` | POST `/permits` | permits.manage | permits.create |
| `permits.py:149,157` | OCR scan helpers | permits.manage | permits.edit |
| `permits.py:175,186,214` | PATCH / renew / submit-approval | permits.manage | permits.edit |
| `permits.py:203` | POST revoke | permits.manage | permits.revoke |
| `permits.py:225` | DELETE permit | permits.manage | permits.delete |
| `permits.py:235,246,257` | people add/remove/document | permits.manage | permits.edit |
| `permits.py:285,298,310,321` | vehicle add/patch/delete/document | permits.manage | permits.edit |
| `permits.py:349,373` | permit document post/delete | permits.manage | permits.edit |
| `permits.py:394` | POST visit | permits.manage | permits.edit |
| `ledger.py:168` | POST contact | ledger.edit | ledger.create |
| `ledger.py:213` | POST recipient-list | ledger.edit | ledger.create |
| `ledger.py:518` | POST draft | ledger.edit | ledger.create |
| `ledger.py:757` | POST entry | ledger.edit | ledger.create |
| `ledger.py:229,532,637,652,767,793,810` | PATCH lists/drafts/entries, flag, star, attachments | ledger.edit | ledger.edit |
| `ledger.py:187,242,558,778` | DELETE contact/list/draft/entry | ledger.edit | ledger.delete |
| `smart_folders.py:77` | POST smart folder | ledger.edit | ledger.create |
| `smart_folders.py:87,99,112` | dismiss / patch / delete | ledger.edit | ledger.edit |

Non-route references to update: `notification_service.py:139` (`has_capability(db, user, "books.manage")` → `"books.edit"`, plus the comment at :84 and :137), `notification_service.py:84` (docstring mention).

---

### Task 1: Atomic catalog + role presets (`core/permissions.py`)

**Files:**
- Modify: `backend/app/core/permissions.py`
- Modify: `backend/tests/test_permissions_catalog.py`

**Interfaces:**
- Consumes: nothing (root module).
- Produces: `CAPABILITIES` (50 atomic entries), `CAPABILITY_IDS`, `ALL_CAPABILITIES`, `ROLE_DEFAULTS`, `default_caps_for_role(role)` — same names/signatures as today. `books.manage` etc. no longer exist in `CAPABILITY_IDS`.

- [ ] **Step 1: Write the failing catalog test**

Replace `backend/tests/test_permissions_catalog.py` entirely:

```python
from app.core.permissions import ALL_CAPABILITIES, CAPABILITIES, CAPABILITY_IDS, ROLE_DEFAULTS


def test_every_capability_has_a_nonempty_description():
    for cap in CAPABILITIES:
        assert cap.description and len(cap.description) > 10, cap.id


def test_old_bundled_ids_are_gone():
    for old in (
        "employees.edit",
        "leaves.edit",
        "violations.manage",
        "books.manage",
        "permits.manage",
        "ledger.edit",
    ):
        assert old not in CAPABILITY_IDS, old


def test_atomic_children_exist():
    children = {
        "employees.create", "employees.edit", "employees.vault.manage",
        "leaves.create", "leaves.delete",
        "violations.create", "violations.edit", "violations.delete",
        "books.create", "books.edit", "books.submit", "books.templates", "books.delete",
        "permits.create", "permits.edit", "permits.revoke", "permits.delete",
        "ledger.create", "ledger.delete",
    }
    assert children <= CAPABILITY_IDS


def test_capability_ids_are_unique_and_dot_namespaced():
    assert len(CAPABILITY_IDS) == len(CAPABILITIES)
    assert all("." in c.id for c in CAPABILITIES)


def test_manager_preset_resolves_atomic_equivalents():
    """Manager keeps exactly what the old bundle granted, now atomically."""
    m = ROLE_DEFAULTS["manager"]
    for cap in (
        "employees.create", "employees.edit", "employees.vault.manage",
        "leaves.create", "leaves.edit", "leaves.delete",
        "violations.create", "violations.edit", "violations.delete",
        "books.create", "books.edit", "books.submit", "books.templates", "books.delete",
        "books.approve", "permits.create", "permits.edit", "permits.revoke",
        "permits.delete", "ledger.create", "ledger.edit", "ledger.delete",
    ):
        assert cap in m, cap
    # never bundled into manager: admin-grade / scoped / broadcast / self-workforce
    for cap in ("users.manage", "system.admin", "books.override_state",
                "messages.broadcast", "workforce.schedule.manage"):
        assert cap not in m, cap


def test_operator_preset_keeps_ledger_writes_atomically():
    o = ROLE_DEFAULTS["operator"]
    assert {"ledger.create", "ledger.edit"} <= o
    assert "ledger.delete" not in o


def test_admin_preset_is_all():
    assert ROLE_DEFAULTS["admin"] == ALL_CAPABILITIES == CAPABILITY_IDS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_permissions_catalog.py -v`
Expected: FAIL — `old bundled ids are gone` and `atomic children exist` assert against the current 35-cap catalog.

- [ ] **Step 3: Rewrite the catalog**

In `backend/app/core/permissions.py` replace the entire `CAPABILITIES` tuple and the preset block (`_OPERATOR_CAPS` / `_MANAGER_CAPS` / `ROLE_DEFAULTS`). Keep the module docstring, `Capability` NamedTuple, and `__all__` exactly as-is.

```python
CAPABILITIES: Final[tuple[Capability, ...]] = (
    Capability(
        "app.access", "app", "Access the app",
        "Sign in and see the dashboard, document fields, and read-only chrome.",
    ),
    Capability(
        "employees.view", "employees", "View employees",
        "See the employee directory and individual employee records.",
    ),
    Capability(
        "employees.create", "employees", "Create employees",
        "Add new employees to the directory.",
    ),
    Capability(
        "employees.edit", "employees", "Edit employee profiles",
        "Edit profiles, photos, signature, and passport data.",
    ),
    Capability(
        "employees.vault.manage", "employees", "Manage document vaults",
        "Upload and organise files inside employee vaults.",
    ),
    Capability(
        "employees.notify", "employees", "Notify employees",
        "Send WhatsApp (with SMS fallback) confirmations to employees for leaves, "
        "duty resumptions, and violations.",
    ),
    Capability(
        "leaves.view", "leaves", "View leaves",
        "See leave records and their status.",
    ),
    Capability(
        "leaves.create", "leaves", "Create leaves",
        "Record new leave requests.",
    ),
    Capability(
        "leaves.edit", "leaves", "Edit leaves",
        "Amend leaves, attach certificates, and record duty returns.",
    ),
    Capability(
        "leaves.delete", "leaves", "Delete leaves",
        "Remove leave records.",
    ),
    Capability(
        "violations.view", "violations", "View violations",
        "See recorded violations.",
    ),
    Capability(
        "violations.create", "violations", "Create violations",
        "Record new violations.",
    ),
    Capability(
        "violations.edit", "violations", "Edit violations",
        "Correct violation details.",
    ),
    Capability(
        "violations.delete", "violations", "Delete violations",
        "Remove violations.",
    ),
    Capability(
        "documents.generate", "documents", "Generate documents",
        "Create official documents from templates.",
    ),
    Capability(
        "documents.scan", "documents", "Scan documents with OCR",
        "Upload scans and run OCR to import documents.",
    ),
    Capability(
        "books.view", "books", "View records",
        "Browse the records register.",
    ),
    Capability(
        "books.create", "books", "Create records",
        "Start new records from forms or templates.",
    ),
    Capability(
        "books.edit", "books", "Edit records & attachments",
        "Edit fields, reviewers, attachments, and file scan-backs.",
    ),
    Capability(
        "books.submit", "books", "Submit for approval",
        "Send records into the approval chain.",
    ),
    Capability(
        "books.approve", "books", "Approve / reject records",
        "Approve, sign, or reject documents in the approval queue.",
    ),
    Capability(
        "books.override_state", "books", "Force a record's state",
        "Set any record to any state — draft, awaiting signature, awaiting scan, "
        "approved, returned, rejected, or voided — bypassing the approval chain. "
        "Admin-grade: it overrides who signed what.",
    ),
    Capability(
        "books.templates", "books", "Manage Word templates",
        "Edit the shared Word templates records are composed from.",
    ),
    Capability(
        "books.delete", "books", "Delete records",
        "Move records to the bin.",
    ),
    Capability(
        "permits.view", "permits", "View security permits",
        "See the security-zone entry-permit register and its status.",
    ),
    Capability(
        "permits.create", "permits", "Issue permits",
        "Register new security-zone entry permits.",
    ),
    Capability(
        "permits.edit", "permits", "Amend & renew permits",
        "Edit people, vehicles, and documents; renew permits.",
    ),
    Capability(
        "permits.revoke", "permits", "Revoke permits",
        "Revoke active entry permits.",
    ),
    Capability(
        "permits.delete", "permits", "Delete permits",
        "Remove permit records.",
    ),
    Capability(
        "ledger.view", "ledger", "View correspondence log",
        "Read correspondence ledger entries.",
    ),
    Capability(
        "ledger.create", "ledger", "Create entries & drafts",
        "Compose new entries, drafts, contacts, and recipient lists.",
    ),
    Capability(
        "ledger.edit", "ledger", "Edit entries & address book",
        "Edit entries and lists, flag, star, and attach files.",
    ),
    Capability(
        "ledger.send", "ledger", "Send email from the ledger",
        "Send email messages from the ledger as yourself.",
    ),
    Capability(
        "ledger.delete", "ledger", "Delete entries & drafts",
        "Remove entries, drafts, contacts, and lists.",
    ),
    Capability(
        "email.manage", "email", "Manage your mailbox",
        "Link and sync your own mailbox.",
    ),
    Capability(
        "settings.view", "settings", "View settings",
        "See application settings.",
    ),
    Capability(
        "settings.edit", "settings", "Change settings",
        "Change application settings.",
    ),
    Capability(
        "submitters.manage", "submitters", "Manage submitters",
        "Manage the list of document submitters.",
    ),
    Capability(
        "editor_templates.manage", "editor_templates", "Manage editor templates",
        "Create and edit document editor templates.",
    ),
    Capability(
        "users.manage", "users", "Manage users + permissions",
        "Manage user accounts and their permissions (admin-only).",
    ),
    Capability(
        "messages.broadcast", "messages", "Send group announcements",
        "Post announcements (text or a document) to WhatsApp groups.",
    ),
    Capability(
        "workforce.self.view", "workforce", "View own workforce record",
        "View your own schedule, attendance punches, and leave.",
    ),
    Capability(
        "workforce.dashboard.view", "workforce", "View workforce dashboard",
        "View aggregate workforce dashboard data inside assigned scope.",
    ),
    Capability(
        "workforce.people.view", "workforce", "View workforce people",
        "View roster and attendance details inside assigned scope.",
    ),
    Capability(
        "workforce.schedule.manage", "workforce", "Manage workforce schedules",
        "Manage crews, rotations, memberships, and schedule overrides.",
    ),
    Capability(
        "workforce.policy.manage", "workforce", "Manage workforce policies",
        "Manage staffing requirements, attendance policies, and excusing leave kinds.",
    ),
    Capability(
        "workforce.attendance.review", "workforce", "Review workforce attendance",
        "Review workforce attendance cases, exceptions, and source facts.",
    ),
    Capability(
        "workforce.attendance.correct", "workforce", "Correct workforce attendance",
        "Create audited workforce attendance adjustments.",
    ),
    Capability(
        "workforce.integration.manage", "workforce", "Manage workforce integration",
        "Manage workforce provider status, mappings, tests, and synchronization.",
    ),
    Capability(
        "system.admin", "system", "Admin key + v3 migration",
        "Use the admin key and run system/migration tools (admin-only).",
    ),
)
```

Replace the preset block with:

```python
# Operator: read-only across the app + the daily-work write surfaces (document
# generation, ledger entries/drafts). Manager: adds the management writes.
# Admin: everything.
_OPERATOR_CAPS: Final[frozenset[str]] = frozenset(
    {
        "app.access",
        "employees.view",
        "leaves.view",
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

# Atomic equivalents of the old bundled manager grants. Workforce is
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
        "submitters.manage",
        "editor_templates.manage",
    }
)

_MANAGER_CAPS: Final[frozenset[str]] = (
    _OPERATOR_CAPS | _MANAGER_EXTRA
) - frozenset({"workforce.self.view"})
```

`ROLE_DEFAULTS`, `default_caps_for_role`, `CAPABILITY_IDS`, `ALL_CAPABILITIES`, `__all__` stay unchanged.

- [ ] **Step 4: Run catalog tests green**

Run: `python -m pytest backend/tests/test_permissions_catalog.py -v`
Expected: all 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/permissions.py backend/tests/test_permissions_catalog.py
git commit -m "feat(permissions): split six bundled caps into atomic per-action catalog"
```

---

### Task 2: Migration 0074 — expand stored rows, preserve access exactly

**Files:**
- Create: `backend/app/db/migrations/versions/0074_split_bundled_capabilities.py`
- Create: `backend/tests/test_migration_0074_expansion.py`

**Interfaces:**
- Consumes: tables `role_permissions(role, capability)`, `user_permissions(user_id, capability, effect, expires_at)`, `permission_requests(id, user_id, capability, status, ...)`.
- Produces: DB state where no old bundled id remains in `role_permissions`/`user_permissions`; pending `permission_requests` rows referencing an old id point at its primary child. `downgrade()` is an explicit no-op (originals are not recoverable).

- [ ] **Step 1: Write the failing migration test**

Create `backend/tests/test_migration_0074_expansion.py`:

```python
"""Migration 0074 must preserve effective access exactly.

Runs the full alembic chain to 0073 on a temp SQLite file, seeds old-style
rows, upgrades to 0074, and asserts the expansion:
  role_permissions: children in, parent out
  user_permissions: grant/deny (incl. expires_at) copied to every child
  permission_requests: pending rows re-pointed to the primary child
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.usefixtures()

ALEMBIC_INI = "alembic.ini"


def _cfg(db_url: str) -> Config:
    cfg = Config(ALEMBIC_INI)
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


def test_0074_expands_bundled_rows(tmp_path):
    db_file = tmp_path / "mig.db"
    url = f"sqlite:///{db_file}"
    cfg = _cfg(url)

    command.upgrade(cfg, "0073")
    eng = create_engine(url)
    with eng.begin() as c:
        # role preset: manager held the old bundle
        c.execute(text("INSERT OR IGNORE INTO role_permissions(role, capability) VALUES ('manager','books.manage')"))
        c.execute(text("INSERT OR IGNORE INTO role_permissions(role, capability) VALUES ('manager','ledger.edit')"))
        # per-user overrides: grant w/ expiry + deny
        c.execute(text(
            "INSERT INTO user_permissions(user_id, capability, effect, expires_at) "
            "VALUES (1,'books.manage','grant',:exp)"), {"exp": datetime(2030, 1, 1)})
        c.execute(text(
            "INSERT INTO user_permissions(user_id, capability, effect, expires_at) "
            "VALUES (2,'permits.manage','deny',NULL)"))
        # a pending request for an old id
        c.execute(text(
            "INSERT INTO permission_requests(user_id, capability, status, created_at) "
            "VALUES (3,'books.manage','pending',:now)"), {"now": datetime.now()})
    eng.dispose()

    command.upgrade(cfg, "0074")

    eng = create_engine(url)
    with eng.begin() as c:
        role_caps = {r for (r,) in c.execute(text(
            "SELECT capability FROM role_permissions WHERE role='manager'"))}
        grants = dict(c.execute(text(
            "SELECT capability, expires_at FROM user_permissions WHERE user_id=1")).all())
        denies = {r for (r,) in c.execute(text(
            "SELECT capability FROM user_permissions WHERE user_id=2"))}
        req = c.execute(text(
            "SELECT capability FROM permission_requests WHERE user_id=3")).scalar_one()

    # role preset: children in, parent out
    assert "books.manage" not in role_caps
    assert {"books.create", "books.edit", "books.submit", "books.templates", "books.delete"} <= role_caps
    assert "ledger.edit" in role_caps and "ledger.create" in role_caps and "ledger.delete" in role_caps

    # user grant expanded to all children, expiry preserved on each
    assert set(grants) == {"books.create", "books.edit", "books.submit", "books.templates", "books.delete"}
    assert all(v == datetime(2030, 1, 1) for v in grants.values())

    # deny expanded
    assert denies == {"permits.create", "permits.edit", "permits.revoke", "permits.delete"}

    # pending request re-pointed to primary child
    assert req == "books.edit"
    eng.dispose()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_migration_0074_expansion.py -v`
Expected: FAIL — revision `0074` doesn't exist (`Can't locate revision`).

- [ ] **Step 3: Write the migration**

Create `backend/app/db/migrations/versions/0074_split_bundled_capabilities.py`:

```python
"""Split six bundled capabilities into atomic children; preserve access exactly.

Revision ID: 0074
Revises: 0073

The catalog in core/permissions.py replaced six bundled ids with atomic
per-action children (see the expansion map below). Stored rows are expanded:

* role_permissions  — each role holding a parent gets every child (INSERT OR
  IGNORE), then parent rows are deleted. The startup reconcile in main.py only
  ever ADDS rows, so deleting here is the only way old ids leave the table.
* user_permissions  — a grant/deny on a parent becomes the same effect on every
  child (grants keep their expires_at), then parent rows are deleted. This is
  what guarantees nobody gains or loses effective access.
* permission_requests — pending requests for a parent are re-pointed to the
  parent's primary child so the approval UI keeps resolving a label.

downgrade() is a deliberate no-op: the original parent rows cannot be
reconstructed from the expanded children.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0074"
down_revision: str | Sequence[str] | None = "0073"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# parent → atomic children (mirror of the catalog split; inlined so the
# migration stays self-contained like 0018).
_EXPANSION: dict[str, tuple[str, ...]] = {
    "employees.edit": ("employees.create", "employees.edit", "employees.vault.manage"),
    "leaves.edit": ("leaves.create", "leaves.edit", "leaves.delete"),
    "violations.manage": ("violations.create", "violations.edit", "violations.delete"),
    "books.manage": ("books.create", "books.edit", "books.submit", "books.templates", "books.delete"),
    "permits.manage": ("permits.create", "permits.edit", "permits.revoke", "permits.delete"),
    "ledger.edit": ("ledger.create", "ledger.edit", "ledger.delete"),
}

# Where a pending request for a parent lands (the action the requester most
# plausibly wanted).
_PRIMARY: dict[str, str] = {
    "employees.edit": "employees.edit",
    "leaves.edit": "leaves.edit",
    "violations.manage": "violations.create",
    "books.manage": "books.edit",
    "permits.manage": "permits.edit",
    "ledger.edit": "ledger.edit",
}


def upgrade() -> None:
    conn = op.get_bind()

    for parent, children in _EXPANSION.items():
        # role_permissions: children for every role that held the parent…
        conn.execute(
            sa.text(
                "INSERT OR IGNORE INTO role_permissions (role, capability) "
                f"SELECT role, '{child}' FROM role_permissions WHERE capability = '{parent}'"
            )
            if False
            else sa.text(
                "INSERT OR IGNORE INTO role_permissions (role, capability) "
                "SELECT role, :child FROM role_permissions WHERE capability = :parent"
            ),
            {"child": None, "parent": parent},
        ) if False else None
        for child in children:
            conn.execute(
                sa.text(
                    "INSERT OR IGNORE INTO role_permissions (role, capability) "
                    "SELECT role, :child FROM role_permissions WHERE capability = :parent"
                ),
                {"child": child, "parent": parent},
            )
        # …then the parent goes away.
        conn.execute(
            sa.text("DELETE FROM role_permissions WHERE capability = :parent"),
            {"parent": parent},
        )

        # user_permissions: copy effect + expires_at to every child, drop parent.
        for child in children:
            conn.execute(
                sa.text(
                    "INSERT OR IGNORE INTO user_permissions (user_id, capability, effect, expires_at) "
                    "SELECT user_id, :child, effect, expires_at "
                    "FROM user_permissions WHERE capability = :parent"
                ),
                {"child": child, "parent": parent},
            )
        conn.execute(
            sa.text("DELETE FROM user_permissions WHERE capability = :parent"),
            {"parent": parent},
        )

        # pending requests re-point to the primary child.
        conn.execute(
            sa.text(
                "UPDATE permission_requests SET capability = :primary "
                "WHERE capability = :parent AND status = 'pending'"
            ),
            {"primary": _PRIMARY[parent], "parent": parent},
        )


def downgrade() -> None:
    # Deliberate no-op: expanded children cannot be collapsed back without
    # knowing which rows were synthesized. See module docstring.
    pass
```

**IMPORTANT:** the first `conn.execute(...)` inside the `for parent` loop above contains leftover scratch (`if False`) scaffolding — delete that whole `conn.execute(...) if False else ... if False else None` block so the loop body starts directly at `for child in children:`. The final loop body is exactly:

```python
    for parent, children in _EXPANSION.items():
        for child in children:
            conn.execute(
                sa.text(
                    "INSERT OR IGNORE INTO role_permissions (role, capability) "
                    "SELECT role, :child FROM role_permissions WHERE capability = :parent"
                ),
                {"child": child, "parent": parent},
            )
        conn.execute(
            sa.text("DELETE FROM role_permissions WHERE capability = :parent"),
            {"parent": parent},
        )
        for child in children:
            conn.execute(
                sa.text(
                    "INSERT OR IGNORE INTO user_permissions (user_id, capability, effect, expires_at) "
                    "SELECT user_id, :child, effect, expires_at "
                    "FROM user_permissions WHERE capability = :parent"
                ),
                {"child": child, "parent": parent},
            )
        conn.execute(
            sa.text("DELETE FROM user_permissions WHERE capability = :parent"),
            {"parent": parent},
        )
        conn.execute(
            sa.text(
                "UPDATE permission_requests SET capability = :primary "
                "WHERE capability = :parent AND status = 'pending'"
            ),
            {"primary": _PRIMARY[parent], "parent": parent},
        )
```

- [ ] **Step 4: Run migration test green**

Run: `python -m pytest backend/tests/test_migration_0074_expansion.py -v`
Expected: PASS (full chain 0001→0074 runs on the temp SQLite; ~seconds).

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/migrations/versions/0074_split_bundled_capabilities.py backend/tests/test_migration_0074_expansion.py
git commit -m "feat(db): migration 0074 expands bundled permission rows to atomic children"
```

---

### Task 3: Re-gate employees / leaves / violations routes

**Files:**
- Modify: `backend/app/api/v1/employees.py` (9 gates + 3 violation gates)
- Modify: `backend/app/api/v1/leaves.py` (6 gates)
- Modify: `backend/app/api/v1/org_tree.py:32`
- Create: `backend/tests/test_granular_people_gates.py`

**Interfaces:**
- Consumes: Task 1 catalog ids.
- Produces: routes gated on atomic ids only; no behavior change for anyone holding the old bundle (their role preset / migrated overrides cover the children).

- [ ] **Step 1: Write the failing gate tests**

Create `backend/tests/test_granular_people_gates.py`:

```python
"""Atomic people-domain gates: create/edit/vault/delete are independently denyable.

The pinpoint scenario: a manager with a `deny` override on one atomic child
keeps every other action. Operator (view-only) gets 403 everywhere writey.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Employee, User, UserPermission
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "test_people.db"
    eng = create_engine(
        f"sqlite:///{db_file}", future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()


def _user(db: Session, role: str, email: str) -> User:
    u = User(email=email, password_hash="x", role=role, status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _employee(db: Session, emp_id: str = "E1") -> Employee:
    e = Employee(employee_id=emp_id, name_en="Test Person", name_ar="شخص")
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


def test_operator_cannot_create_employee(api_db):
    u = _user(api_db, "operator", "op@x.ae")
    r = _client(api_db, u).post("/api/v1/employees", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "employees.create"


def test_manager_can_create_employee(api_db):
    u = _user(api_db, "manager", "mgr@x.ae")
    r = _client(api_db, u).post("/api/v1/employees", json={})
    assert r.status_code in (201, 422)  # 422 = reached validation, gate passed


def test_deny_vault_manage_blocks_vault_write_only(api_db):
    """Pinpoint: deny employees.vault.manage, everything else still works."""
    u = _user(api_db, "manager", "mgr2@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="employees.vault.manage", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    e = _employee(api_db)
    # vault write blocked
    r = c.post(f"/api/v1/employees/{e.employee_id}/vault", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "employees.vault.manage"
    # profile edit still allowed
    r2 = c.patch(f"/api/v1/employees/{e.employee_id}", json={})
    assert r2.status_code in (200, 422)


def test_violations_split_into_three_gates(api_db):
    u = _user(api_db, "manager", "mgr3@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="violations.delete", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    e = _employee(api_db)
    # create passes the gate (422 = body validation, not 403)
    r = c.post(f"/api/v1/employees/{e.employee_id}/violations", json={})
    assert r.status_code in (201, 422)


def test_leaves_delete_is_its_own_gate(api_db):
    u = _user(api_db, "operator", "op4@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="leaves.create", effect="grant"))
    api_db.commit()
    r = _client(api_db, u).post("/api/v1/leaves", json={})
    assert r.status_code in (201, 422)  # granted create passes despite operator role
```

Note: adapt `Employee(...)` kwargs to the actual model minimum required (check `app/db/models.py::Employee` — likely `employee_id`, `name_en`; drop `name_ar` if not nullable-constrained differently). If the model requires more fields, add them; the gate assertions (403 vs 201/422) are what matter.

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest backend/tests/test_granular_people_gates.py -v`
Expected: FAIL — operator POST `/employees` currently passes the old `employees.edit` gate? No: operator lacks `employees.edit` too, so that one 403s with the OLD capability name — `test_operator_cannot_create_employee` fails on `capability == "employees.create"`. The deny/deny-split tests fail because old ids don't exist in `CAPABILITY_IDS` (set_user_override raises UNKNOWN_CAPABILITY → fixture error).

- [ ] **Step 3: Apply the re-gates**

In `employees.py` replace per the map (9 `employees.edit` gates + 3 violation gates), `leaves.py` (6 gates), `org_tree.py:32` stays `employees.edit` (org-tree node creation is profile-structure editing). Mechanical replacements, e.g.:

```python
# employees.py:125 (POST "")
_user: Annotated[User, Depends(require_capability("employees.create"))],
# employees.py:309,337 (vault)
_user: Annotated[User, Depends(require_capability("employees.vault.manage"))],
# employees.py:268 (POST violation)
_user: Annotated[User, Depends(require_capability("violations.create"))],
# employees.py:279 (PATCH violation)
_user: Annotated[User, Depends(require_capability("violations.edit"))],
# employees.py:288 (DELETE violation)
_user: Annotated[User, Depends(require_capability("violations.delete"))],
# leaves.py:104
_user: Annotated[User, Depends(require_capability("leaves.create"))],
# leaves.py:209 (DELETE)
_user: Annotated[User, Depends(require_capability("leaves.delete"))],
```

All remaining `leaves.edit` gates (PATCH/amend/certificate/return) keep the literal `"leaves.edit"` — the id survives, only its meaning narrowed.

- [ ] **Step 4: Run people-gate tests + full employees/leaves suites**

Run: `python -m pytest backend/tests/test_granular_people_gates.py backend/tests/test_passport_extract_endpoint.py backend/tests/test_passport_upload_hook.py backend/tests/test_workforce_api_permissions.py -v`
Expected: PASS (passport tests already resolve managers, who hold the atomic children).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/employees.py backend/app/api/v1/leaves.py backend/app/api/v1/org_tree.py backend/tests/test_granular_people_gates.py
git commit -m "feat(api): gate employees/vault/leaves/violations on atomic capabilities"
```

---

### Task 4: Re-gate books routes + service references

**Files:**
- Modify: `backend/app/api/v1/books.py` (28 gates)
- Modify: `backend/app/api/v1/notify.py:76`
- Modify: `backend/app/api/v1/recipients.py:34,44`
- Modify: `backend/app/services/notification_service.py:139` (+ comments :84,:137)
- Create: `backend/tests/test_granular_books_gates.py`

**Interfaces:**
- Consumes: Task 1 ids (`books.create/edit/submit/templates/delete`).
- Produces: books write surface split; scan-back filing + attachments + reviewers + signed-copy under `books.edit`; word-template CRUD under `books.templates`.

- [ ] **Step 1: Write the failing gate tests**

Create `backend/tests/test_granular_books_gates.py` (same fixture pattern as Task 3 — copy the `api_db`/`_user`/`_client` helpers verbatim, import path unchanged):

```python
def test_books_gate_split(api_db):
    """Manager with books.delete denied: PATCH ok, DELETE 403, submit ok."""
    u = _user(api_db, "manager", "bk@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="books.delete", effect="deny"))
    api_db.commit()
    c = _client(api_db, u)
    # create passes (422 = validation reached)
    assert c.post("/api/v1/books", json={}).status_code in (201, 422)
    # submit gate is books.submit (manager default) — 404/422 acceptable, NOT 403-with-books.manage
    r = c.post("/api/v1/books/999999/submit")
    assert r.status_code in (404, 422)


def test_operator_cannot_create_book(api_db):
    u = _user(api_db, "operator", "opbk@x.ae")
    r = _client(api_db, u).post("/api/v1/books", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "books.create"


def test_word_templates_need_templates_cap(api_db):
    u = _user(api_db, "manager", "tpl@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="books.templates", effect="deny"))
    api_db.commit()
    r = _client(api_db, u).get("/api/v1/books/word-templates")
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "books.templates"


def test_scanback_filing_needs_books_edit(api_db):
    """Operator + grant books.edit can reach the scan-back list (was books.manage)."""
    u = _user(api_db, "operator", "sb@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="books.edit", effect="grant"))
    api_db.commit()
    r = _client(api_db, u).get("/api/v1/books/awaiting-scan")
    assert r.status_code == 200
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest backend/tests/test_granular_books_gates.py -v`
Expected: FAIL — `books.create`/`books.templates` unknown; awaiting-scan 403s for operator+grant (still `books.manage`).

- [ ] **Step 3: Apply re-gates per the map**

Apply all `books.py` replacements from the route map (word-template block + save-as-template → `books.templates`; word-sessions/awaiting-scan/approvers/reviewer-candidates/fields/PATCH/reviewers/attachments/signed-copy → `books.edit`; POST `/books` → `books.create`; DELETE book → `books.delete`; submit → `books.submit`). Then:

```python
# notify.py:76
_user: Annotated[User, Depends(require_capability("books.edit"))],
# recipients.py:34,44
_user: Annotated[User, Depends(require_capability("books.edit"))],
# notification_service.py:139
if perm_service.has_capability(db, user, "books.edit"):
# notification_service.py:84 comment → "...its books.edit gate..."
# notification_service.py:137 comment → "...same books.edit gate as the bell count..."
```

Also update stale docstrings that name `books.manage` inside `books.py` (lines ~332, ~518, ~522, ~753, ~1025): replace the literal with the new gate name each handler now uses.

- [ ] **Step 4: Run books-related suites**

Run: `python -m pytest backend/tests/test_granular_books_gates.py backend/tests/test_word_book_routes.py backend/tests/test_book_template_routes_m4.py backend/tests/test_scanback_api.py backend/tests/test_notify_api.py backend/tests/test_books_view_gate.py backend/tests/test_books_state_override.py backend/tests/test_permissions_messages_broadcast.py -v`
Expected: PASS. If a test asserts the literal old gate name in an error `details`, update the assertion to the new atomic id (that is a legitimate expectation change, not a behavior change).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/books.py backend/app/api/v1/notify.py backend/app/api/v1/recipients.py backend/app/services/notification_service.py backend/tests/test_granular_books_gates.py
git commit -m "feat(api): split books.manage into create/edit/submit/templates/delete gates"
```

---

### Task 5: Re-gate permits + ledger + smart-folders routes

**Files:**
- Modify: `backend/app/api/v1/permits.py` (18 gates)
- Modify: `backend/app/api/v1/ledger.py` (19 gates)
- Modify: `backend/app/api/v1/smart_folders.py` (4 gates)
- Create: `backend/tests/test_granular_permits_ledger_gates.py`

**Interfaces:**
- Consumes: Task 1 ids.
- Produces: `permits.{create,edit,revoke,delete}`; `ledger.{create,edit,delete}`; smart-folders ride the ledger ids.

- [ ] **Step 1: Write the failing gate tests**

Create `backend/tests/test_granular_permits_ledger_gates.py` (fixture helpers as Task 3):

```python
def test_permit_revoke_is_its_own_gate(api_db):
    u = _user(api_db, "manager", "pv@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="permits.revoke", effect="deny"))
    api_db.commit()
    r = _client(api_db, u).post("/api/v1/permits/999999/revoke")
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "permits.revoke"


def test_permit_create_gate(api_db):
    u = _user(api_db, "operator", "pc@x.ae")
    r = _client(api_db, u).post("/api/v1/permits", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "permits.create"


def test_ledger_delete_is_its_own_gate(api_db):
    u = _user(api_db, "operator", "ld@x.ae")
    api_db.add(UserPermission(user_id=u.id, capability="ledger.create", effect="grant"))
    api_db.commit()
    # create passes for the operator now…
    r = _client(api_db, u).post("/api/v1/ledger/entries", json={})
    assert r.status_code in (201, 422)
    # …but delete stays closed (operator has no ledger.delete).
    r2 = _client(api_db, u).delete("/api/v1/ledger/entries/999999")
    assert r2.status_code == 403
    assert r2.json()["error"]["details"]["capability"] == "ledger.delete"


def test_smart_folder_create_uses_ledger_create(api_db):
    u = _user(api_db, "operator", "sf@x.ae")
    r = _client(api_db, u).post("/api/v1/smart-folders", json={})
    assert r.status_code == 403
    assert r.json()["error"]["details"]["capability"] == "ledger.create"
```

(Adjust the smart-folders URL prefix to the router's actual mount point — check `main.py` include_router for `smart_folders`; the assertion pattern stays.)

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest backend/tests/test_granular_permits_ledger_gates.py -v`
Expected: FAIL — old ids in error details / unknown capabilities.

- [ ] **Step 3: Apply re-gates per the map**

`permits.py`: POST `/permits` → `permits.create`; scan helpers/PATCH/renew/submit-approval/people/vehicles/documents/visits → `permits.edit`; revoke → `permits.revoke`; DELETE → `permits.delete`.
`ledger.py`: contacts POST + recipient-lists POST + drafts POST + entries POST → `ledger.create`; PATCH/flag/star/attachments → keep literal `ledger.edit`; all four DELETEs → `ledger.delete`.
`smart_folders.py`: POST `""` → `ledger.create`; dismiss/PATCH/DELETE → `ledger.edit`.

- [ ] **Step 4: Run permits + ledger suites**

Run: `python -m pytest backend/tests/test_granular_permits_ledger_gates.py backend/tests/ -k "permit or ledger or smart" -v`
Expected: PASS (update any assertion that hardcoded the old capability name in `details`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/permits.py backend/app/api/v1/ledger.py backend/app/api/v1/smart_folders.py backend/tests/test_granular_permits_ledger_gates.py
git commit -m "feat(api): split permits.manage and ledger.edit into atomic gates"
```

---

### Task 6: Bulk override endpoint

**Files:**
- Modify: `backend/app/schemas/auth.py` (add `SetPermissionBulkRequest`)
- Modify: `backend/app/services/perm_service.py` (add `set_user_overrides`)
- Modify: `backend/app/api/v1/auth.py` (add `PUT /users/{user_id}/permissions/bulk`)
- Create: `backend/tests/test_permissions_bulk_api.py`

**Interfaces:**
- Consumes: `perm_service.set_user_override` validation rules (sensitive caps, self-target).
- Produces: `SetPermissionBulkRequest{items: list[SetPermissionRequest]}`; `perm_service.set_user_overrides(db, user_id, items, *, actor) -> None` (all-or-nothing, one commit); route `PUT /api/v1/auth/users/{user_id}/permissions/bulk` returning `UserPermissionRead`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_permissions_bulk_api.py` (fixture helpers as Task 3):

```python
def test_bulk_set_and_clear_overrides(api_db):
    admin = _user(api_db, "admin", "ad@x.ae")
    target = _user(api_db, "manager", "tgt@x.ae")
    c = _client(api_db, admin)
    r = c.put(f"/api/v1/auth/users/{target.id}/permissions/bulk", json={
        "items": [
            {"capability": "books.delete", "effect": "deny"},
            {"capability": "books.override_state", "effect": "grant"},
            {"capability": "permits.revoke", "effect": None},
        ]
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["overrides"]["books.delete"] == "deny"
    assert data["overrides"]["books.override_state"] == "grant"
    assert "permits.revoke" not in data["overrides"]


def test_bulk_is_all_or_nothing(api_db):
    admin = _user(api_db, "admin", "ad2@x.ae")
    target = _user(api_db, "manager", "tgt2@x.ae")
    c = _client(api_db, admin)
    r = c.put(f"/api/v1/auth/users/{target.id}/permissions/bulk", json={
        "items": [
            {"capability": "books.delete", "effect": "deny"},
            {"capability": "not.a.cap", "effect": "grant"},  # invalid → whole batch refused
        ]
    })
    assert r.status_code == 400
    # nothing applied
    assert perm_service.get_user_overrides(api_db, target.id) == {}


def test_bulk_cannot_grant_sensitive(api_db):
    admin = _user(api_db, "admin", "ad3@x.ae")
    target = _user(api_db, "manager", "tgt3@x.ae")
    r = _client(api_db, admin).put(
        f"/api/v1/auth/users/{target.id}/permissions/bulk",
        json={"items": [{"capability": "users.manage", "effect": "grant"}]},
    )
    assert r.status_code == 400
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest backend/tests/test_permissions_bulk_api.py -v`
Expected: FAIL — 404 route not found.

- [ ] **Step 3: Implement schema + service + route**

`backend/app/schemas/auth.py` — add after `SetPermissionRequest`:

```python
class SetPermissionBulkRequest(BaseModel):
    """Apply several override changes in one all-or-nothing call."""

    items: list[SetPermissionRequest] = Field(min_length=1, max_length=200)
```

Add `"SetPermissionBulkRequest"` to `__all__`.

`backend/app/services/perm_service.py` — add after `set_user_override`:

```python
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
        raise AppError("FORBIDDEN_OVERRIDE", "You cannot change your own permissions.", http_status=400)
    for capability, effect, _expires in items:
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
    for capability, effect, expires_at in items:
        existing = db.get(UserPermission, (user_id, capability))
        if effect is None:
            if existing is not None:
                db.delete(existing)
        elif existing is None:
            db.add(UserPermission(user_id=user_id, capability=capability, effect=effect, expires_at=expires_at))
        else:
            existing.effect = effect
            existing.expires_at = expires_at
    db.commit()
    _invalidate_caps_cache(db, user_id)
```

Add `"set_user_overrides"` to `__all__`.

`backend/app/api/v1/auth.py` — import `SetPermissionBulkRequest`, add after `set_user_permission`:

```python
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
        role_defaults=sorted(perm_service.role_default_caps(db, user.role)),
        overrides=perm_service.get_user_overrides(db, user.id),
    )
```

**Route order matters:** FastAPI matches in declaration order — `/users/{user_id}/permissions/bulk` must be declared BEFORE any conflicting route; it isn't (`/users/{user_id}/permissions` is a distinct literal path), so placement after `set_user_permission` is safe.

- [ ] **Step 4: Run bulk tests + permissions API suite**

Run: `python -m pytest backend/tests/test_permissions_bulk_api.py backend/tests/test_permissions_api.py backend/tests/test_set_permission_expiry_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/auth.py backend/app/services/perm_service.py backend/app/api/v1/auth.py backend/tests/test_permissions_bulk_api.py
git commit -m "feat(api): all-or-nothing bulk permission override endpoint"
```

---

### Task 7: Frontend — atomic gates + API client

**Files:**
- Modify: `frontend/src/lib/api.ts:1945-1960` (add bulk method)
- Modify (gates, exact lines): `frontend/src/App.tsx:248`, `frontend/src/pages/scanBack/ScanBackPage.tsx:67`, `frontend/src/pages/scanBack/useScanBack.ts:69`, `frontend/src/pages/books/BooksPage.tsx:67`, `frontend/src/pages/books/BookRecordPage.tsx:267-276`, `frontend/src/pages/books/RecordPane.tsx:69`, `frontend/src/components/books/BookPreview.tsx:37`, `frontend/src/components/books/BookDetailDrawer.tsx:213-217`, `frontend/src/components/books/SavedRecordActions.tsx:47`, `frontend/src/components/books/SubmitForApprovalDialog.tsx:42`, `frontend/src/pages/employees/tabs/ViolationsTab.tsx:256`, `frontend/src/pages/employees/tabs/MessagesTab.tsx:29`, `frontend/src/pages/permits/PermitsPage.tsx:56`, `frontend/src/pages/permits/PermitDetailDialog.tsx:65`, `frontend/src/pages/permits/PermitDocumentVersions.tsx:32`, `frontend/src/components/application/fields/RecipientPickerField.tsx:218`, `frontend/src/components/application/fields/MultiRecipientPickerField.tsx:247`
- Modify: `frontend/src/components/perms/CapabilityGate.test.tsx:77,106`
- Create: `frontend/src/lib/permissions.test.ts`

**Interfaces:**
- Consumes: backend atomic ids (Tasks 3–5).
- Produces: `api.setUserPermissionsBulk(id: number, items: Array<{ capability: string; effect: PermissionEffect | null }>): Promise<UserPermissionRead>`; components read atomic caps via existing `useCapabilities().has()`.

- [ ] **Step 1: Write the failing client test**

Create `frontend/src/lib/permissions.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { api } from './api'

describe('api.setUserPermissionsBulk', () => {
  it('PUTs the items array to the bulk endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user_id: 7, role: 'manager', is_admin: false,
      effective: [], role_defaults: [], overrides: {},
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api.setUserPermissionsBulk(7, [
      { capability: 'books.delete', effect: 'deny' },
      { capability: 'permits.revoke', effect: null },
    ])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/auth/users/7/permissions/bulk')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({
      items: [
        { capability: 'books.delete', effect: 'deny' },
        { capability: 'permits.revoke', effect: null },
      ],
    })
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/permissions.test.ts`
Expected: FAIL — `setUserPermissionsBulk` is not a function.

- [ ] **Step 3: Add the client method**

In `frontend/src/lib/api.ts` after `setUserPermission` (~line 1951):

```typescript
  setUserPermissionsBulk: (
    id: number,
    items: Array<{ capability: string; effect: PermissionEffect | null }>,
  ) => request<UserPermissionRead>('PUT', `/auth/users/${id}/permissions/bulk`, { items }),
```

- [ ] **Step 4: Run client test green**

Run: `cd frontend && npx vitest run src/lib/permissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Migrate the gates (mechanical, exact)**

| File:line | Old | New |
| --- | --- | --- |
| `App.tsx:248` | `cap="books.manage"` (scan-back route) | `cap="books.edit"` |
| `ScanBackPage.tsx:67` | `has('books.manage')` | `has('books.edit')` |
| `useScanBack.ts:69` | `has('books.manage')` | `has('books.edit')` |
| `RecordPane.tsx:69` | `has('books.manage')` | `has('books.edit')` |
| `BookPreview.tsx:37` | `has('books.manage')` | `has('books.edit')` |
| `BookDetailDrawer.tsx:214` | `has('books.manage')` | `has('books.edit')` |
| `MessagesTab.tsx:29` | `caps.has('books.manage')` | `caps.has('books.edit')` |
| `PermitDocumentVersions.tsx:32` | `has('books.manage')` | `has('books.edit')` |
| `RecipientPickerField.tsx:218` | `cap="books.manage"` | `cap="books.edit"` |
| `MultiRecipientPickerField.tsx:247` | `cap="books.manage"` | `cap="books.edit"` |
| `SavedRecordActions.tsx:47` | `has('books.manage')` inside `canSendForApproval` | `has('books.submit')` |
| `SubmitForApprovalDialog.tsx:42` | `has('books.manage')` | `has('books.submit')` |
| `BooksPage.tsx:67` | single `canManage` | `const canCreate = has('books.create')` (new-record button) + `const canEdit = has('books.edit')` (edit affordances); replace `canManage` uses accordingly |
| `BookRecordPage.tsx:268` | single `canManage` | `const canEdit = has('books.edit')`, `const canDelete = has('books.delete')`, `canSubmit` already exists as approve? no — add `const canSubmitBook = has('books.submit')`; wire edit pane→canEdit, delete button→canDelete, submit dialog open→canSubmitBook |
| `ViolationsTab.tsx:256` | single `canManage` | `const canCreate = has('violations.create')`, `const canEdit = has('violations.edit')`, `const canDelete = has('violations.delete')`; add-button→canCreate, row edit→canEdit, row delete→canDelete |
| `PermitsPage.tsx:56` | single `canManage` | `const canCreate = has('permits.create')`, `const canEdit = has('permits.edit')`, `const canRevoke = has('permits.revoke')`, `const canDelete = has('permits.delete')`; wire new-permit→canCreate, row actions→matching flag |
| `PermitDetailDialog.tsx:65` | single `canManage` | same four flags as PermitsPage; amendment form→canEdit, revoke button→canRevoke, delete→canDelete |
| `CapabilityGate.test.tsx:77,106` | `cap="books.manage"` | `cap="books.edit"` |

`employees.edit` gates (`OrgTreeView.tsx:57`, `ProfileTab.tsx:356`, `EmployeeIdCard.tsx:60`, `TemplateForm.tsx:463`) keep the literal — the id survives with narrowed meaning.

- [ ] **Step 6: Typecheck + full frontend test suite**

Run: `cd frontend && npm run typecheck && npx vitest run`
Expected: PASS (fix any snapshot/test asserting `books.manage` by switching to the atomic id).

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "feat(frontend): read atomic capability ids; add bulk override client method"
```

---

### Task 8: Permissions sheet — search + per-domain bulk

**Files:**
- Modify: `frontend/src/components/access/UserPermissionsSheet.tsx` (rewrite)
- Modify: `frontend/src/components/access/UserPermissionsSheet.test.tsx`

**Interfaces:**
- Consumes: `api.listCapabilities`, `api.getUserPermissions`, `api.setUserPermission`, `api.setUserPermissionsBulk`; i18n keys `access.permissions.*`, `perms.caps.*`.
- Produces: same export `UserPermissionsSheet({ user, onClose })`; new i18n keys `access.permissions.searchPlaceholder`, `access.permissions.results`, `access.permissions.noResults`, `access.permissions.noResultsHint`, `access.permissions.clearSearch`, `access.permissions.bulkApply`, `access.permissions.savedBulk`.

- [ ] **Step 1: Write the failing component tests**

Add to `frontend/src/components/access/UserPermissionsSheet.test.tsx` (keep existing cases, adjust any that assert the old catalog):

```typescript
describe('UserPermissionsSheet — search + bulk', () => {
  it('filters capabilities by translated label, raw id, and English catalog label', async () => {
    renderSheet({ caps: [cap('books.view'), cap('books.edit'), cap('leaves.view')] })
    const input = await screen.findByPlaceholderText('Search permissions…')
    await userEvent.type(input, 'books')
    expect(screen.getByText('books.view')).toBeVisible()      // raw id match
    expect(screen.queryByText('leaves.view')).toBeNull()
  })

  it('shows an empty state with a clear button when nothing matches', async () => {
    renderSheet({ caps: [cap('books.view')] })
    const input = await screen.findByPlaceholderText('Search permissions…')
    await userEvent.type(input, 'zzzz-nothing')
    expect(await screen.findByText('No permissions match')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(screen.getByText('books.view')).toBeVisible()
  })

  it('applies a domain-wide deny through the bulk endpoint in one call', async () => {
    const bulk = vi.spyOn(api, 'setUserPermissionsBulk').mockResolvedValue({...permsFixture()})
    renderSheet({ caps: [cap('books.view'), cap('books.edit')] })
    const denyButtons = await screen.findAllByRole('button', { name: 'Deny' })
    await userEvent.click(denyButtons[0])   // first = domain header control
    await waitFor(() => expect(bulk).toHaveBeenCalledWith(
      expect.any(Number),
      expect.arrayContaining([
        { capability: 'books.view', effect: 'deny' },
        { capability: 'books.edit', effect: 'deny' },
      ]),
    ))
  })
})
```

(`renderSheet`/`cap`/`permsFixture` = the file's existing helpers; extend `permsFixture` with the caps passed in.)

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/access/UserPermissionsSheet.test.tsx`
Expected: FAIL — no search placeholder / bulk spy never called.

- [ ] **Step 3: Rewrite the sheet**

Replace `UserPermissionsSheet.tsx` body with (keep the file's header doc comment, update it to mention search/bulk):

```tsx
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, Search, ShieldCheck, X } from 'lucide-react'

import {
  api,
  type AdminUserRead,
  type CapabilityRead,
  type PermissionEffect,
  type UserPermissionRead,
} from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

type Effect = PermissionEffect | 'default'

function userLabel(u: AdminUserRead): string {
  return (u.display_name || u.name_en || u.email.split('@')[0]) ?? u.email
}

function roleChipClass(role: 'operator' | 'manager' | 'admin'): string {
  return role === 'admin'
    ? 'bg-accent-soft text-accent'
    : role === 'manager'
      ? 'bg-info-soft text-info'
      : 'bg-surface-tinted text-muted-foreground'
}

function EffectToggle({
  value, disabled, onChange, size = 'row',
}: {
  value: Effect
  disabled: boolean
  onChange: (next: Effect) => void
  size?: 'row' | 'header'
}): React.JSX.Element {
  const { t } = useTranslation()
  const options: { id: Effect; label: string; active: string }[] = [
    { id: 'default', label: t('access.permissions.state.default'), active: 'bg-surface-tinted text-foreground' },
    { id: 'grant', label: t('access.permissions.state.grant'), active: 'bg-success-soft text-success' },
    { id: 'deny', label: t('access.permissions.state.deny'), active: 'bg-accent-soft text-accent' },
  ]
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border" role="group">
      {options.map((opt) => {
        const selected = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(opt.id)}
            className={cn(
              size === 'header' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
              'font-medium transition-colors border-e border-border last:border-e-0',
              selected ? opt.active : 'bg-surface text-muted-foreground hover:bg-surface-tinted',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function DomainGroup({
  domain, caps, perms, isAdmin, onSet, onBulk, saving, query,
}: {
  domain: string
  caps: CapabilityRead[]
  perms: UserPermissionRead
  isAdmin: boolean
  onSet: (capability: string, effect: Effect) => void
  onBulk: (caps: CapabilityRead[], effect: Effect) => void
  saving: string | null
  query: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const roleDefaults = new Set(perms.role_defaults)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return caps
    return caps.filter((c) => {
      const localized = t(`access.permissions.caps.${c.id}`, { defaultValue: '' }).toLowerCase()
      const localizedDesc = t(`perms.caps.${c.id}.desc`, { defaultValue: '' }).toLowerCase()
      return (
        c.id.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        localized.includes(q) ||
        localizedDesc.includes(q)
      )
    })
  }, [caps, query, t])

  if (query && visible.length === 0) return <></>

  const effects = caps.map((c) => (perms.overrides[c.id] ?? 'default') as Effect)
  const uniform = effects.every((e) => e === effects[0]) ? effects[0] : null

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex flex-1 items-center justify-between gap-2 text-start"
            aria-expanded={open}
          >
            <CardTitle className="text-base">
              {t(`access.permissions.domains.${domain}`, domain)}
              <span className="ms-2 rounded border border-border px-1.5 font-mono text-[0.7em] text-muted-foreground">
                {visible.length}
              </span>
            </CardTitle>
            <ChevronDown
              className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')}
              strokeWidth={1.7}
            />
          </button>
          {!isAdmin && (
            <EffectToggle
              size="header"
              value={uniform ?? 'default'}
              disabled={saving === `domain:${domain}`}
              onChange={(next) => onBulk(caps, next)}
            />
          )}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="divide-y divide-border/60 p-0">
          {visible.map((cap) => {
            const isDefault = roleDefaults.has(cap.id)
            const override = perms.overrides[cap.id]
            const value: Effect = override ?? 'default'
            const description = t(`perms.caps.${cap.id}.desc`, { defaultValue: cap.description })
            return (
              <div key={cap.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium text-foreground">
                    {t(`access.permissions.caps.${cap.id}`, { defaultValue: cap.label })}
                  </span>
                  {description && (
                    <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
                  )}
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono text-[0.8em] text-muted-foreground/60" dir="ltr">{cap.id}</span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-1.5 py-px text-[0.65em] font-semibold uppercase tracking-[0.06em]',
                        isDefault ? 'bg-success-soft text-success' : 'bg-surface-tinted text-muted-foreground',
                      )}
                    >
                      {t('access.permissions.inherited', {
                        state: isDefault ? t('access.permissions.state.grant') : t('access.permissions.state.deny'),
                      })}
                    </span>
                    {override && !isAdmin && (
                      <span className="inline-flex items-center rounded bg-warning-soft px-1.5 py-px text-[0.65em] font-semibold uppercase tracking-[0.06em] text-warning">
                        {t('access.permissions.overridden')}
                      </span>
                    )}
                  </span>
                </div>
                <div className="shrink-0 sm:pt-0.5">
                  <EffectToggle
                    value={isAdmin ? 'grant' : value}
                    disabled={isAdmin || saving === cap.id}
                    onChange={(next) => onSet(cap.id, next)}
                  />
                </div>
              </div>
            )
          })}
        </CardContent>
      )}
    </Card>
  )
}

export function UserPermissionsSheet({
  user,
  onClose,
}: {
  user: AdminUserRead
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')

  const capsQuery = useQuery({ queryKey: ['capabilities'], queryFn: () => api.listCapabilities() })
  const permsQuery = useQuery({
    queryKey: ['user-permissions', user.id],
    queryFn: () => api.getUserPermissions(user.id),
  })

  const [saving, setSaving] = useState<string | null>(null)
  const setMutation = useMutation({
    mutationFn: ({ capability, effect }: { capability: string; effect: PermissionEffect | null }) =>
      api.setUserPermission(user.id, capability, effect),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-permissions', user.id], data)
      toast.success(t('access.permissions.saved'))
    },
    onError: () => toast.error(t('access.permissions.saveError')),
    onSettled: () => setSaving(null),
  })
  const bulkMutation = useMutation({
    mutationFn: ({ items }: { items: Array<{ capability: string; effect: PermissionEffect | null }> }) =>
      api.setUserPermissionsBulk(user.id, items),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-permissions', user.id], data)
      toast.success(t('access.permissions.savedBulk'))
    },
    onError: () => toast.error(t('access.permissions.saveError')),
    onSettled: () => setSaving(null),
  })

  function handleSet(capability: string, effect: Effect): void {
    setSaving(capability)
    setMutation.mutate({ capability, effect: effect === 'default' ? null : effect })
  }

  function handleBulk(caps: CapabilityRead[], effect: Effect): void {
    setSaving(`domain:${caps[0]?.domain}`)
    bulkMutation.mutate({
      items: caps.map((c) => ({ capability: c.id, effect: effect === 'default' ? null : effect })),
    })
  }

  const grouped = useMemo(() => {
    const caps = capsQuery.data ?? []
    const order: string[] = []
    const byDomain: Record<string, CapabilityRead[]> = {}
    for (const c of caps) {
      if (!byDomain[c.domain]) {
        byDomain[c.domain] = []
        order.push(c.domain)
      }
      byDomain[c.domain]!.push(c)
    }
    return order.map((d) => ({ domain: d, caps: byDomain[d]! }))
  }, [capsQuery.data])

  const perms = permsQuery.data
  const totalCaps = capsQuery.data?.length ?? 0
  const visibleCount = query
    ? grouped.reduce(
        (n, g) =>
          n +
          g.caps.filter((c) => {
            const q = query.trim().toLowerCase()
            return (
              c.id.toLowerCase().includes(q) ||
              c.label.toLowerCase().includes(q) ||
              c.description.toLowerCase().includes(q) ||
              t(`access.permissions.caps.${c.id}`, { defaultValue: '' }).toLowerCase().includes(q)
            )
          }).length,
        0,
      )
    : totalCaps

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent className="w-full max-w-2xl">
        <SheetTitle className="sr-only">
          {t('access.permissions.title')} — {userLabel(user)}
        </SheetTitle>

        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0 space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t('access.permissions.sheetEyebrow')}
            </span>
            <p className="truncate text-base font-semibold text-foreground" dir="auto">
              {userLabel(user)}
            </p>
            <p className="text-sm text-muted-foreground">{t('access.permissions.sheetSubtitle')}</p>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[0.7em] font-semibold uppercase tracking-[0.06em]',
                roleChipClass(user.role),
              )}
            >
              {t(`access.roleName.${user.role}`)}
            </span>
          </div>
          <SheetClose
            className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <ChevronDown className="h-5 w-5 -rotate-90 rtl:rotate-90" strokeWidth={1.8} aria-hidden />
          </SheetClose>
        </div>

        {/* Search — sticky under the header */}
        <div className="border-b border-border bg-background px-6 py-3">
          <div className="flex min-h-10 items-center gap-2.5 rounded-lg border border-border bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('access.permissions.searchPlaceholder')}
              aria-label={t('access.permissions.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="flex items-center gap-1 rounded p-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {t('access.permissions.clearSearch')}
              </button>
            )}
          </div>
          {query && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('access.permissions.results', { count: visibleCount })}
            </p>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {capsQuery.isError ? (
            <EmptyState message={t('access.permissions.loadError')} />
          ) : (
            <>
              {perms?.is_admin && (
                <div className="flex items-center gap-2.5 rounded-lg border border-border bg-accent-soft/40 px-4 py-3 text-sm text-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
                  {t('access.permissions.adminAll')}
                </div>
              )}
              {permsQuery.isLoading || capsQuery.isLoading || !perms ? (
                <div className="space-y-4">
                  <Skeleton className="h-40 w-full" />
                  <Skeleton className="h-40 w-full" />
                </div>
              ) : visibleCount === 0 && query ? (
                <EmptyState
                  message={t('access.permissions.noResults')}
                  action={{
                    label: t('access.permissions.clearSearch'),
                    onClick: () => setQuery(''),
                  }}
                />
              ) : (
                grouped.map(({ domain, caps }) => (
                  <DomainGroup
                    key={domain}
                    domain={domain}
                    caps={caps}
                    perms={perms}
                    isAdmin={perms.is_admin}
                    onSet={handleSet}
                    onBulk={handleBulk}
                    saving={saving}
                    query={query}
                  />
                ))
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default UserPermissionsSheet
```

If `EmptyState` lacks an `action` prop (check `components/ui/empty-state.tsx`), render a plain `<button>` under the message instead of the `action` prop — do not modify EmptyState's API.

- [ ] **Step 4: Run sheet tests**

Run: `cd frontend && npx vitest run src/components/access/UserPermissionsSheet.test.tsx`
Expected: PASS (old tests + 3 new). Update fixtures to atomic caps if any used old ids.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/access/UserPermissionsSheet.tsx frontend/src/components/access/UserPermissionsSheet.test.tsx
git commit -m "feat(access): search + per-domain bulk actions in the permissions sheet"
```

---

### Task 9: i18n completion — labels, descriptions, domains, request dialog

**Files:**
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Modify: `frontend/src/components/shell/CapabilityGate.tsx:79-81`
- Modify: `frontend/src/components/access/PermissionRequestsTab.tsx:107`
- Create: `frontend/src/locales/permissions.i18n.test.ts`

**Interfaces:**
- Consumes: Task 1 catalog ids.
- Produces: `access.permissions.domains.{...16 domains}`, `access.permissions.caps.{all 50 ids}`, `perms.caps.<id>.desc` for all 50 ids in BOTH locales; localized lock/dialog/request-tab labels.

- [ ] **Step 1: Write the failing completeness test**

Create `frontend/src/locales/permissions.i18n.test.ts`:

```typescript
/** Cross-stack guard: every capability in the PYTHON catalog must have an EN+AR
 * label, description, and domain key. Parses core/permissions.py so a new cap
 * without translations fails CI here, not in front of an Arabic-speaking admin. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import ar from './ar.json'
import en from './en.json'

type Rec = Record<string, unknown>
function get(o: Rec, path: string): unknown {
  return path.split('.').reduce<unknown>((c, k) => (c as Rec)?.[k], o)
}

const CATALOG_SRC = readFileSync(
  resolve(__dirname, '../../../backend/app/core/permissions.py'),
  'utf-8',
)
const IDS = [...CATALOG_SRC.matchAll(/Capability\(\s*"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1])

describe('permission catalog i18n completeness', () => {
  it('found the catalog', () => {
    expect(IDS.length).toBeGreaterThanOrEqual(50)
  })

  it.each(IDS)('%s has en + ar label, description, and its domain is named', (id) => {
    for (const [locale, tree] of [['en', en], ['ar', ar]] as const) {
      expect(get(tree as Rec, `access.permissions.caps.${id}`), `${locale} label ${id}`).toBeTruthy()
      expect(get(tree as Rec, `perms.caps.${id}.desc`), `${locale} desc ${id}`).toBeTruthy()
    }
    const domain = id.split('.')[0]
    expect(get(en as Rec, `access.permissions.domains.${domain}`), `en domain ${domain}`).toBeTruthy()
    expect(get(ar as Rec, `access.permissions.domains.${domain}`), `ar domain ${domain}`).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/locales/permissions.i18n.test.ts`
Expected: FAIL — dozens of missing keys (workforce/permits/messages labels, all `perms.caps.*.desc`).

- [ ] **Step 3: Fill both locale files**

In **`en.json`**: inside `access.permissions.domains` add `"permits": "Permits", "messages": "Messages", "workforce": "Workforce"`. Inside `access.permissions.caps` add the missing labels and the new atomic ones; and replace `"perms": { ... "caps": {} }` with full descriptions. Exact additions (merge with existing keys — do not duplicate existing entries; existing `access.permissions.caps` entries for surviving ids stay as-is):

```json
"caps": {
  "employees.create": "Create employees",
  "employees.vault.manage": "Manage document vaults",
  "leaves.create": "Create leaves",
  "leaves.delete": "Delete leaves",
  "violations.create": "Create violations",
  "violations.edit": "Edit violations",
  "violations.delete": "Delete violations",
  "books.create": "Create records",
  "books.edit": "Edit records & attachments",
  "books.submit": "Submit for approval",
  "books.templates": "Manage Word templates",
  "books.delete": "Delete records",
  "permits.view": "View security permits",
  "permits.create": "Issue permits",
  "permits.edit": "Amend & renew permits",
  "permits.revoke": "Revoke permits",
  "permits.delete": "Delete permits",
  "ledger.create": "Create entries & drafts",
  "ledger.delete": "Delete entries & drafts",
  "messages.broadcast": "Send group announcements",
  "workforce.self.view": "View own workforce record",
  "workforce.dashboard.view": "View workforce dashboard",
  "workforce.people.view": "View workforce people",
  "workforce.schedule.manage": "Manage workforce schedules",
  "workforce.policy.manage": "Manage workforce policies",
  "workforce.attendance.review": "Review workforce attendance",
  "workforce.attendance.correct": "Correct workforce attendance",
  "workforce.integration.manage": "Manage workforce integration"
}
```

And `perms.caps` descriptions (EN — one entry per catalog id, matching the Python descriptions verbatim):

```json
"caps": {
  "app.access": { "desc": "Sign in and see the dashboard, document fields, and read-only chrome." },
  "employees.view": { "desc": "See the employee directory and individual employee records." },
  "employees.create": { "desc": "Add new employees to the directory." },
  "employees.edit": { "desc": "Edit profiles, photos, signature, and passport data." },
  "employees.vault.manage": { "desc": "Upload and organise files inside employee vaults." },
  "employees.notify": { "desc": "Send WhatsApp (with SMS fallback) confirmations to employees for leaves, duty resumptions, and violations." },
  "leaves.view": { "desc": "See leave records and their status." },
  "leaves.create": { "desc": "Record new leave requests." },
  "leaves.edit": { "desc": "Amend leaves, attach certificates, and record duty returns." },
  "leaves.delete": { "desc": "Remove leave records." },
  "violations.view": { "desc": "See recorded violations." },
  "violations.create": { "desc": "Record new violations." },
  "violations.edit": { "desc": "Correct violation details." },
  "violations.delete": { "desc": "Remove violations." },
  "documents.generate": { "desc": "Create official documents from templates." },
  "documents.scan": { "desc": "Upload scans and run OCR to import documents." },
  "books.view": { "desc": "Browse the records register." },
  "books.create": { "desc": "Start new records from forms or templates." },
  "books.edit": { "desc": "Edit fields, reviewers, attachments, and file scan-backs." },
  "books.submit": { "desc": "Send records into the approval chain." },
  "books.approve": { "desc": "Approve, sign, or reject documents in the approval queue." },
  "books.override_state": { "desc": "Set any record to any state — draft, awaiting signature, awaiting scan, approved, returned, rejected, or voided — bypassing the approval chain. Admin-grade: it overrides who signed what." },
  "books.templates": { "desc": "Edit the shared Word templates records are composed from." },
  "books.delete": { "desc": "Move records to the bin." },
  "permits.view": { "desc": "See the security-zone entry-permit register and its status." },
  "permits.create": { "desc": "Register new security-zone entry permits." },
  "permits.edit": { "desc": "Edit people, vehicles, and documents; renew permits." },
  "permits.revoke": { "desc": "Revoke active entry permits." },
  "permits.delete": { "desc": "Remove permit records." },
  "ledger.view": { "desc": "Read correspondence ledger entries." },
  "ledger.create": { "desc": "Compose new entries, drafts, contacts, and recipient lists." },
  "ledger.edit": { "desc": "Edit entries and lists, flag, star, and attach files." },
  "ledger.send": { "desc": "Send email messages from the ledger as yourself." },
  "ledger.delete": { "desc": "Remove entries, drafts, contacts, and lists." },
  "email.manage": { "desc": "Link and sync your own mailbox." },
  "settings.view": { "desc": "See application settings." },
  "settings.edit": { "desc": "Change application settings." },
  "submitters.manage": { "desc": "Manage the list of document submitters." },
  "editor_templates.manage": { "desc": "Create and edit document editor templates." },
  "users.manage": { "desc": "Manage user accounts and their permissions (admin-only)." },
  "messages.broadcast": { "desc": "Post announcements (text or a document) to WhatsApp groups." },
  "workforce.self.view": { "desc": "View your own schedule, attendance punches, and leave." },
  "workforce.dashboard.view": { "desc": "View aggregate workforce dashboard data inside assigned scope." },
  "workforce.people.view": { "desc": "View roster and attendance details inside assigned scope." },
  "workforce.schedule.manage": { "desc": "Manage crews, rotations, memberships, and schedule overrides." },
  "workforce.policy.manage": { "desc": "Manage staffing requirements, attendance policies, and excusing leave kinds." },
  "workforce.attendance.review": { "desc": "Review workforce attendance cases, exceptions, and source facts." },
  "workforce.attendance.correct": { "desc": "Create audited workforce attendance adjustments." },
  "workforce.integration.manage": { "desc": "Manage workforce provider status, mappings, tests, and synchronization." },
  "system.admin": { "desc": "Use the admin key and run system/migration tools (admin-only)." }
}
```

In **`ar.json`**: add the same three domain keys (`"permits": "تصاريح الدخول", "messages": "الرسائل", "workforce": "القوى العاملة"`), the missing/new `access.permissions.caps` labels, and full `perms.caps` Arabic descriptions:

Labels (`ar.json` → `access.permissions.caps`, additions):

```json
"employees.create": "إضافة موظفين",
"employees.vault.manage": "إدارة خزنة المستندات",
"leaves.create": "تسجيل إجازات",
"leaves.delete": "حذف الإجازات",
"violations.create": "تسجيل مخالفات",
"violations.edit": "تعديل المخالفات",
"violations.delete": "حذف المخالفات",
"books.create": "إنشاء سجلات",
"books.edit": "تعديل السجلات والمرفقات",
"books.submit": "إرسال للاعتماد",
"books.templates": "إدارة قوالب وورد",
"books.delete": "حذف السجلات",
"permits.view": "عرض تصاريح الدخول",
"permits.create": "إصدار التصاريح",
"permits.edit": "تعديل التصاريح وتجديدها",
"permits.revoke": "إلغاء التصاريح",
"permits.delete": "حذف التصاريح",
"ledger.create": "إنشاء القيود والمسودّات",
"ledger.delete": "حذف القيود والمسودّات",
"messages.broadcast": "إرسال إعلانات للمجموعات",
"workforce.self.view": "عرض سجلّك في القوى العاملة",
"workforce.dashboard.view": "عرض لوحة القوى العاملة",
"workforce.people.view": "عرض منتسبي القوى العاملة",
"workforce.schedule.manage": "إدارة الجداول",
"workforce.policy.manage": "إدارة السياسات",
"workforce.attendance.review": "مراجعة الحضور",
"workforce.attendance.correct": "تصحيح الحضور",
"workforce.integration.manage": "إدارة تكامل القوى العاملة"
```

Descriptions (`ar.json` → `perms.caps`, same 50-id shape as EN):

```json
"caps": {
  "app.access": { "desc": "تسجيل الدخول وعرض لوحة المعلومات وحقول المستندات والعناصر للقراءة فقط." },
  "employees.view": { "desc": "عرض دليل الموظفين وسِجلاتهم الفردية." },
  "employees.create": { "desc": "إضافة موظفين جدد إلى الدليل." },
  "employees.edit": { "desc": "تعديل البيانات والصور والتوقيع وبيانات جواز السفر." },
  "employees.vault.manage": { "desc": "رفع الملفات وتنظيمها داخل خزنة الموظف." },
  "employees.notify": { "desc": "إرسال تأكيدات عبر واتساب (مع بديل الرسائل النصية) للإجازات واستئناف المناوبة والمخالفات." },
  "leaves.view": { "desc": "عرض سِجلات الإجازات وحالتها." },
  "leaves.create": { "desc": "تسجيل طلبات إجازة جديدة." },
  "leaves.edit": { "desc": "تعديل الإجازات وإرفاق الشهادات وتسجيل استئناف المناوبة." },
  "leaves.delete": { "desc": "حذف سِجلات الإجازات." },
  "violations.view": { "desc": "عرض المخالفات المسجَّلة." },
  "violations.create": { "desc": "تسجيل مخالفات جديدة." },
  "violations.edit": { "desc": "تصحيح تفاصيل المخالفة." },
  "violations.delete": { "desc": "حذف المخالفات." },
  "documents.generate": { "desc": "إنشاء مستندات رسمية من القوالب." },
  "documents.scan": { "desc": "رفع المسحات وتشغيل التعرّف الضوئي على الحروف لاستيراد المستندات." },
  "books.view": { "desc": "تصفّح سجل السجلات." },
  "books.create": { "desc": "بدء سجلات جديدة من النماذج أو القوالب." },
  "books.edit": { "desc": "تعديل الحقول والمراجعين والمرفقات وإيداع مسحات الكشف." },
  "books.submit": { "desc": "إرسال السجلات إلى مسار الاعتماد." },
  "books.approve": { "desc": "اعتماد أو توقيع أو رفض المستندات في قائمة الانتظار." },
  "books.override_state": { "desc": "ضبط أي سجل على أي حالة — مسودة أو بانتظار توقيع أو بانتظار مسح أو معتمد أو مرتجع أو مرفوض أو ملغى — بتخطّي مسار الاعتماد. من رتبة المسؤول: يتجاوز من وقّع وماذا." },
  "books.templates": { "desc": "تعديل قوالب وورد المشتركة التي تُصاغ منها السجلات." },
  "books.delete": { "desc": "نقل السجلات إلى المحذوفات." },
  "permits.view": { "desc": "عرض سجل تصاريح دخول المناطق الأمنية وحالتها." },
  "permits.create": { "desc": "تسجيل تصاريح دخول جديدة للمناطق الأمنية." },
  "permits.edit": { "desc": "تعديل الأشخاص والمركبات والمستندات وتجديد التصاريح." },
  "permits.revoke": { "desc": "إلغاء التصاريح النشطة." },
  "permits.delete": { "desc": "حذف سِجلات التصاريح." },
  "ledger.view": { "desc": "قراءة قيود سجل المراسلات." },
  "ledger.create": { "desc": "كتابة قيود ومسودّات وجهات اتصال وقوائم استلام جديدة." },
  "ledger.edit": { "desc": "تعديل القيود والقوائم والتمييز والإسناد النجمي وإرفاق الملفات." },
  "ledger.send": { "desc": "إرسال رسائل البريد من السجل باسمك." },
  "ledger.delete": { "desc": "حذف القيود والمسودّات وجهات الاتصال والقوائم." },
  "email.manage": { "desc": "ربط صندوق بريدك ومزامنته." },
  "settings.view": { "desc": "عرض إعدادات التطبيق." },
  "settings.edit": { "desc": "تغيير إعدادات التطبيق." },
  "submitters.manage": { "desc": "إدارة قائمة مقدّمي المستندات." },
  "editor_templates.manage": { "desc": "إنشاء وتعديل قوالب محرر المستندات." },
  "users.manage": { "desc": "إدارة حسابات المستخدمين وصلاحياتهم (للمسؤول فقط)." },
  "messages.broadcast": { "desc": "نشر إعلانات نصية أو مستندات إلى مجموعات واتساب." },
  "workforce.self.view": { "desc": "عرض جدولك وبطاقات حضورك وإجازاتك الخاصة." },
  "workforce.dashboard.view": { "desc": "عرض بيانات لوحة القوى العاملة الإجمالية ضمن النطاق المسند إليك." },
  "workforce.people.view": { "desc": "عرض الكشف وتفاصيل الحضور ضمن النطاق المسند." },
  "workforce.schedule.manage": { "desc": "إدارة الفرق والدورة والعضويات وتجاوزات الجدول." },
  "workforce.policy.manage": { "desc": "إدارة متطلبات التوظيف وسياسات الحضور وأنواع الإجازات المستثناة." },
  "workforce.attendance.review": { "desc": "مراجعة حالات الحضور والاستثناءات والبيانات المصدرية." },
  "workforce.attendance.correct": { "desc": "إنشاء تعديلات حضور مُدقَّقة ومسجَّلة." },
  "workforce.integration.manage": { "desc": "إدارة حالة مزوّد القوى العاملة والربط واختبارات المزامنة." },
  "system.admin": { "desc": "استخدام مفتاح المسؤول وتشغيل أدوات النظام والترحيل (للمسؤول فقط)." }
}
```

Also add to BOTH locales under `access.permissions`:

```json
"searchPlaceholder": "Search permissions…",      // ar: "ابحث في الصلاحيات…"
"results": "{{count}} result(s)",                 // ar: "{{count}} نتيجة"
"noResults": "No permissions match",              // ar: "لا توجد صلاحيات مطابقة"
"noResultsHint": "Search checks names, descriptions and IDs.",  // ar: "البحث يشمل الأسماء والأوصاف والمعرّفات."
"clearSearch": "Clear",                           // ar: "مسح"
"savedBulk": "Permissions updated."               // ar: "تم تحديث الصلاحيات."
```

- [ ] **Step 4: Localize CapabilityGate + request tab**

`frontend/src/components/shell/CapabilityGate.tsx` — replace lines 79-81:

```tsx
const catalogEntry = catalogQuery.data?.find((c) => c.id === cap)
const label = t(`access.permissions.caps.${cap}`, { defaultValue: catalogEntry?.label ?? cap })
const description = t(`perms.caps.${cap}.desc`, { defaultValue: catalogEntry?.description ?? '' })
```

`frontend/src/components/access/PermissionRequestsTab.tsx:107` — replace `{req.capability_label}`:

```tsx
{t(`access.permissions.caps.${req.capability}`, { defaultValue: req.capability_label })}
```

- [ ] **Step 5: Run i18n tests + full locale suite**

Run: `cd frontend && npx vitest run src/locales`
Expected: PASS (completeness test + existing scanback/permits i18n tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/locales frontend/src/components/shell/CapabilityGate.tsx frontend/src/components/access/PermissionRequestsTab.tsx
git commit -m "feat(i18n): translate every capability label+description (EN/AR), localize lock + request UI"
```

---

### Task 10: Docs, audit, full verification

**Files:**
- Modify: `docs/permissions-enforcement.md`
- Modify: `README.md` (only if it names a bundled cap — check with grep; likely no change)

- [ ] **Step 1: Re-run the capability-gate audit**

Run: `python backend/scripts/audit_capability_gates.py`
Expected: report exits 0; **zero** routes reference removed ids (`employees.edit` count drops to its surviving profile-only uses, `books.manage`/`violations.manage`/`permits.manage`/`ledger.edit` at 0). Paste the tier summary into the doc in Step 2.

- [ ] **Step 2: Update the enforcement doc**

In `docs/permissions-enforcement.md`: update §1 (catalog count 35 → 50, preset table with atomic ids, note the six removed ids and the expansion map), §2 (nothing changes semantically), §5 (audit numbers from Step 1), and add a short §7 "2026-08-23 granular split" recording the migration contract (old override → all children, access preserved exactly).

- [ ] **Step 3: Full backend suite**

Run: `python -m pytest backend/tests -x -q`
Expected: all PASS. Known files that may need literal-id assertion updates (capability name in 403 `details`): `test_word_book_routes.py`, `test_scanback_api.py`, `test_notify_api.py`, `test_book_template_routes_m4.py`, `test_permissions_messages_broadcast.py`, `test_workforce_api_permissions.py`. Update only assertion literals, never gate behavior.

- [ ] **Step 4: Full frontend suite + build**

Run: `cd frontend && npm run typecheck && npx vitest run && npm run build`
Expected: all PASS; build succeeds.

- [ ] **Step 5: Manual RTL smoke (optional but recommended)**

Run the app, switch to Arabic, open Settings → Access → user ⋮ → Permissions: every label and description is Arabic; search "سجلات" filters; bulk-deny a domain applies in one call; sheet sits on the LEFT with mirrored controls.

- [ ] **Step 6: Commit**

```bash
git add docs/permissions-enforcement.md
git commit -m "docs: enforcement map for the granular capability split"
```

---

## Self-Review Notes

- **Spec coverage:** split (Tasks 1, 3–5) ✓; exact-preservation migration (Task 2) ✓; pinpoint admin control incl. bulk (Tasks 6, 8) ✓; sheet search/bulk (Task 8) ✓; AR descriptions + labels + request dialog + completeness guard (Task 9) ✓; docs/audit (Task 10) ✓.
- **Type consistency:** `set_user_overrides(db, user_id, items: list[tuple[str, str|None, datetime|None]], *, actor)` used identically in Task 6 service+route; `setUserPermissionsBulk(id, items)` matches between Task 7 client and Task 8 sheet; i18n key names (`access.permissions.searchPlaceholder` etc.) match between Task 8 component and Task 9 locale additions.
- **Order matters:** Tasks 1→2→3→4→5→6 are backend-atomic; 7–9 frontend; 10 last. Task 2 must land after Task 1 (expansion map mirrors the new catalog) and before first app boot against a migrated DB.
