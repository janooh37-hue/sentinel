"""user idle lock seconds

Revision ID: 0079_user_idle_lock
Revises: 0078
Create Date: 2026-08-29 03:39:30.003616
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0079_user_idle_lock"
down_revision: str | Sequence[str] | None = "0078"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column(
                "idle_lock_seconds",
                sa.Integer(),
                nullable=False,
                server_default="1800",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("idle_lock_seconds")
