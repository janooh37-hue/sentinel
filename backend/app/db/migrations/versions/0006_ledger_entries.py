"""ledger_entries table — Phase 07 new feature.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-20

A correspondence ledger — date-ordered log of every external/internal
communication (emails, phone calls, in-person meetings, faxes, letters).
This is a new greenfield feature with no v3 parity requirement.

Judgment call on 'direction' (Book.direction already uses 'incoming' /
'outgoing'): LedgerEntry adds 'internal' as a third value and the field
name avoids collision with the SQL keyword 'date' by using 'entry_date'.

Attachment paths and tags are stored as JSON columns (SQLite TEXT with
a JSON default) per the plan decision to defer normalisation to Phase 12.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ledger_entries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("direction", sa.String(16), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("counterparty", sa.String(255), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("notes_html", sa.Text(), nullable=True),
        # JSON columns stored as TEXT in SQLite; default is an empty JSON array.
        sa.Column(
            "attachment_paths",
            sa.JSON(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "tags",
            sa.JSON(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "related_book_id",
            sa.Integer(),
            sa.ForeignKey("books.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "related_employee_id",
            sa.String(16),
            sa.ForeignKey("employees.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        # Placeholder for Phase 25 auth — not enforced via FK yet.
        sa.Column("created_by", sa.String(64), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )

    op.create_index(
        "ix_ledger_entries_entry_date_desc",
        "ledger_entries",
        [sa.text("entry_date DESC")],
    )
    op.create_index(
        "ix_ledger_entries_counterparty",
        "ledger_entries",
        ["counterparty"],
    )
    op.create_index(
        "ix_ledger_entries_direction_channel",
        "ledger_entries",
        ["direction", "channel"],
    )


def downgrade() -> None:
    op.drop_index("ix_ledger_entries_direction_channel", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_counterparty", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_entry_date_desc", table_name="ledger_entries")
    op.drop_table("ledger_entries")
