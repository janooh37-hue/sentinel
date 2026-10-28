"""Track submitters' unseen signing-manager outcomes without replaying history.

Revision ID: 0110_step_outcome_seen
Revises: 0109_book_folder_shares
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0110_step_outcome_seen"
down_revision: str | Sequence[str] | None = "0109_book_folder_shares"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("book_approval_steps") as batch:
        batch.add_column(sa.Column("outcome_seen_at", sa.DateTime(), nullable=True))
    op.execute(
        sa.text(
            "UPDATE book_approval_steps SET outcome_seen_at = decided_at "
            "WHERE decided_at IS NOT NULL"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("book_approval_steps") as batch:
        batch.drop_column("outcome_seen_at")
