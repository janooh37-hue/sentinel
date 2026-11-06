"""Record why an automatic notification was skipped.

Revision ID: 0116_outbound_skip_reason
Revises: 0115_uniform

Adds nullable ``outbound_messages.skip_reason`` (``default_off`` | ``user_off``),
set only on ``status = 'skipped'`` rows. Downgrade drops the column.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0116_outbound_skip_reason"
down_revision: str | Sequence[str] | None = "0115_uniform"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("outbound_messages") as batch:
        batch.add_column(sa.Column("skip_reason", sa.String(length=32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("outbound_messages") as batch:
        batch.drop_column("skip_reason")
