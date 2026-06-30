"""SMS notifications — per-attempt send log for the SIM gateway channel.

Revision ID: 0044_sms_messages
Revises: 0043_whatsapp_notifications
Create Date: 2026-06-30

Adds ``sms_messages`` (one row per SMS send attempt; audit + "Sent" badge).
Additive only; downgrade drops the table.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0044_sms_messages"
down_revision: str | Sequence[str] | None = "0043_whatsapp_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sms_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("event_ref", sa.String(length=64), nullable=False),
        sa.Column("language", sa.String(length=2), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provider_msg_id", sa.String(length=128), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("sent_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )
    op.create_index("ix_sms_messages_event", "sms_messages", ["event_type", "event_ref"])


def downgrade() -> None:
    op.drop_index("ix_sms_messages_event", table_name="sms_messages")
    op.drop_table("sms_messages")
