"""security permits — make permit_vehicles.plate_no optional.

Revision ID: 0061
Revises: 0060
Create Date: 2026-07-21

A vehicle can now be added from its licence scan alone (OCR fills the plate),
so the plate is no longer required at the column level.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0061"
down_revision: str | Sequence[str] | None = "0060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("permit_vehicles") as batch:
        batch.alter_column("plate_no", existing_type=sa.String(32), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("permit_vehicles") as batch:
        batch.alter_column("plate_no", existing_type=sa.String(32), nullable=False)
