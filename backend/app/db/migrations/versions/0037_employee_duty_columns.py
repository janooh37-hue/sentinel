"""Employee duty-location columns (Duty Locations & Internal Transfers).

Revision ID: 0037_employee_duty_columns
Revises: 0036_leave_return_columns
Create Date: 2026-06-22

employees:
  + duty_unit VARCHAR(128) NULL — top-level duty unit (e.g. الدوام الرسمي,
    السرية الأولى…). NULL = Unassigned.
  + duty_post VARCHAR(128) NULL — granular site/point inside the unit.

Additive only; downgrade drops both columns.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0037_employee_duty_columns"
down_revision: str | Sequence[str] | None = "0036_leave_return_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("duty_unit", sa.String(128), nullable=True))
        batch.add_column(sa.Column("duty_post", sa.String(128), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("duty_post")
        batch.drop_column("duty_unit")
