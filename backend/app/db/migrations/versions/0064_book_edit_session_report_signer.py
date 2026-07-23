"""book_edit_sessions: report signer + sign-on-finish

Revision ID: 0064
Revises: 0063
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0064"
down_revision: str | Sequence[str] | None = "0063"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "book_edit_sessions", sa.Column("signer_employee_id", sa.String(length=16), nullable=True)
    )
    op.add_column("book_edit_sessions", sa.Column("sign_on_finish", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("book_edit_sessions", "sign_on_finish")
    op.drop_column("book_edit_sessions", "signer_employee_id")
