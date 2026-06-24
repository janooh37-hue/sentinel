"""book_attachments — add attachment_paths JSON column to books.

Revision ID: 0023_book_attachments
Revises: 0022_document_extractions
Create Date: 2026-05-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_book_attachments"
down_revision: str | Sequence[str] | None = "0022_document_extractions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("books") as batch_op:
        batch_op.add_column(
            sa.Column("attachment_paths", sa.JSON(), nullable=False, server_default="[]")
        )


def downgrade() -> None:
    with op.batch_alter_table("books") as batch_op:
        batch_op.drop_column("attachment_paths")
