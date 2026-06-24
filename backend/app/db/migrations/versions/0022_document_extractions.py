"""document_extractions table + employee expiry/iban columns

Revision ID: 0022_document_extractions
Revises: 0021
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_document_extractions"
down_revision: str | Sequence[str] | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("uae_id_expiry", sa.Date(), nullable=True))
    op.add_column("employees", sa.Column("passport_expiry", sa.Date(), nullable=True))
    op.add_column("employees", sa.Column("iban", sa.String(length=34), nullable=True))

    op.create_table(
        "document_extractions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("document_type", sa.String(length=32), nullable=False),
        sa.Column("fields", sa.JSON(), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column("language", sa.String(length=16), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("source_file", sa.String(length=512), nullable=True),
        sa.Column("model_version", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("document_extractions")
    op.drop_column("employees", "iban")
    op.drop_column("employees", "passport_expiry")
    op.drop_column("employees", "uae_id_expiry")
