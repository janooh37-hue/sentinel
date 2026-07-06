"""add body column to sms_messages

Revision ID: 0047_sms_message_body
Revises: 0046_employee_passport_no_source
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0047_sms_message_body"
down_revision: str | Sequence[str] | None = "0046_employee_passport_no_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sms_messages") as batch:
        batch.add_column(sa.Column("body", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sms_messages") as batch:
        batch.drop_column("body")
