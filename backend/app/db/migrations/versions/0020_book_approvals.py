"""book approvals — categories.requires_approval, books approval fields, steps table.

Revision ID: 0020
Revises: 0019
Create Date: 2026-05-27

Additive only. Existing rows untouched: every book stays approval_state='none'.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | Sequence[str] | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("book_categories") as batch_op:
        batch_op.add_column(
            sa.Column("requires_approval", sa.Boolean(), nullable=False, server_default="0")
        )
    with op.batch_alter_table("books") as batch_op:
        batch_op.add_column(
            sa.Column("priority", sa.String(length=16), nullable=False, server_default="Normal")
        )
        batch_op.add_column(
            sa.Column("approval_state", sa.String(length=16), nullable=False, server_default="none")
        )
        # FK enforcement for this nullable column is left to the ORM (SQLite does
        # not reliably enforce FKs added to an existing table via batch ALTER).
        batch_op.add_column(
            sa.Column("submitted_by_user_id", sa.Integer(), nullable=True)
        )
    op.create_table(
        "book_approval_steps",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "book_id",
            sa.Integer(),
            sa.ForeignKey("books.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_order", sa.Integer(), nullable=False),
        sa.Column("stage_label", sa.String(length=64), nullable=False),
        sa.Column(
            "assignee_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("state", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_book_steps_book_order", "book_approval_steps", ["book_id", "step_order"])


def downgrade() -> None:
    op.drop_index("ix_book_steps_book_order", table_name="book_approval_steps")
    op.drop_table("book_approval_steps")
    with op.batch_alter_table("books") as batch_op:
        batch_op.drop_column("submitted_by_user_id")
        batch_op.drop_column("approval_state")
        batch_op.drop_column("priority")
    with op.batch_alter_table("book_categories") as batch_op:
        batch_op.drop_column("requires_approval")
