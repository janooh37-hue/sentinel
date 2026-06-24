"""Leave return-form columns (Duty Resumption completion).

Revision ID: 0036_leave_return_columns
Revises: 0035_canonical_leave_statuses
Create Date: 2026-06-13

leaves:
  + return_doc_path TEXT NULL — relative path to the filed Duty Resumption doc;
    presence marks "return filed".
  + return_date DATE NULL — the resumption (return-to-work) date captured when
    the return form was filed.

Additive only; downgrade drops both columns.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0036_leave_return_columns"
down_revision: str | Sequence[str] | None = "0035_canonical_leave_statuses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("leaves") as batch:
        batch.add_column(sa.Column("return_doc_path", sa.Text(), nullable=True))
        batch.add_column(sa.Column("return_date", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("leaves") as batch:
        batch.drop_column("return_date")
        batch.drop_column("return_doc_path")
