"""Personal and team book filing folders.

Revision ID: 0108_book_folders
Revises: 0107_book_links
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0108_book_folders"
down_revision: str | Sequence[str] | None = "0107_book_links"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "book_folders",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
    )
    op.create_index("ix_book_folders_owner_user_id", "book_folders", ["owner_user_id"])
    op.create_table(
        "book_folder_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "folder_id",
            sa.Integer(),
            sa.ForeignKey("book_folders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "book_id",
            sa.Integer(),
            sa.ForeignKey("books.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("added_by_user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.UniqueConstraint("folder_id", "book_id", name="uq_book_folder_items_folder_book"),
    )
    op.create_index("ix_book_folder_items_book_id", "book_folder_items", ["book_id"])


def downgrade() -> None:
    op.drop_index("ix_book_folder_items_book_id", table_name="book_folder_items")
    op.drop_table("book_folder_items")
    op.drop_index("ix_book_folders_owner_user_id", table_name="book_folders")
    op.drop_table("book_folders")
