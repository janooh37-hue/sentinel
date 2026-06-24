"""documents table — add submission_id + role columns (Phase 04 P04-J).

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-20

Adds:
  - submission_id  VARCHAR(36) NOT NULL  — groups companion documents that
    were generated in a single call (same UUID per call).
  - role           VARCHAR(16) NOT NULL DEFAULT 'primary'  — 'primary' or
    'companion'.

Existing rows (from before P04-J) are backfilled:
  - submission_id = "legacy-{id}" left-padded to 36 chars.
  - role = 'primary'.

An index on submission_id is added for fast grouping.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch_op:
        # Add submission_id as nullable first so we can backfill, then set NOT NULL.
        batch_op.add_column(
            sa.Column("submission_id", sa.String(length=36), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "role",
                sa.String(length=16),
                nullable=False,
                server_default="primary",
            )
        )

    # Backfill submission_id for any pre-existing rows.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id FROM documents")).fetchall()
    for (row_id,) in rows:
        # Produce a deterministic unique string for each row.
        raw = f"legacy-{row_id}"
        # Pad to exactly 36 chars so it matches the VARCHAR(36) column width.
        padded = raw.ljust(36, "0")[:36]
        conn.execute(
            sa.text("UPDATE documents SET submission_id = :sid WHERE id = :id"),
            {"sid": padded, "id": row_id},
        )

    # Now make submission_id NOT NULL.
    with op.batch_alter_table("documents") as batch_op:
        batch_op.alter_column("submission_id", nullable=False)

    op.create_index("ix_documents_submission_id", "documents", ["submission_id"])


def downgrade() -> None:
    op.drop_index("ix_documents_submission_id", table_name="documents")
    with op.batch_alter_table("documents") as batch_op:
        batch_op.drop_column("submission_id")
        batch_op.drop_column("role")
