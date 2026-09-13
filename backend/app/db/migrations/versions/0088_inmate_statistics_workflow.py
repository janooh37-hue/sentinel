"""Add the inmate monthly report approval workflow.

Revision ID: 0088_inmate_statistics_workflow
Revises: 0087_vehicle_photo_library

Months closed before this revision keep their frozen rows and closure
metadata. They simply have no workflow row, which reads back as a closed month
with no recorded actors — the register renders those signature blocks empty
instead of inventing approvals that never happened.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0088_inmate_statistics_workflow"
down_revision = "0087_vehicle_photo_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inmate_violation_workflows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("state", sa.String(length=24), nullable=False, server_default="draft"),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column(
            "reviewer_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewer_employee_id", sa.String(length=16), nullable=True),
        sa.Column(
            "manager_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("manager_employee_id", sa.String(length=16), nullable=True),
        sa.Column("actors", sa.JSON(), nullable=False, server_default="{}"),
        sa.UniqueConstraint("year", "month", name="uq_inmate_violation_workflows_month"),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_inmate_violation_workflows_month"),
        sa.CheckConstraint("year BETWEEN 2000 AND 2100", name="ck_inmate_violation_workflows_year"),
        sa.CheckConstraint("version >= 0", name="ck_inmate_violation_workflows_version"),
        sa.CheckConstraint(
            "state IN ('draft','awaiting_review','awaiting_manager','closed')",
            name="ck_inmate_violation_workflows_state",
        ),
    )
    op.create_index(
        "ix_inmate_violation_workflows_reviewer",
        "inmate_violation_workflows",
        ["reviewer_user_id"],
    )
    op.create_index(
        "ix_inmate_violation_workflows_manager",
        "inmate_violation_workflows",
        ["manager_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_inmate_violation_workflows_manager", "inmate_violation_workflows")
    op.drop_index("ix_inmate_violation_workflows_reviewer", "inmate_violation_workflows")
    op.drop_table("inmate_violation_workflows")
