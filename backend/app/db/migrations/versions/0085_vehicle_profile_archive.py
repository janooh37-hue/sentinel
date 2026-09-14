"""Add vehicle profile, archive, and insurance-reminder columns.

Revision ID: 0085_vehicle_profile_archive
Revises: 0084_merge_0083_heads
Create Date: 2026-09-07 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0085_vehicle_profile_archive"
down_revision: str | Sequence[str] | None = "0084_merge_0083_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("vehicles") as batch:
        batch.add_column(sa.Column("make", sa.String(length=128), nullable=True))
        batch.add_column(sa.Column("model", sa.String(length=128), nullable=True))
        batch.add_column(sa.Column("model_year", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("colour", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("insurance_expiry", sa.Date(), nullable=True))
        batch.add_column(sa.Column("inmate_capacity", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("passenger_capacity", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("accessories_ar", sa.Text(), nullable=True))
        batch.add_column(sa.Column("accessories_en", sa.Text(), nullable=True))
        batch.add_column(sa.Column("notes_ar", sa.Text(), nullable=True))
        batch.add_column(sa.Column("notes_en", sa.Text(), nullable=True))
        batch.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("insurance_reminder_sent_for", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("vehicles") as batch:
        batch.drop_column("insurance_reminder_sent_for")
        batch.drop_column("archived_at")
        batch.drop_column("notes_en")
        batch.drop_column("notes_ar")
        batch.drop_column("accessories_en")
        batch.drop_column("accessories_ar")
        batch.drop_column("passenger_capacity")
        batch.drop_column("inmate_capacity")
        batch.drop_column("insurance_expiry")
        batch.drop_column("colour")
        batch.drop_column("model_year")
        batch.drop_column("model")
        batch.drop_column("make")
