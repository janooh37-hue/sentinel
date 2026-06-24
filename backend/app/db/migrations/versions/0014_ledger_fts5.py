"""ledger_entries: FTS5 virtual table + draft_meta JSON column.

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-21

Adds:

1. ``ledger_entries.draft_meta`` — nullable JSON column. Drafts re-use the
   ``LedgerEntry`` row with ``tag='draft'``; ``draft_meta`` holds the
   to/cc/in_reply_to/references that aren't first-class on the row, so a
   "load draft" call can reconstruct the compose payload.

2. ``ledger_entries_fts`` — SQLite FTS5 virtual table over the four
   searchable text columns (subject, notes_html, counterparty, tags),
   tokenised with ``unicode61 remove_diacritics 2`` so Arabic search hits
   the accented and unaccented form. ``content='ledger_entries'`` /
   ``content_rowid='id'`` makes the table an external-content index
   (no row duplication on disk).

3. Three triggers — ai/ad/au — keep the FTS index in sync. The update
   trigger uses the FTS5 "delete + insert" pattern documented in the
   SQLite manual so the index drops the old terms before adding the new.

FTS5 availability is verified on this install (SQLite 3.50.4,
``ENABLE_FTS5``). No fallback path required.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("ledger_entries") as batch:
        batch.add_column(
            sa.Column("draft_meta", sa.JSON(), nullable=True)
        )

    op.execute(
        """
        CREATE VIRTUAL TABLE ledger_entries_fts USING fts5(
          subject,
          notes_html,
          counterparty,
          tags,
          content='ledger_entries',
          content_rowid='id',
          tokenize='unicode61 remove_diacritics 2'
        );
        """
    )

    op.execute(
        """
        CREATE TRIGGER ledger_entries_ai AFTER INSERT ON ledger_entries BEGIN
          INSERT INTO ledger_entries_fts(rowid, subject, notes_html, counterparty, tags)
          VALUES (
            new.id,
            new.subject,
            COALESCE(new.notes_html, ''),
            new.counterparty,
            COALESCE(new.tags, '')
          );
        END;
        """
    )

    op.execute(
        """
        CREATE TRIGGER ledger_entries_ad AFTER DELETE ON ledger_entries BEGIN
          INSERT INTO ledger_entries_fts(ledger_entries_fts, rowid, subject, notes_html, counterparty, tags)
          VALUES (
            'delete',
            old.id,
            old.subject,
            COALESCE(old.notes_html, ''),
            old.counterparty,
            COALESCE(old.tags, '')
          );
        END;
        """
    )

    op.execute(
        """
        CREATE TRIGGER ledger_entries_au AFTER UPDATE ON ledger_entries BEGIN
          INSERT INTO ledger_entries_fts(ledger_entries_fts, rowid, subject, notes_html, counterparty, tags)
          VALUES (
            'delete',
            old.id,
            old.subject,
            COALESCE(old.notes_html, ''),
            old.counterparty,
            COALESCE(old.tags, '')
          );
          INSERT INTO ledger_entries_fts(rowid, subject, notes_html, counterparty, tags)
          VALUES (
            new.id,
            new.subject,
            COALESCE(new.notes_html, ''),
            new.counterparty,
            COALESCE(new.tags, '')
          );
        END;
        """
    )

    op.execute("INSERT INTO ledger_entries_fts(ledger_entries_fts) VALUES('rebuild');")


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS ledger_entries_au;")
    op.execute("DROP TRIGGER IF EXISTS ledger_entries_ad;")
    op.execute("DROP TRIGGER IF EXISTS ledger_entries_ai;")
    op.execute("DROP TABLE IF EXISTS ledger_entries_fts;")
    with op.batch_alter_table("ledger_entries") as batch:
        batch.drop_column("draft_meta")
