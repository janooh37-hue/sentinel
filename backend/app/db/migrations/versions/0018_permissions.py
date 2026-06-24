"""role_permissions + user_permissions: granular permission system.

Revision ID: 0018
Revises: 0017
Create Date: 2026-05-26

Adds the two tables behind the capability-based permission system (see
``backend/app/core/permissions.py`` for the catalog + role presets):

* ``role_permissions`` — default capability map per role. Seeded from the
  in-code ``ROLE_DEFAULTS`` so existing installs keep their implied behavior on
  upgrade.
* ``user_permissions`` — per-user ``grant``/``deny`` override layer.

Resolution (``services.perm_service.effective_caps``):
  role defaults plus user grants minus user denies, with the admin role
  short-circuiting to "all" so an admin can't be locked out of user management.

Additive only — no existing rows are touched.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Mirror of core.permissions.ROLE_DEFAULTS, inlined so the migration is
# self-contained and stable even if the catalog evolves later.
revision: str = "0018"
down_revision: str | Sequence[str] | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_ALL_CAPS = (
    "app.access",
    "employees.view",
    "employees.edit",
    "leaves.view",
    "leaves.edit",
    "violations.view",
    "violations.manage",
    "documents.generate",
    "books.view",
    "books.manage",
    "ledger.view",
    "ledger.edit",
    "ledger.send",
    "email.manage",
    "settings.view",
    "settings.edit",
    "submitters.manage",
    "editor_templates.manage",
    "users.manage",
    "system.admin",
)

_OPERATOR_CAPS = (
    "app.access",
    "employees.view",
    "leaves.view",
    "violations.view",
    "documents.generate",
    "books.view",
    "ledger.view",
    "ledger.edit",
    "settings.view",
)

_MANAGER_EXTRA = (
    "employees.edit",
    "leaves.edit",
    "violations.manage",
    "books.manage",
    "ledger.send",
    "submitters.manage",
    "editor_templates.manage",
)

_SEED: dict[str, tuple[str, ...]] = {
    "operator": _OPERATOR_CAPS,
    "manager": _OPERATOR_CAPS + _MANAGER_EXTRA,
    "admin": _ALL_CAPS,
}


def upgrade() -> None:
    op.create_table(
        "role_permissions",
        sa.Column("role", sa.String(length=16), primary_key=True),
        sa.Column("capability", sa.String(length=64), primary_key=True),
    )
    op.create_table(
        "user_permissions",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("capability", sa.String(length=64), primary_key=True),
        sa.Column("effect", sa.String(length=8), nullable=False),
        sa.CheckConstraint("effect IN ('grant', 'deny')", name="ck_user_perm_effect"),
    )

    conn = op.get_bind()
    for role, caps in _SEED.items():
        for cap in caps:
            conn.execute(
                sa.text(
                    "INSERT OR IGNORE INTO role_permissions (role, capability) "
                    "VALUES (:role, :cap)"
                ),
                {"role": role, "cap": cap},
            )


def downgrade() -> None:
    op.drop_table("user_permissions")
    op.drop_table("role_permissions")
