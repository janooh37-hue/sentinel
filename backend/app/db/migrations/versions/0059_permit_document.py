"""security permits — add permits.document_path (issued-paper scan).

Revision ID: 0059
Revises: 0058
Create Date: 2026-07-21

Adds a nullable column holding the relative path to the scanned paper permit
(PDF / image) attached to a permit. Follows the same "path column, files on
disk under the data dir" approach as leaves.certificate_path.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0059"
down_revision: str | Sequence[str] | None = "0058"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.add_column(sa.Column("document_path", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.drop_column("document_path")
