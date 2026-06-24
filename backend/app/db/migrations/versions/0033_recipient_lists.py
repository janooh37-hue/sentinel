"""Ledger compose: per-user recipient (distribution) lists.

Revision ID: 0033_recipient_lists
Revises: 0032_correspondence_log
Create Date: 2026-06-09

New ``recipient_lists`` table — saved To/Cc distribution lists scoped per
signed-in user. ``owner_user_id`` carries no DB-level FK (app-side integrity,
mirrors the address-book / Phase-1 owner columns). ``members`` is a JSON array
of {field, address, display_name}. UNIQUE (owner_user_id, name). Brand-new
empty table — no backfill.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033_recipient_lists"
down_revision: str | Sequence[str] | None = "0032_correspondence_log"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recipient_lists",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("members", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            "owner_user_id", "name", name="uq_recipient_lists_owner_name"
        ),
    )
    op.create_index(
        "ix_recipient_lists_owner_user_id",
        "recipient_lists",
        ["owner_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_recipient_lists_owner_user_id", table_name="recipient_lists"
    )
    op.drop_table("recipient_lists")
