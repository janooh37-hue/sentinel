"""timesheet starting-point acknowledgements

Revision ID: 0076_timesheet_start_acks
Revises: 0075_timesheet_stat_fillers
Create Date: 2026-08-20 00:00:00.000000

A mid-month joiner's days before his date of joining are NG. The operator is
shown that as a flag and acknowledges it once; this table is that
acknowledgement. It is deliberately NOT an override — the codes are derived and
stay derived, so a wrong date of joining is fixed on the employee record, not
papered over here.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0076_timesheet_start_acks"
down_revision: str | Sequence[str] | None = "0075_timesheet_stat_fillers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "timesheet_start_acks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.String(16), nullable=False),
        sa.Column("acked_at", sa.DateTime(), nullable=False),
        sa.Column("acked_by", sa.Integer(), nullable=True),
        sa.UniqueConstraint("year", "month", "employee_id", name="uq_timesheet_start_ack"),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_timesheet_start_ack_month"),
    )


def downgrade() -> None:
    op.drop_table("timesheet_start_acks")
