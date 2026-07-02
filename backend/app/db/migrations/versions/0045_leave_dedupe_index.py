"""Partial unique index blocking duplicate leave rows.

Backstop for the app-level dedup guard (audit 2026-07-02). Assumes existing
duplicates were already cleaned up (scripts/dedupe_leaves.py) — creating a
unique index while duplicates exist would fail.

Revision ID: 0045_leave_dedupe_index
Revises: 0044_sms_messages
Create Date: 2026-07-02
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0045_leave_dedupe_index"
down_revision: str | Sequence[str] | None = "0044_sms_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_leaves_natural_key "
        "ON leaves (employee_id, leave_type, start_date, end_date) "
        "WHERE deleted_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_leaves_natural_key")
