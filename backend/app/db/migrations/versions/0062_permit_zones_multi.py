"""security permits — replace permits.zone with a multi-value permits.zones.

Revision ID: 0062
Revises: 0061
Create Date: 2026-07-22

Permits can now cover any combination of Green, Red, and the new Work
Residence zone, so the single ``zone`` string becomes a JSON array ``zones``.
Existing rows migrate: both -> [green, red]; otherwise the single value wraps
into a one-element array.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0062"
down_revision: str | Sequence[str] | None = "0061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.add_column(sa.Column("zones", sa.JSON(), nullable=True))

    # Backfill from the old single-value column.
    op.execute(
        """
        UPDATE permits SET zones = CASE zone
            WHEN 'both' THEN '["green", "red"]'
            WHEN 'red' THEN '["red"]'
            WHEN 'work_residence' THEN '["work_residence"]'
            ELSE '["green"]'
        END
        """
    )

    with op.batch_alter_table("permits") as batch:
        batch.drop_column("zone")


def downgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.add_column(sa.Column("zone", sa.String(8), nullable=True))

    # Collapse the array back to a single value (best-effort): a permit with
    # both green and red becomes 'both'; otherwise the first zone.
    op.execute(
        """
        UPDATE permits SET zone = CASE
            WHEN zones LIKE '%green%' AND zones LIKE '%red%' THEN 'both'
            WHEN zones LIKE '%red%' THEN 'red'
            WHEN zones LIKE '%work_residence%' THEN 'work_residence'
            ELSE 'green'
        END
        """
    )

    with op.batch_alter_table("permits") as batch:
        batch.drop_column("zones")
