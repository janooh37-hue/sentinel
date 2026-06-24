"""leaves table — add notes column.

Revision ID: 0019
Revises: 0018
Create Date: 2026-05-26

The PATCH /leaves/{id} endpoint accepts a ``notes`` field but the column never
existed, so notes were silently discarded. This adds the backing column so
notes persist and round-trip through LeaveRead.

  - leaves.notes  TEXT NULL  — free-text note attached on status edits.

Additive only — existing rows get NULL.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | Sequence[str] | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("leaves") as batch_op:
        batch_op.add_column(
            sa.Column("notes", sa.Text(), nullable=True, server_default=None)
        )


def downgrade() -> None:
    with op.batch_alter_table("leaves") as batch_op:
        batch_op.drop_column("notes")
