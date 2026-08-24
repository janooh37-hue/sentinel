"""Split six bundled capabilities into atomic children; preserve access exactly.

Revision ID: 0078
Revises: 0077

The catalog in core/permissions.py replaced six bundled ids with atomic
per-action children (see the expansion map below). Stored rows are expanded:

* role_permissions  — each role holding a parent gets every child (INSERT OR
  IGNORE), then parent rows are deleted. Parents that survive the split as
  their own child (employees.edit, leaves.edit, ledger.edit) keep their row:
  deleting it would remove a capability the role still holds, because the
  INSERT OR IGNORE of the self-child is a no-op against the existing parent
  row. The startup reconcile in main.py only ever ADDS rows, so deleting here
  is the only way old ids leave the table.
* user_permissions  — a grant/deny on a parent becomes the same effect on every
  child (grants keep their expires_at), then parent rows are deleted under the
  same self-child rule. This is what guarantees nobody gains or loses
  effective access.
* permission_requests — pending requests for a parent are re-pointed to the
  parent's primary child so the approval UI keeps resolving a label.

downgrade() is a deliberate no-op: the original parent rows cannot be
reconstructed from the expanded children.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0078"
# Full id required: Alembic resolves internal references exactly, not by prefix.
down_revision: str | Sequence[str] | None = "0077_timesheet_roster_assignments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# parent → atomic children (mirror of the catalog split; inlined so the
# migration stays self-contained like 0018).
_EXPANSION: dict[str, tuple[str, ...]] = {
    "employees.edit": ("employees.create", "employees.edit", "employees.vault.manage"),
    "leaves.edit": ("leaves.create", "leaves.edit", "leaves.delete"),
    "violations.manage": ("violations.create", "violations.edit", "violations.delete"),
    "books.manage": (
        "books.create",
        "books.edit",
        "books.submit",
        "books.templates",
        "books.delete",
    ),
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
        for child in children:
            conn.execute(
                sa.text(
                    "INSERT OR IGNORE INTO role_permissions (role, capability) "
                    "SELECT role, :child FROM role_permissions WHERE capability = :parent"
                ),
                {"child": child, "parent": parent},
            )
        # …then the parent goes away — unless it is its own child, in which
        # case the row above already IS the child row and deleting it would
        # strip access.
        if parent not in children:
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
        if parent not in children:
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


def downgrade() -> None:
    # Deliberate no-op: expanded children cannot be collapsed back without
    # knowing which rows were synthesized. See module docstring.
    pass
