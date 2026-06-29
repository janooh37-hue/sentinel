"""WhatsApp notifications — employee language pref + send log.

Revision ID: 0043_whatsapp_notifications
Revises: 0042_permission_requests
Create Date: 2026-06-29

Adds:
- ``employees.msg_language`` — preferred WhatsApp message language ('ar'|'en'),
  default 'ar'.
- ``whatsapp_messages`` — one row per send attempt (audit + "Sent" badge).

Additive only; downgrade reverses both.

NOTE: The task brief specified revision id ``0042_whatsapp_notifications`` with
down_revision ``0041_push_notify_state``, but ``0042_permission_requests``
already exists with down_revision ``0041_push_notify_state``. This migration
is therefore numbered ``0043`` and revises ``0042_permission_requests`` to keep
the chain linear.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0043_whatsapp_notifications"
down_revision: str | Sequence[str] | None = "0042_permission_requests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(
            sa.Column(
                "msg_language",
                sa.String(length=2),
                nullable=False,
                server_default="ar",
            )
        )
    op.create_table(
        "whatsapp_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "employee_id",
            sa.String(length=16),
            sa.ForeignKey("employees.id"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("event_ref", sa.String(length=64), nullable=False),
        sa.Column("language", sa.String(length=2), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("template", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provider_msg_id", sa.String(length=128), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("sent_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
    )
    op.create_index(
        "ix_whatsapp_messages_event",
        "whatsapp_messages",
        ["event_type", "event_ref"],
    )


def downgrade() -> None:
    op.drop_index("ix_whatsapp_messages_event", table_name="whatsapp_messages")
    op.drop_table("whatsapp_messages")
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("msg_language")
