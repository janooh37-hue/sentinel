"""Ledger→Outlook Phase 1: per-user mailboxes + recipient/message-id capture.

Revision ID: 0030_ledger_per_user_mailboxes
Revises: 0029_document_extractions_created_default
Create Date: 2026-06-07

email_accounts:
  + owner_user_id INT (nullable, indexed) — the signed-in user who owns this
    mailbox. The legacy single-row (id=1) account is back-filled to the user
    whose employee_id matches its linked_employee_id, when resolvable.

ledger_entries:
  + owner_user_id INT (nullable, indexed) — mailbox owner; NULL == shared log.
  + to_recipients / cc_recipients / bcc_recipients JSON (default '[]')
  + message_id STR (indexed), in_reply_to STR, email_references TEXT

Back-fill: existing email entries (channel='email') are stamped with the same
owner as the (single) legacy account so the current operator keeps seeing their
mail after the cut-over. Recipient columns stay empty until a re-sync repopulates
them (historical headers aren't stored) — see the plan's re-sync task.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030_ledger_per_user_mailboxes"
down_revision: str | Sequence[str] | None = "0029_document_extractions_created_default"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("email_accounts") as batch:
        batch.add_column(sa.Column("owner_user_id", sa.Integer(), nullable=True))
        batch.create_index("ix_email_accounts_owner_user_id", ["owner_user_id"])

    with op.batch_alter_table("ledger_entries") as batch:
        batch.add_column(sa.Column("owner_user_id", sa.Integer(), nullable=True))
        batch.add_column(
            sa.Column("to_recipients", sa.JSON(), nullable=False, server_default="[]")
        )
        batch.add_column(
            sa.Column("cc_recipients", sa.JSON(), nullable=False, server_default="[]")
        )
        batch.add_column(
            sa.Column("bcc_recipients", sa.JSON(), nullable=False, server_default="[]")
        )
        batch.add_column(sa.Column("message_id", sa.String(512), nullable=True))
        batch.add_column(sa.Column("in_reply_to", sa.String(512), nullable=True))
        batch.add_column(sa.Column("email_references", sa.Text(), nullable=True))
        batch.create_index("ix_ledger_entries_owner_user_id", ["owner_user_id"])
        batch.create_index("ix_ledger_entries_message_id", ["message_id"])

    bind = op.get_bind()
    # Back-fill the legacy single-row account's owner from its linked employee.
    owner_row = bind.execute(
        sa.text(
            "SELECT u.id AS user_id "
            "FROM email_accounts a "
            "JOIN users u ON u.employee_id = a.linked_employee_id "
            "WHERE a.id = 1 AND a.linked_employee_id IS NOT NULL "
            "LIMIT 1"
        )
    ).fetchone()
    if owner_row is not None:
        owner_id = owner_row.user_id
        bind.execute(
            sa.text("UPDATE email_accounts SET owner_user_id = :uid WHERE id = 1"),
            {"uid": owner_id},
        )
        # Stamp every existing email entry with that owner so the current
        # operator's mailbox isn't emptied by the new owner filter.
        bind.execute(
            sa.text(
                "UPDATE ledger_entries SET owner_user_id = :uid "
                "WHERE channel = 'email' AND owner_user_id IS NULL"
            ),
            {"uid": owner_id},
        )


def downgrade() -> None:
    with op.batch_alter_table("ledger_entries") as batch:
        batch.drop_index("ix_ledger_entries_message_id")
        batch.drop_index("ix_ledger_entries_owner_user_id")
        batch.drop_column("email_references")
        batch.drop_column("in_reply_to")
        batch.drop_column("message_id")
        batch.drop_column("bcc_recipients")
        batch.drop_column("cc_recipients")
        batch.drop_column("to_recipients")
        batch.drop_column("owner_user_id")

    with op.batch_alter_table("email_accounts") as batch:
        batch.drop_index("ix_email_accounts_owner_user_id")
        batch.drop_column("owner_user_id")
