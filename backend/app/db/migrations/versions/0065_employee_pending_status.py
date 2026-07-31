"""employees: pending_status for scheduled departures

Revision ID: 0065
Revises: 0064
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0065"
down_revision: str | Sequence[str] | None = "0064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("pending_status", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("employees", "pending_status")
