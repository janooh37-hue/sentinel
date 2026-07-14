"""ledger_flags table — per-user follow-up flags (ledger smart-folders port)

Revision ID: 0054
Revises: 0053

Per-user flag rows (user_id + entry_id) so each person flags independently in
the private inbox. Additive only; downgrade drops the table.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ledger_flags",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "entry_id",
            sa.Integer(),
            sa.ForeignKey("ledger_entries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("flagged_at", sa.DateTime(), nullable=False),
        sa.Column("followup_due", sa.Date(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.UniqueConstraint(
            "user_id", "entry_id", name="uq_ledger_flags_user_entry"
        ),
    )
    op.create_index("ix_ledger_flags_user_id", "ledger_flags", ["user_id"])
    op.create_index("ix_ledger_flags_entry_id", "ledger_flags", ["entry_id"])


def downgrade() -> None:
    op.drop_index("ix_ledger_flags_entry_id", table_name="ledger_flags")
    op.drop_index("ix_ledger_flags_user_id", table_name="ledger_flags")
    op.drop_table("ledger_flags")
