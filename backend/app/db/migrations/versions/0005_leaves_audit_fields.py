"""leaves table — add updated_at and deleted_at columns.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-20

Changes:
  - leaves.updated_at  DATETIME NULL  — set to created_at value on existing rows.
  - leaves.deleted_at  DATETIME NULL  — soft-delete timestamp (NULL = active).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("leaves") as batch_op:
        batch_op.add_column(
            sa.Column("updated_at", sa.DateTime(), nullable=True, server_default=None)
        )
        batch_op.add_column(
            sa.Column("deleted_at", sa.DateTime(), nullable=True, server_default=None)
        )

    # Backfill updated_at to created_at for any existing rows.
    conn = op.get_bind()
    conn.execute(
        sa.text("UPDATE leaves SET updated_at = created_at WHERE updated_at IS NULL")
    )


def downgrade() -> None:
    with op.batch_alter_table("leaves") as batch_op:
        batch_op.drop_column("deleted_at")
        batch_op.drop_column("updated_at")
