"""Add vehicle certificate expiry, history, and replacement metadata.

Revision ID: 0090_vehicle_certificates
Revises: 0089_vehicle_fines_ledger

Adds four nullable/defaulted columns to ``vehicle_files``: `expiry_date` and
`expiry_reminder_sent_for` (certificate-only, mirroring the existing
`Vehicle.expiry_reminder_sent_for` pattern), `is_historical` (defaults false),
and `superseded_by_file_id` (points a superseded certificate at its
replacement; no SQL foreign key, same convention as `Vehicle.license_file_id`
and `Vehicle.photo_asset_id`). Every existing row of every kind gets NULL
dates, NULL pointer, and `is_historical = 0` — no expiry is ever inferred from
a filename or existing data. File bytes and every other column are untouched.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0090_vehicle_certificates"
down_revision = "0089_vehicle_fines_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("vehicle_files") as batch_op:
        batch_op.add_column(sa.Column("expiry_date", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("expiry_reminder_sent_for", sa.Date(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "is_historical",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
        batch_op.add_column(sa.Column("superseded_by_file_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("vehicle_files") as batch_op:
        batch_op.drop_column("superseded_by_file_id")
        batch_op.drop_column("is_historical")
        batch_op.drop_column("expiry_reminder_sent_for")
        batch_op.drop_column("expiry_date")
