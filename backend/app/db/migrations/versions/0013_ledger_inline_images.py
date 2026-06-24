"""ledger_entries: inline_images JSON map + counterparty bare-email backfill.

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-21

Adds a nullable ``inline_images`` JSON column (default empty dict) on
``ledger_entries``. Maps email-part ``Content-ID`` values to the saved
attachment's relative path so the frontend can rewrite ``src="cid:..."``
references to real URLs.

Also runs a one-shot UPDATE that strips display names from existing
``counterparty`` values of the form ``"Display Name <addr@example.com>"``
so the bare address remains. Older entries imported without the angle
brackets are skipped — operator can re-sync to rebuild them.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("ledger_entries") as batch:
        batch.add_column(
            sa.Column(
                "inline_images",
                sa.JSON(),
                nullable=False,
                server_default="{}",
            )
        )

    op.execute(
        sa.text(
            "UPDATE ledger_entries "
            "SET counterparty = trim(substr(counterparty, "
            "                                instr(counterparty, '<') + 1, "
            "                                instr(counterparty, '>') - instr(counterparty, '<') - 1)) "
            "WHERE channel = 'email' "
            "  AND counterparty LIKE '%<%@%>%'"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("ledger_entries") as batch:
        batch.drop_column("inline_images")
