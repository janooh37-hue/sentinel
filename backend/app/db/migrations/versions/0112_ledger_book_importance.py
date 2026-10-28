"""Ledger Book Importance replaces draft urgency.

ADR 0008 (Importance). ``book_drafts.importance`` and ``books.importance`` are
nullable ``medium`` / ``high`` marks: NULL means no importance, and every
non-Ledger record keeps NULL. Ledger Books do not use Urgency, so
``book_drafts.urgency`` (and its check) is dropped; ``books.urgency`` stays for
Word records, and Ledger Books keep its default ``Normal``.

Batch mode recreates ``books``, which drops the FTS triggers; both directions
restore them. ``book_drafts`` is rebuilt with AUTOINCREMENT kept.

Downgrade LOSES INFORMATION: every importance is dropped, and restored drafts
get urgency ``Normal``.

Revision ID: 0112_ledger_book_importance
Revises: 0111_ledger_book_drafts
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0112_ledger_book_importance"
down_revision: str | Sequence[str] | None = "0111_ledger_book_drafts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BOOKS_FTS_TRIGGER_SQL = (
    """
    CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
      INSERT INTO books_fts(rowid, search_text)
      VALUES (new.id, COALESCE(new.search_text, ''));
    END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
      INSERT INTO books_fts(books_fts, rowid, search_text)
      VALUES ('delete', old.id, COALESCE(old.search_text, ''));
    END;
    """,
    """
    CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE OF search_text ON books BEGIN
      INSERT INTO books_fts(books_fts, rowid, search_text)
      VALUES ('delete', old.id, COALESCE(old.search_text, ''));
      INSERT INTO books_fts(rowid, search_text)
      VALUES (new.id, COALESCE(new.search_text, ''));
    END;
    """,
)

# Frozen copies: later edits to app.core.grades must not change this revision.
IMPORTANCE_CHECK = "importance IN ('medium', 'high')"
URGENCY_CHECK = "urgency IN ('Normal', 'High', 'Very High')"
# The rebuilt table keeps AUTOINCREMENT: draft numbers and image URLs carry the id.
DRAFTS_TABLE_KWARGS = {"sqlite_autoincrement": True}


def _restore_books_fts_triggers() -> None:
    for sql in BOOKS_FTS_TRIGGER_SQL:
        op.execute(sql)


def upgrade() -> None:
    with op.batch_alter_table("book_drafts", table_kwargs=DRAFTS_TABLE_KWARGS) as batch:
        batch.drop_constraint("ck_book_drafts_urgency", type_="check")
        batch.drop_column("urgency")
        batch.add_column(sa.Column("importance", sa.String(length=8), nullable=True))
        batch.create_check_constraint("ck_book_drafts_importance", IMPORTANCE_CHECK)
    with op.batch_alter_table("books") as batch:
        batch.add_column(sa.Column("importance", sa.String(length=8), nullable=True))
        batch.create_check_constraint("ck_books_importance", IMPORTANCE_CHECK)
    _restore_books_fts_triggers()


def downgrade() -> None:
    with op.batch_alter_table("books") as batch:
        batch.drop_constraint("ck_books_importance", type_="check")
        batch.drop_column("importance")
    _restore_books_fts_triggers()
    with op.batch_alter_table("book_drafts", table_kwargs=DRAFTS_TABLE_KWARGS) as batch:
        batch.drop_constraint("ck_book_drafts_importance", type_="check")
        batch.drop_column("importance")
        batch.add_column(
            sa.Column("urgency", sa.String(length=16), nullable=False, server_default="Normal")
        )
        batch.create_check_constraint("ck_book_drafts_urgency", URGENCY_CHECK)
