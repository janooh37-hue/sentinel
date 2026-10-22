"""Selected user and department sharing for team book folders.

Revision ID: 0109_book_folder_shares
Revises: 0108_book_folders
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0109_book_folder_shares"
down_revision: str | Sequence[str] | None = "0108_book_folders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "book_folder_shares",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "folder_id",
            sa.Integer(),
            sa.ForeignKey("book_folders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("department", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.CheckConstraint(
            "(user_id IS NOT NULL AND department IS NULL) OR "
            "(user_id IS NULL AND department IS NOT NULL)",
            name="ck_book_folder_shares_target",
        ),
        sa.UniqueConstraint("folder_id", "user_id", name="uq_book_folder_shares_user"),
        sa.UniqueConstraint("folder_id", "department", name="uq_book_folder_shares_department"),
    )


def downgrade() -> None:
    op.drop_table("book_folder_shares")
