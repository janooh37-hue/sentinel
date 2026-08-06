"""permit validity period columns and legacy-date backfill

Revision ID: 0067
Revises: 0066
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0067"
down_revision: str | Sequence[str] | None = "0066"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.add_column(sa.Column("validity_value", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("validity_unit", sa.String(8), nullable=True))

    op.execute(
        sa.text(
            """
            UPDATE permits
            SET validity_value = CAST(julianday(end_date) - julianday(start_date) + 1 AS INTEGER),
                validity_unit = 'day'
            """
        )
    )

    with op.batch_alter_table("permits") as batch:
        batch.alter_column("validity_value", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("validity_unit", existing_type=sa.String(8), nullable=False)
        batch.create_check_constraint(
            "ck_permits_validity_unit",
            "validity_unit IN ('day', 'week', 'month', 'year')",
        )


def downgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.drop_constraint("ck_permits_validity_unit", type_="check")
        batch.drop_column("validity_unit")
        batch.drop_column("validity_value")
