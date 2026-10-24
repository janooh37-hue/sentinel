"""Stamp Records with their creator's derived org-tree department.

Revision ID: 0111_book_department
Revises: 0110_departments
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0111_book_department"
down_revision: str | Sequence[str] | None = "0110_departments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing SQLite tables use application-side integrity, not a new named FK.
    with op.batch_alter_table("books") as batch:
        batch.add_column(sa.Column("department_id", sa.Integer(), nullable=True))
        batch.create_index("ix_books_department_id", ["department_id"])
    # Creator user -> linked employee -> derived department (no-op on a fresh 0110).
    op.execute(
        "UPDATE books SET department_id = ("
        "SELECT employees.department_id FROM users "
        "JOIN employees ON employees.id = users.employee_id "
        "WHERE users.id = books.created_by_user_id) "
        "WHERE department_id IS NULL AND created_by_user_id IS NOT NULL"
    )


def downgrade() -> None:
    # Batch DROP COLUMN recreates the table and otherwise loses the FTS hooks.
    triggers: list[str] = list(
        op.get_bind()
        .execute(
            sa.text("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'books'")
        )
        .scalars()
    )
    with op.batch_alter_table("books") as batch:
        batch.drop_index("ix_books_department_id")
        batch.drop_column("department_id")
    for sql in triggers:
        op.execute(sql)
