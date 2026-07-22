"""permits: mulkiya vehicle fields + permit.book_id/manager_id.

Revision ID: 0063
Revises: 0062
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0063"
down_revision: str | Sequence[str] | None = "0062"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("permit_vehicles") as batch:
        batch.add_column(sa.Column("colour", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("vehicle_type", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("plate_category", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("traffic_no", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("reg_expiry", sa.Date(), nullable=True))
    with op.batch_alter_table("permits") as batch:
        batch.add_column(sa.Column("book_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("manager_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.drop_column("manager_id")
        batch.drop_column("book_id")
    with op.batch_alter_table("permit_vehicles") as batch:
        batch.drop_column("reg_expiry")
        batch.drop_column("traffic_no")
        batch.drop_column("plate_category")
        batch.drop_column("vehicle_type")
        batch.drop_column("colour")
