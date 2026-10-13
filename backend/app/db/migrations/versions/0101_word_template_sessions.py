"""Allow standalone Word template sessions.

Revision ID: 0101_word_template_sessions
Revises: 0100_merge_heads
"""

import sqlalchemy as sa
from alembic import op

revision = "0101_word_template_sessions"
down_revision = "0100_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("book_edit_sessions") as batch:
        batch.alter_column("book_id", existing_type=sa.Integer(), nullable=True)
        batch.add_column(sa.Column("template_name", sa.String(255), nullable=True))


def downgrade() -> None:
    op.execute("DELETE FROM book_edit_sessions WHERE book_id IS NULL")
    with op.batch_alter_table("book_edit_sessions") as batch:
        batch.drop_column("template_name")
        batch.alter_column("book_id", existing_type=sa.Integer(), nullable=False)
