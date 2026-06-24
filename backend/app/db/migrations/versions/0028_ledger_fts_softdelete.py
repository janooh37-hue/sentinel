"""ledger_entries_fts: drop soft-deleted rows from the index on UPDATE.

Revision ID: 0028_ledger_fts_softdelete
Revises: 0027_ledger_related_indexes
Create Date: 2026-06-01

The original ``ledger_entries_au`` trigger (0014) re-indexed the row on every
UPDATE regardless of ``deleted_at``, so a soft-deleted entry stayed in
``ledger_entries_fts``. The search query masks this with an
``le.deleted_at IS NULL`` JOIN filter, but the stale terms still bloat the
index and rely on that filter for correctness.

This redefines the AU trigger: it always deletes the old row's terms first,
then re-inserts only when the *new* row is live (``new.deleted_at IS NULL``).
A soft-delete (deleted_at NULL -> NOT NULL) therefore removes the row from the
index; an un-delete (NOT NULL -> NULL) re-adds it. INSERT/DELETE triggers are
unchanged.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0028_ledger_fts_softdelete"
down_revision: str | Sequence[str] | None = "0027_ledger_related_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_AU_DELETE_REINDEX = """
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
  SELECT
    new.id,
    new.subject,
    COALESCE(new.notes_html, ''),
    new.counterparty,
    COALESCE(new.tags, '')
  WHERE new.deleted_at IS NULL;
END;
"""

# The 0014 version — re-indexes unconditionally (used by downgrade).
_AU_REINDEX_ALWAYS = """
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


def upgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS ledger_entries_au;")
    op.execute(_AU_DELETE_REINDEX)
    # Purge any already-soft-deleted rows that the old trigger left indexed.
    op.execute(
        """
        INSERT INTO ledger_entries_fts(ledger_entries_fts, rowid, subject, notes_html, counterparty, tags)
        SELECT 'delete', id, subject, COALESCE(notes_html, ''), counterparty, COALESCE(tags, '')
        FROM ledger_entries
        WHERE deleted_at IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS ledger_entries_au;")
    op.execute(_AU_REINDEX_ALWAYS)
