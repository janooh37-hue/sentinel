"""Issued employee-file statement prints and their per-employee serial.

Revision ID: 0115_employee_statement_prints
Revises: 0114_step_outcome_seen
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0115_employee_statement_prints"
down_revision: str | Sequence[str] | None = "0114_step_outcome_seen"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "employee_statement_prints",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "employee_id",
            sa.String(16),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("serial", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("from_date", sa.Date(), nullable=True),
        sa.Column("to_date", sa.Date(), nullable=False),
        sa.Column("language", sa.String(2), nullable=False),
        sa.Column("options", sa.Text(), nullable=False),
        sa.Column("printed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("printed_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("employee_id", "serial", name="uq_employee_statement_prints_serial"),
    )
    op.create_index(
        "ix_employee_statement_prints_employee_id",
        "employee_statement_prints",
        ["employee_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_employee_statement_prints_employee_id", table_name="employee_statement_prints"
    )
    op.drop_table("employee_statement_prints")
