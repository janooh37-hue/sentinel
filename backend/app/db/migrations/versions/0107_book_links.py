"""Record replies, derived records and attached references.

Revision ID: 0107_book_links
Revises: 0106_recipient_state
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0107_book_links"
down_revision: str | Sequence[str] | None = "0106_recipient_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "book_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "book_id",
            sa.Integer(),
            sa.ForeignKey("books.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_book_id",
            sa.Integer(),
            sa.ForeignKey("books.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("attached", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('reply', 'based_on', 'reference')", name="ck_book_links_kind"),
        sa.UniqueConstraint("book_id", "target_book_id", name="uq_book_links_pair"),
    )
    op.create_index("ix_book_links_target", "book_links", ["target_book_id"])


def downgrade() -> None:
    op.drop_index("ix_book_links_target", table_name="book_links")
    op.drop_table("book_links")
