"""book send state

Revision ID: 0098_book_send_state
Revises: 0097_item_permit_zones
Create Date: 2026-10-09 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0098_book_send_state"
down_revision: str | Sequence[str] | None = "0097_item_permit_zones"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("books") as batch_op:
        batch_op.add_column(
            sa.Column("send_state", sa.String(length=16), nullable=False, server_default="unsent")
        )


def downgrade() -> None:
    with op.batch_alter_table("books") as batch_op:
        batch_op.drop_column("send_state")
