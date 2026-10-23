"""Departments, memberships, service lists and employee assignment.

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
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("departments.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.UniqueConstraint("parent_id", "name_en", name="uq_departments_parent_name_en"),
        sa.UniqueConstraint("parent_id", "name_ar", name="uq_departments_parent_name_ar"),
    )
    for language in ("en", "ar"):
        op.create_index(
            f"uq_departments_root_name_{language}",
            "departments",
            [f"name_{language}"],
            unique=True,
            sqlite_where=sa.text("parent_id IS NULL"),
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
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.UniqueConstraint("department_id", "user_id", name="uq_department_members_user"),
        sa.CheckConstraint(
            "role IN ('head', 'deputy', 'member')", name="ck_department_members_role"
        ),
    )
    op.create_index(
        "uq_department_members_primary",
        "department_members",
        ["user_id"],
        unique=True,
        sqlite_where=sa.text("is_primary = 1"),
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
    op.drop_table("department_members")
    op.drop_table("departments")
