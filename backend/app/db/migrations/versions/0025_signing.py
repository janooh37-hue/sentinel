"""signing — User.signature_path + BookVersion signing columns.

Revision ID: 0025_signing
Revises: 0024_book_versions
Create Date: 2026-05-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_signing"
down_revision: str | Sequence[str] | None = "0024_book_versions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("signature_path", sa.Text(), nullable=True))
    with op.batch_alter_table("book_versions") as b:
        b.add_column(sa.Column("signed_pdf_path", sa.Text(), nullable=True))
        b.add_column(sa.Column("manager_sig_embedded", sa.Boolean(), nullable=False, server_default="0"))
        b.add_column(sa.Column("signed_by_user_id", sa.Integer(), nullable=True))
        b.add_column(sa.Column("signed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("book_versions") as b:
        b.drop_column("signed_at")
        b.drop_column("signed_by_user_id")
        b.drop_column("manager_sig_embedded")
        b.drop_column("signed_pdf_path")
    with op.batch_alter_table("users") as b:
        b.drop_column("signature_path")
