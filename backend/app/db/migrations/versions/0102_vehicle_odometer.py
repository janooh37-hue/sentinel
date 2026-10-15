"""Monthly vehicle odometer readings.

Revision ID: 0102_vehicle_odometer
Revises: 0101_word_template_sessions
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0102_vehicle_odometer"
down_revision: str | Sequence[str] | None = "0101_word_template_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vehicle_odometer_readings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("month", sa.String(length=7), nullable=False),
        sa.Column("opening_km", sa.Integer(), nullable=True),
        sa.Column("closing_km", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("closing_km >= 0", name="ck_vehicle_odometer_closing_nonnegative"),
        sa.CheckConstraint(
            "opening_km IS NULL OR opening_km >= 0",
            name="ck_vehicle_odometer_opening_nonnegative",
        ),
        sa.UniqueConstraint("vehicle_id", "month", name="uq_vehicle_odometer_month"),
    )


def downgrade() -> None:
    op.drop_table("vehicle_odometer_readings")
