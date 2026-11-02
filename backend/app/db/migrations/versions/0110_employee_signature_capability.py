"""Split employee signature writes out of employees.edit.

Revision ID: 0110_employee_signature_capability
Revises: 0109_book_folder_shares

Writing an employee's profile signature now needs
``employees.signature.manage`` instead of ``employees.edit``: a linked user
signs approvals with that same file, and ``employees.edit`` joins the
operator preset.

Per-user overrides are mirrored so no account gains or loses signature access:
each ``employees.edit`` grant or deny is copied to the new capability with the
same ``expires_at``. Role rows are not touched here. The manager preset carries
the new capability, and the startup reconcile in ``main.py`` adds it. Copying
role rows here would hand it to the operator role if that reconcile had already
added ``employees.edit`` for operators.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0110_employee_signature_capability"
down_revision: str | Sequence[str] | None = "0109_book_folder_shares"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PARENT = "employees.edit"
_CHILD = "employees.signature.manage"


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "INSERT OR IGNORE INTO user_permissions (user_id, capability, effect, expires_at) "
            "SELECT user_id, :child, effect, expires_at "
            "FROM user_permissions WHERE capability = :parent"
        ),
        {"child": _CHILD, "parent": _PARENT},
    )


def downgrade() -> None:
    # The capability does not exist before this revision. Also drop the role
    # rows the startup reconcile added, so older code sees no unknown id.
    conn = op.get_bind()
    for table in ("user_permissions", "role_permissions"):
        conn.execute(sa.text(f"DELETE FROM {table} WHERE capability = :child"), {"child": _CHILD})
