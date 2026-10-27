"""Record a receiving head's choice to keep a department send.

Revision ID: 0113_department_send_keep
Revises: 0112_department_sends
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0113_department_send_keep"
down_revision: str | Sequence[str] | None = "0112_department_sends"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("book_department_sends") as batch:
        batch.add_column(sa.Column("kept_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("kept_by_user_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("book_department_sends") as batch:
        batch.drop_column("kept_by_user_id")
        batch.drop_column("kept_at")
