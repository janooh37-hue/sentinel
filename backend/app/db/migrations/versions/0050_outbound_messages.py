"""Unified outbound notification log (whatsapp + sms).

Revision ID: 0050_outbound_messages
Revises: 0049_sms_delivery_state
Create Date: 2026-07-13

Adds ``outbound_messages`` — one row per outbound notification attempt across
channels. Additive only; downgrade drops the table. Backfill is 0051.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0050_outbound_messages"
down_revision: str | Sequence[str] | None = "0049_sms_delivery_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "outbound_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False
        ),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("event_ref", sa.String(length=64), nullable=False),
        sa.Column("language", sa.String(length=2), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("delivery_state", sa.String(length=16), nullable=True),
        sa.Column("delivery_checked_at", sa.DateTime(), nullable=True),
        sa.Column("fell_back", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("fallback_reason", sa.String(length=32), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_retry_at", sa.DateTime(), nullable=True),
        sa.Column("provider_msg_id", sa.String(length=128), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("sent_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
    )
    op.create_index("ix_outbound_messages_event", "outbound_messages", ["event_type", "event_ref"])
    op.create_index("ix_outbound_messages_retry", "outbound_messages", ["status", "next_retry_at"])


def downgrade() -> None:
    op.drop_index("ix_outbound_messages_retry", table_name="outbound_messages")
    op.drop_index("ix_outbound_messages_event", table_name="outbound_messages")
    op.drop_table("outbound_messages")
