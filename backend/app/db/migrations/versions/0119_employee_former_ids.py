"""Retain employee number correction history and reserve former numbers."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0119_employee_former_ids"
down_revision: str | Sequence[str] | None = "0118_drop_record_category_overreach"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "employee_former_ids",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "employee_id",
            sa.String(16),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("former_id", sa.String(16), nullable=False),
        sa.Column("new_id", sa.String(16), nullable=False),
        sa.Column("changed_at", sa.DateTime(), nullable=False),
        sa.Column(
            "changed_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
    )
    op.create_index("ix_employee_former_ids_employee_id", "employee_former_ids", ["employee_id"])
    op.create_index("ix_employee_former_ids_former_id", "employee_former_ids", ["former_id"])


def downgrade() -> None:
    op.drop_index("ix_employee_former_ids_former_id", table_name="employee_former_ids")
    op.drop_index("ix_employee_former_ids_employee_id", table_name="employee_former_ids")
    op.drop_table("employee_former_ids")
