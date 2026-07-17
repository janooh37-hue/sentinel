"""Word-books: classification + voided on books; edit sessions; classified counter.

Revision ID: 0056
Revises: 0055
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("books") as batch:
        batch.add_column(sa.Column("classification_code", sa.String(16), nullable=True))
        batch.add_column(sa.Column("voided_at", sa.DateTime(), nullable=True))

    op.create_table(
        "classified_ref_sequence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("next_value", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("next_value >= 1", name="ck_classified_ref_min"),
    )

    op.create_table(
        "book_edit_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("working_path", sa.Text(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_put_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "uq_book_edit_sessions_active",
        "book_edit_sessions",
        ["book_id"],
        unique=True,
        sqlite_where=sa.text("state = 'active'"),
    )


def downgrade() -> None:
    op.drop_index("uq_book_edit_sessions_active", table_name="book_edit_sessions")
    op.drop_table("book_edit_sessions")
    op.drop_table("classified_ref_sequence")
    with op.batch_alter_table("books") as batch:
        batch.drop_column("voided_at")
        batch.drop_column("classification_code")
