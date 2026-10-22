"""Vehicle maintenance requests linked to General Books and completed maintenance.

Revision ID: 0104_vehicle_maintenance_requests
Revises: 0103_odometer_optional_closing
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0104_vehicle_maintenance_requests"
down_revision: str | Sequence[str] | None = "0103_odometer_optional_closing"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vehicle_maintenance_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column(
            "employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=True
        ),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("odometer_km", sa.Integer(), nullable=True),
        sa.Column("book_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=8), nullable=False, server_default="open"),
        sa.Column("maintenance_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "type IN ('service', 'repair', 'tires', 'other')",
            name="ck_vehicle_maintenance_requests_type",
        ),
        sa.CheckConstraint(
            "status IN ('open', 'done')", name="ck_vehicle_maintenance_requests_status"
        ),
    )
    op.create_index(
        "ix_vehicle_maintenance_requests_vehicle_status",
        "vehicle_maintenance_requests",
        ["vehicle_id", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_vehicle_maintenance_requests_vehicle_status", table_name="vehicle_maintenance_requests"
    )
    op.drop_table("vehicle_maintenance_requests")
