"""push_sent ledger + push_subscriptions.locale — durable, localized push.

Revision ID: 0041_push_notify_state
Revises: 0040_push_subscriptions
Create Date: 2026-06-25

Adds:
- ``push_subscriptions.locale`` — the device's UI language at subscribe time,
  so the notifier can localize the push body (Arabic when the phone is Arabic).
- ``push_sent`` — durable per-(user, kind, ref) ledger so each actionable item
  is pushed exactly once and survives process restarts (the old in-memory
  digest re-notified everything on every boot).

Additive only; downgrade reverses both.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0041_push_notify_state"
down_revision: str | Sequence[str] | None = "0040_push_subscriptions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "push_subscriptions",
        sa.Column("locale", sa.String(length=8), nullable=True),
    )
    op.create_table(
        "push_sent",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("ref", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.UniqueConstraint(
            "user_id", "kind", "ref", name="uq_push_sent_user_kind_ref"
        ),
    )
    op.create_index("ix_push_sent_user_id", "push_sent", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_push_sent_user_id", table_name="push_sent")
    op.drop_table("push_sent")
    op.drop_column("push_subscriptions", "locale")
