"""Odometer readings — allow a start-of-month reading before the closing one.

Revision ID: 0103_odometer_optional_closing
Revises: 0102_vehicle_odometer

``closing_km`` becomes nullable so the opening reading can be saved on its own;
``ck_vehicle_odometer_has_reading`` still forbids a row with neither reading.
Downgrade fills a missing closing with the opening (zero distance that month).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0103_odometer_optional_closing"
down_revision: str | Sequence[str] | None = "0102_vehicle_odometer"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("vehicle_odometer_readings") as batch:
        batch.drop_constraint("ck_vehicle_odometer_closing_nonnegative", type_="check")
        batch.alter_column("closing_km", existing_type=sa.Integer(), nullable=True)
        batch.create_check_constraint(
            "ck_vehicle_odometer_closing_nonnegative", "closing_km IS NULL OR closing_km >= 0"
        )
        batch.create_check_constraint(
            "ck_vehicle_odometer_has_reading", "opening_km IS NOT NULL OR closing_km IS NOT NULL"
        )


def downgrade() -> None:
    op.execute(
        "UPDATE vehicle_odometer_readings SET closing_km = opening_km WHERE closing_km IS NULL"
    )
    with op.batch_alter_table("vehicle_odometer_readings") as batch:
        batch.drop_constraint("ck_vehicle_odometer_has_reading", type_="check")
        batch.drop_constraint("ck_vehicle_odometer_closing_nonnegative", type_="check")
        batch.alter_column("closing_km", existing_type=sa.Integer(), nullable=False)
        batch.create_check_constraint("ck_vehicle_odometer_closing_nonnegative", "closing_km >= 0")
