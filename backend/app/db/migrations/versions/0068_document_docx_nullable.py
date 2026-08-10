"""allow PDF-only document rows

Revision ID: 0068
Revises: 0067
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0068"
down_revision: str | Sequence[str] | None = "0067"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.alter_column(
            "docx_path",
            existing_type=sa.String(512),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    null_count = bind.execute(
        sa.text("SELECT COUNT(*) FROM documents WHERE docx_path IS NULL")
    ).scalar_one()
    if null_count:
        raise RuntimeError("Cannot downgrade while PDF-only documents have no docx_path")
    with op.batch_alter_table("documents") as batch:
        batch.alter_column(
            "docx_path",
            existing_type=sa.String(512),
            nullable=False,
        )
