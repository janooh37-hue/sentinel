"""document_extractions.created_at: add CURRENT_TIMESTAMP server_default.

Revision ID: 0029_document_extractions_created_default
Revises: 0028_ledger_fts_softdelete
Create Date: 2026-06-01

``created_at`` was created NOT NULL with no server_default (0022), so a raw
INSERT that omits the column fails. Mirror how ``documents.created_at`` was
done (0002): default it to ``CURRENT_TIMESTAMP`` at the DB level.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029_document_extractions_created_default"
down_revision: str | Sequence[str] | None = "0028_ledger_fts_softdelete"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("document_extractions") as batch:
        batch.alter_column(
            "created_at",
            existing_type=sa.DateTime(),
            existing_nullable=False,
            server_default=sa.func.current_timestamp(),
        )


def downgrade() -> None:
    with op.batch_alter_table("document_extractions") as batch:
        batch.alter_column(
            "created_at",
            existing_type=sa.DateTime(),
            existing_nullable=False,
            server_default=None,
        )
