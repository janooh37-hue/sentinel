"""monthly inmate conduct violation statistics

Revision ID: 0085_inmate_violation_statistics
Revises: 0084_merge_0083_heads
Create Date: 2026-09-10

Adds the closed-month register, its frozen snapshot rows, and the open-month
manual overlay. Snapshot provenance deliberately carries no foreign keys so a
filed register outlives its source Record.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0085_inmate_violation_statistics"
down_revision: str | Sequence[str] | None = "0084_merge_0083_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "inmate_violation_periods",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_by", sa.Integer(), nullable=True),
        sa.Column("reopened_at", sa.DateTime(), nullable=True),
        sa.Column("reopened_by", sa.Integer(), nullable=True),
        sa.Column("force_reason", sa.Text(), nullable=True),
        sa.Column("export_path", sa.String(length=255), nullable=True),
        sa.UniqueConstraint("year", "month", name="uq_inmate_violation_periods_month"),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_inmate_violation_periods_month"),
        sa.CheckConstraint("year BETWEEN 2000 AND 2100", name="ck_inmate_violation_periods_year"),
    )

    op.create_table(
        "inmate_violation_stat_rows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "period_id",
            sa.Integer(),
            sa.ForeignKey("inmate_violation_periods.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("row_handle", sa.String(length=64), nullable=False),
        sa.Column("origin", sa.String(length=8), nullable=False),
        sa.Column("row_no", sa.Integer(), nullable=False),
        sa.Column("population", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("uid", sa.String(length=64), nullable=True),
        sa.Column("nationality_label", sa.String(length=64), nullable=True),
        sa.Column("nationality_code", sa.String(length=8), nullable=True),
        sa.Column("violation_date", sa.Date(), nullable=False),
        sa.Column("duty_unit", sa.String(length=120), nullable=True),
        sa.Column("details_text", sa.Text(), nullable=True),
        sa.Column("wing", sa.String(length=8), nullable=True),
        sa.Column("holding_no", sa.String(length=32), nullable=True),
        sa.Column("reporter_id", sa.String(length=16), nullable=True),
        sa.Column("reporter_name", sa.String(length=160), nullable=True),
        sa.Column("source_book_id", sa.Integer(), nullable=True),
        sa.Column("source_version_no", sa.Integer(), nullable=True),
        sa.Column("source_row_index", sa.Integer(), nullable=True),
        sa.Column("source_ref_number", sa.String(length=64), nullable=True),
        sa.Column("incomplete_marks", sa.JSON(), nullable=True),
        sa.Column("manual_reason", sa.Text(), nullable=True),
        sa.Column("manual_created_by", sa.Integer(), nullable=True),
        sa.Column("manual_created_by_name", sa.String(length=160), nullable=True),
        sa.Column("manual_created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("period_id", "row_handle", name="uq_inmate_violation_stat_rows_handle"),
        sa.CheckConstraint(
            "origin IN ('derived','manual')", name="ck_inmate_violation_stat_rows_origin"
        ),
        sa.CheckConstraint(
            "population IN ('citizens','expats','pending')",
            name="ck_inmate_violation_stat_rows_population",
        ),
    )
    op.create_index(
        "ix_inmate_violation_stat_rows_period_id",
        "inmate_violation_stat_rows",
        ["period_id"],
    )

    op.create_table(
        "inmate_violation_manual_rows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("violation_date", sa.Date(), nullable=False),
        sa.Column("uid", sa.String(length=64), nullable=True),
        sa.Column("nationality_label", sa.String(length=64), nullable=True),
        sa.Column("wing", sa.String(length=8), nullable=True),
        sa.Column("holding_no", sa.String(length=32), nullable=True),
        sa.Column("reporter_id", sa.String(length=16), nullable=True),
        sa.Column("details_text", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_inmate_violation_manual_rows_month"),
    )
    op.create_index(
        "ix_inmate_violation_manual_rows_month",
        "inmate_violation_manual_rows",
        ["year", "month"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_inmate_violation_manual_rows_month",
        table_name="inmate_violation_manual_rows",
    )
    op.drop_table("inmate_violation_manual_rows")
    op.drop_index(
        "ix_inmate_violation_stat_rows_period_id",
        table_name="inmate_violation_stat_rows",
    )
    op.drop_table("inmate_violation_stat_rows")
    op.drop_table("inmate_violation_periods")
