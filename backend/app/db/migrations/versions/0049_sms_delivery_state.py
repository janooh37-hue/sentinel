"""add delivery_state + delivery_checked_at to sms_messages

Revision ID: 0049_sms_delivery_state
Revises: 0048_merge_sms_scaninbox
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0049_sms_delivery_state"
down_revision: str | Sequence[str] | None = "0048_merge_sms_scaninbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sms_messages") as batch:
        batch.add_column(sa.Column("delivery_state", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("delivery_checked_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sms_messages") as batch:
        batch.drop_column("delivery_checked_at")
        batch.drop_column("delivery_state")
