"""scan_inbox table — ambient OCR triage queue (Phase 1).

Revision ID: 0038_scan_inbox
Revises: 0037_employee_duty_columns
Create Date: 2026-06-22

New table ``scan_inbox`` — one row per inbound document awaiting OCR-triage.
Additive only; downgrade drops the table.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0038_scan_inbox"
down_revision: str | Sequence[str] | None = "0037_employee_duty_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scan_inbox",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("ledger_entry_id", sa.Integer(), sa.ForeignKey("ledger_entries.id", ondelete="SET NULL"), nullable=True),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("state", sa.String(length=24), nullable=False, server_default="pending_ocr"),
        sa.Column("document_type", sa.String(length=32), nullable=True),
        sa.Column("fields", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column("qr_refs", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("proposed_route", sa.String(length=24), nullable=True),
        sa.Column("proposed_employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("proposed_book_id", sa.Integer(), sa.ForeignKey("books.id"), nullable=True),
        sa.Column("proposed_ref", sa.String(length=32), nullable=True),
        sa.Column("match_score", sa.Float(), nullable=True),
        sa.Column("confidence_tier", sa.String(length=8), nullable=True),
        sa.Column("model_version", sa.String(length=32), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("undo_token", sa.String(length=256), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by", sa.Integer(), nullable=True),
        sa.Column("resolution", sa.String(length=24), nullable=True),
        sa.Column("error_detail", sa.String(length=512), nullable=True),
    )
    op.create_index("ix_scan_inbox_state", "scan_inbox", ["state"])
    op.create_index("ix_scan_inbox_owner_state", "scan_inbox", ["owner_user_id", "state"])
    op.create_index("ix_scan_inbox_content_hash", "scan_inbox", ["content_hash"])


def downgrade() -> None:
    op.drop_index("ix_scan_inbox_content_hash", table_name="scan_inbox")
    op.drop_index("ix_scan_inbox_owner_state", table_name="scan_inbox")
    op.drop_index("ix_scan_inbox_state", table_name="scan_inbox")
    op.drop_table("scan_inbox")
