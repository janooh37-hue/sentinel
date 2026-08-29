"""user lock layout

Revision ID: 0081_user_lock_layout
Revises: 0080_merge_dashboard_idle_lock
Create Date: 2026-08-29 16:48:01.454342
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0081_user_lock_layout"
down_revision: str | Sequence[str] | None = "0080_merge_dashboard_idle_lock"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column(
                "lock_layout",
                sa.String(length=16),
                nullable=False,
                server_default="band",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("lock_layout")
