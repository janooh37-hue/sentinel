"""Recipient done/archive state and circulation purpose.

Revision ID: 0103_recipient_state
Revises: 0102_record_confidentiality
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0103_recipient_state"
down_revision: str | Sequence[str] | None = "0102_record_confidentiality"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Remove the old CHECK before translating data; neither vocabulary accepts both.
    with op.batch_alter_table("book_recipients") as batch:
        batch.drop_constraint("ck_book_recipients_purpose", type_="check")
        batch.add_column(sa.Column("done_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.execute("UPDATE book_recipients SET purpose = 'circulate' WHERE purpose = 'sign'")
    with op.batch_alter_table("book_recipients") as batch:
        batch.create_check_constraint(
            "ck_book_recipients_purpose", "purpose IN ('info', 'action', 'reply', 'circulate')"
        )


def downgrade() -> None:
    with op.batch_alter_table("book_recipients") as batch:
        batch.drop_constraint("ck_book_recipients_purpose", type_="check")
    op.execute("UPDATE book_recipients SET purpose = 'sign' WHERE purpose = 'circulate'")
    with op.batch_alter_table("book_recipients") as batch:
        batch.create_check_constraint(
            "ck_book_recipients_purpose", "purpose IN ('info', 'action', 'reply', 'sign')"
        )
        batch.drop_column("archived_at")
        batch.drop_column("done_at")
