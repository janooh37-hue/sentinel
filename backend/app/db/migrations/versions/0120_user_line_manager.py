"""user line manager

Revision ID: 0120_user_line_manager
Revises: 0119_employee_former_ids
Create Date: 2026-11-16 00:00:00.000000

The approving account an administrator assigns to one fleet reporter account.
Not the org-tree supervisor (``employees.supervisor_id``).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0120_user_line_manager"
down_revision: str | Sequence[str] | None = "0119_employee_former_ids"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column(
                "line_manager_user_id",
                sa.Integer(),
                sa.ForeignKey(
                    "users.id",
                    name="fk_users_line_manager_user_id",
                    ondelete="SET NULL",
                ),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("line_manager_user_id")
