"""documents table — Phase 04 schema.

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-20

Adds the `documents` table that records every generated DOCX/PDF, linking
it back to the employee and (optionally) to the leave or violation row that
the generation created.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), nullable=False),
        sa.Column("template_id", sa.String(length=64), nullable=False),
        sa.Column("ref_number", sa.String(length=32), nullable=False),
        sa.Column("docx_path", sa.String(length=512), nullable=False),
        sa.Column("pdf_path", sa.String(length=512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("leave_id", sa.Integer(), nullable=True),
        sa.Column("violation_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["leave_id"],
            ["leaves.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["violation_id"],
            ["violations.id"],
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_documents_employee_id", "documents", ["employee_id"])
    op.create_index("ix_documents_created_at", "documents", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_documents_created_at", table_name="documents")
    op.drop_index("ix_documents_employee_id", table_name="documents")
    op.drop_table("documents")
