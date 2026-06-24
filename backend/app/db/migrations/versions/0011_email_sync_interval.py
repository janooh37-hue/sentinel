"""email_accounts: sync_interval_minutes for scheduled background sync.

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-21

Adds ``sync_interval_minutes`` (int, default 5). 0 disables the background
scheduler; positive values are minutes between automatic sync runs.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("email_accounts") as batch:
        batch.add_column(
            sa.Column(
                "sync_interval_minutes",
                sa.Integer(),
                nullable=False,
                server_default="5",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("email_accounts") as batch:
        batch.drop_column("sync_interval_minutes")
