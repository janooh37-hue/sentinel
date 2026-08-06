"""security permits: exact Al Wathba location-zone access

Revision ID: 0066
Revises: 0065
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0066"
down_revision: str | Sequence[str] | None = "0065"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.add_column(sa.Column("access_areas", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.drop_column("access_areas")
