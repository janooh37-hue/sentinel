"""monthly time sheet

Revision ID: 0070_timesheet
Revises: 0069_merge
Create Date: 2026-08-19 00:00:00.000000

Adds the monthly time-sheet tables and the employee designation link. See
docs/superpowers/specs/2026-08-19-monthly-timesheet-design.md.

``timesheet_designations`` is seeded here with the 16 designations recovered
from the July 2026 workbooks: the catalog is reference data the feature cannot
run without, and ranks 1-8 mirror the order the client already accepted.
``employees.designation_id`` is left NULL — the history import backfills it.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0070_timesheet"
down_revision: str | Sequence[str] | None = "0069_merge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# rank, name_en, name_ar, sheet
DESIGNATION_SEED: tuple[tuple[int, str, str, str], ...] = (
    (1, "Prisons Director", "مدير عام الحراسات الأمنية", "main"),
    (2, "Ass. Director", "نائب عام مدير الحراسات الأمنية", "main"),
    (3, "Project Manager", "مديرمركز الإصلاح والتأهيل", "main"),
    (4, "Branche Manager", "مدير فرع", "main"),
    (5, "Duty In charge", "مناوب عام", "main"),
    (6, "Security Supervisor", "مشرف", "main"),
    (7, "Armory Officer", "مسؤول قطعة سلاح", "main"),
    (8, "assistant security supervisor", "مساعد مشرف", "main"),
    (9, "Armory Keeper", "خازن سلاح", "main"),
    (10, "Control room Security Guard", "حارس امن عرفة العمليات", "main"),
    (11, "Clinic Security Guard", "حارس امن حرس العيادة", "main"),
    (12, "Habilitation Security Guard", "حارس امن حرس التأهيل", "main"),
    (13, "Escort Security Guard", "حارس امن تنويم مستشفيات", "main"),
    (14, "Messengers", "حارس امن الارساليات", "main"),
    (15, "Security Guard", "حارس امن", "main"),
    (16, "Driver", "سائق", "drivers"),
)


def upgrade() -> None:
    op.create_table(
        "timesheet_designations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name_en", sa.String(128), nullable=False),
        sa.Column("name_ar", sa.String(128), nullable=False),
        sa.Column("rank_order", sa.Integer(), nullable=False),
        sa.Column("sheet", sa.String(16), nullable=False, server_default="main"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.UniqueConstraint("name_en", name="uq_timesheet_designations_name_en"),
        sa.UniqueConstraint("rank_order", name="uq_timesheet_designations_rank"),
        sa.CheckConstraint("sheet IN ('main', 'drivers')", name="ck_timesheet_desig_sheet"),
    )

    designations = sa.table(
        "timesheet_designations",
        sa.column("name_en", sa.String),
        sa.column("name_ar", sa.String),
        sa.column("rank_order", sa.Integer),
        sa.column("sheet", sa.String),
    )
    op.bulk_insert(
        designations,
        [
            {"rank_order": rank, "name_en": name_en, "name_ar": name_ar, "sheet": sheet}
            for rank, name_en, name_ar, sheet in DESIGNATION_SEED
        ],
    )

    # Plain ADD COLUMN, deliberately no FK: a nullable add is pure metadata in
    # SQLite, while creating the FK would force a full employees-table rewrite
    # under a live service. The designation link is enforced in the service
    # layer, like every other cross-domain integer ref in this schema.
    op.add_column("employees", sa.Column("designation_id", sa.Integer(), nullable=True))

    op.create_table(
        "absences",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("employee_id", "date", name="uq_absences_employee_date"),
    )
    op.create_index("ix_absences_date", "absences", ["date"])

    op.create_table(
        "timesheet_periods",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("post_count", sa.Integer(), nullable=False, server_default="249"),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_by", sa.Integer(), nullable=True),
        sa.Column("reopened_at", sa.DateTime(), nullable=True),
        sa.Column("reopened_by", sa.Integer(), nullable=True),
        sa.UniqueConstraint("year", "month", name="uq_timesheet_periods_year_month"),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_timesheet_periods_month"),
        sa.CheckConstraint("post_count >= 0", name="ck_timesheet_periods_post_count"),
    )

    op.create_table(
        "timesheet_overrides",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("day", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("code", sa.String(4), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "year", "month", "day", "employee_id", name="uq_timesheet_overrides_cell"
        ),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_timesheet_overrides_month"),
        sa.CheckConstraint("day BETWEEN 1 AND 31", name="ck_timesheet_overrides_day"),
    )

    op.create_table(
        "timesheet_snapshot_rows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "period_id",
            sa.Integer(),
            sa.ForeignKey("timesheet_periods.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("employee_id", sa.String(16), nullable=False),
        sa.Column("row_no", sa.Integer(), nullable=False),
        sa.Column("name_en", sa.String(256), nullable=False),
        sa.Column("nationality_en", sa.String(64), nullable=True),
        sa.Column("designation_en", sa.String(128), nullable=True),
        sa.Column("designation_ar", sa.String(128), nullable=True),
        sa.Column("rank_order", sa.Integer(), nullable=True),
        sa.Column("sheet", sa.String(16), nullable=False, server_default="main"),
        sa.Column("codes", sa.JSON(), nullable=False),
        sa.Column("stat_codes", sa.JSON(), nullable=False),
        sa.Column("stat_block", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("period_id", "employee_id", "sheet", name="uq_timesheet_snapshot_row"),
    )
    op.create_index(
        "ix_timesheet_snapshot_period_sheet", "timesheet_snapshot_rows", ["period_id", "sheet"]
    )


def downgrade() -> None:
    op.drop_index("ix_timesheet_snapshot_period_sheet", table_name="timesheet_snapshot_rows")
    op.drop_table("timesheet_snapshot_rows")
    op.drop_table("timesheet_overrides")
    op.drop_table("timesheet_periods")
    op.drop_index("ix_absences_date", table_name="absences")
    op.drop_table("absences")

    # No FK to drop; batch recreation is still required because SQLite cannot
    # DROP COLUMN in place on the versions this schema targets.
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("designation_id")

    op.drop_table("timesheet_designations")
