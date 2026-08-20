"""Employee supervisor hierarchy column.

Revision ID: 0073_employee_supervisor
Revises: 0072_punch_profiles
Create Date: 2026-08-20

employees:
  + supervisor_id VARCHAR(16) NULL — employee id of the person's supervisor.

Additive only; downgrade drops the index and column.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0073_employee_supervisor"
down_revision: str | Sequence[str] | None = "0072_punch_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("supervisor_id", sa.String(16), nullable=True))
        batch.create_index("ix_employees_supervisor_id", ["supervisor_id"])


def downgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.drop_index("ix_employees_supervisor_id")
        batch.drop_column("supervisor_id")
