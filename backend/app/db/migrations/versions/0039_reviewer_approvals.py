"""Reviewer role + manager-routed approvals + seen tracking.

Revision ID: 0039_reviewer_approvals
Revises: 0038_scan_inbox
Create Date: 2026-06-23

managers            + user_id INTEGER NULL — linked login account (auto-route)
books               + doc_manager_id INTEGER NULL — Manager printed on the doc
book_approval_steps + kind VARCHAR(16) NOT NULL DEFAULT 'approver'
                    + seen_at DATETIME NULL

Additive only; FK constraints omitted (SQLite batch ALTER limitation — app-layer
integrity, mirrors books.submitted_by_user_id). Downgrade drops the columns.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039_reviewer_approvals"
down_revision: str | Sequence[str] | None = "0038_scan_inbox"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("managers") as batch:
        batch.add_column(sa.Column("user_id", sa.Integer(), nullable=True))
    with op.batch_alter_table("books") as batch:
        batch.add_column(sa.Column("doc_manager_id", sa.Integer(), nullable=True))
    with op.batch_alter_table("book_approval_steps") as batch:
        batch.add_column(
            sa.Column("kind", sa.String(16), nullable=False, server_default="approver")
        )
        batch.add_column(sa.Column("seen_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("book_approval_steps") as batch:
        batch.drop_column("seen_at")
        batch.drop_column("kind")
    with op.batch_alter_table("books") as batch:
        batch.drop_column("doc_manager_id")
    with op.batch_alter_table("managers") as batch:
        batch.drop_column("user_id")
