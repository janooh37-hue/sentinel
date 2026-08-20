"""timesheet stat fillers

Revision ID: 0071_timesheet_stat_fillers
Revises: 0070_timesheet
Create Date: 2026-08-19 00:00:00.000000

Per-month block-2 code assignments for the client statistics sheet. Block 2 is
the surplus headcount above the contracted post count; the operator chooses what
code each surplus row shows, and the choice carries forward month to month.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0071_timesheet_stat_fillers"
down_revision: str | Sequence[str] | None = "0070_timesheet"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "timesheet_stat_fillers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("code", sa.String(4), nullable=False),
        sa.UniqueConstraint("year", "month", "employee_id", name="uq_timesheet_stat_filler"),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_timesheet_stat_filler_month"),
    )


def downgrade() -> None:
    op.drop_table("timesheet_stat_fillers")
