"""create group_announcements + group_announcement_sends

Revision ID: 0053
Revises: 0052
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "group_announcements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("attachment_kind", sa.String(length=16), nullable=False, server_default="none"),
        sa.Column("attachment_name", sa.String(length=256), nullable=True),
        sa.Column("book_id", sa.Integer(), nullable=True),
        sa.Column("sent_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "group_announcement_sends",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("announcement_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.String(length=64), nullable=False),
        sa.Column("group_name", sa.String(length=256), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provider_msg_id", sa.String(length=128), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_group_announcement_sends_ann", "group_announcement_sends", ["announcement_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_group_announcement_sends_ann", table_name="group_announcement_sends")
    op.drop_table("group_announcement_sends")
    op.drop_table("group_announcements")
