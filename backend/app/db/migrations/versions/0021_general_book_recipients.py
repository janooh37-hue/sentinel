"""general_book_recipients table + nullable documents.employee_id.

Revision ID: 0021
Revises: 0020
Create Date: 2026-05-28

Two related changes wired together so the General Book "unbound" flow works
end-to-end:

  1. New ``general_book_recipients`` table — small lookup list backing the
     ``{{ recipient_name }}`` picker. Unique on ``name``.

  2. ``documents.employee_id`` becomes nullable. Admin-category forms
     (General Book) can now generate without a bound employee; the Document
     row that records the generation event therefore must accept a NULL FK.

Additive only. Existing rows in ``documents`` keep their employee_id; the
column simply loosens from NOT NULL → NULL.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | Sequence[str] | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "general_book_recipients" not in insp.get_table_names():
        op.create_table(
            "general_book_recipients",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=256), nullable=False),
            sa.Column("name_ar", sa.String(length=256), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("name", name="uq_general_book_recipients_name"),
        )
    # Loosen documents.employee_id to nullable. SQLite needs a batch op to
    # rewrite the column; other DBs accept the plain alter_column.
    with op.batch_alter_table("documents") as batch_op:
        batch_op.alter_column(
            "employee_id",
            existing_type=sa.String(length=16),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    # Best-effort: re-tighten employee_id (will fail if NULL rows exist by then).
    with op.batch_alter_table("documents") as batch_op:
        batch_op.alter_column(
            "employee_id",
            existing_type=sa.String(length=16),
            nullable=False,
        )
    if "general_book_recipients" in insp.get_table_names():
        op.drop_table("general_book_recipients")
