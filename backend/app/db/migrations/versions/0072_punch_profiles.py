"""learned punch habits per employee and shift.

Revision ID: 0072_punch_profiles
Revises: 0071_workforce_attendance
Create Date: 2026-08-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0072_punch_profiles"
down_revision: str | Sequence[str] | None = "0071_workforce_attendance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attendance_punch_profiles",
        sa.Column("employee_id", sa.String(length=16), nullable=False),
        sa.Column("shift_code", sa.String(length=32), nullable=False),
        sa.Column("sample_days", sa.Integer(), nullable=False),
        sa.Column("arrival_early_offset", sa.Integer(), nullable=False),
        sa.Column("arrival_typical_offset", sa.Integer(), nullable=False),
        sa.Column("departure_typical_offset", sa.Integer(), nullable=True),
        sa.Column("departure_late_offset", sa.Integer(), nullable=True),
        sa.Column("suggested_shift_code", sa.String(length=32), nullable=True),
        sa.Column("window_days", sa.Integer(), nullable=False),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.PrimaryKeyConstraint("employee_id", "shift_code"),
        sa.CheckConstraint("sample_days > 0", name="ck_attendance_punch_profiles_sample_positive"),
        sa.CheckConstraint("window_days > 0", name="ck_attendance_punch_profiles_window_positive"),
        sa.CheckConstraint(
            "arrival_early_offset <= arrival_typical_offset",
            name="ck_attendance_punch_profiles_arrival_order",
        ),
        sa.CheckConstraint(
            "(departure_typical_offset IS NULL) = (departure_late_offset IS NULL)",
            name="ck_attendance_punch_profiles_departure_pair",
        ),
        sa.CheckConstraint(
            "departure_late_offset IS NULL OR departure_typical_offset <= departure_late_offset",
            name="ck_attendance_punch_profiles_departure_order",
        ),
    )


def downgrade() -> None:
    op.drop_table("attendance_punch_profiles")
