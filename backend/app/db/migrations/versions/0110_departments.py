"""Departments anchored on org-tree heads, user grants, exceptions and services.

Revision ID: 0110_departments
Revises: 0109_book_folder_shares
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0110_departments"
down_revision: str | Sequence[str] | None = "0109_book_folder_shares"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "departments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name_en", sa.String(128), nullable=False),
        sa.Column("name_ar", sa.String(128), nullable=False),
        sa.Column(
            "head_employee_id",
            sa.String(16),
            sa.ForeignKey("employees.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        # Derived from the org tree; written only by department_tree_service.recompute.
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("departments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.UniqueConstraint("name_en", name="uq_departments_name_en"),
        sa.UniqueConstraint("name_ar", name="uq_departments_name_ar"),
        sa.UniqueConstraint("head_employee_id", name="uq_departments_head_employee_id"),
    )
    op.create_table(
        "department_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "department_id",
            sa.Integer(),
            sa.ForeignKey("departments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("role", sa.String(8), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.UniqueConstraint("department_id", "user_id", name="uq_department_members_user"),
        sa.CheckConstraint("role IN ('deputy', 'viewer')", name="ck_department_members_role"),
    )
    op.create_table(
        "department_exceptions",
        sa.Column(
            "employee_id",
            sa.String(16),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # NULL places the employee (and their branch) outside all departments.
        sa.Column(
            "department_id",
            sa.Integer(),
            sa.ForeignKey("departments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
    )
    op.create_table(
        "department_services",
        sa.Column(
            "department_id",
            sa.Integer(),
            sa.ForeignKey("departments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("service_id", sa.String(), primary_key=True),
    )
    # Existing tables use application-side integrity rather than new named FKs.
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("department_id", sa.Integer(), nullable=True))
        batch.create_index("ix_employees_department_id", ["department_id"])


def downgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.drop_index("ix_employees_department_id")
        batch.drop_column("department_id")
    op.drop_table("department_services")
    op.drop_table("department_exceptions")
    op.drop_table("department_members")
    op.drop_table("departments")
