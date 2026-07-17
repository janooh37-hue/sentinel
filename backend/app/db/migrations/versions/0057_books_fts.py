"""books: search_text column + books_fts FTS5 virtual table + sync triggers.

Revision ID: 0057
Revises: 0056
Create Date: 2026-07-17

Adds:

1. ``books.search_text`` — nullable Text column.  Task 15 will populate this
   with a normalised subject+ref+body string; the FTS index tracks it from
   day one via triggers.

2. ``books_fts`` — SQLite FTS5 virtual table over ``search_text``,
   tokenised with ``unicode61 remove_diacritics 2`` so Arabic search hits
   both accented and unaccented forms.  ``content='books'`` /
   ``content_rowid='id'`` makes it an external-content index (no row
   duplication on disk).

3. Three triggers — ai/ad/au — keep the FTS index in sync with
   ``books.search_text``.  The update trigger uses the FTS5 "delete + insert"
   pattern documented in the SQLite manual so old terms are removed before
   new terms are added.

FTS5 availability is verified on this install (SQLite 3.50.4,
``ENABLE_FTS5``). No fallback path required.  Pattern mirrors 0014_ledger_fts5.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0057"
down_revision: str | Sequence[str] | None = "0056"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ---------------------------------------------------------------------------
# SQL constants — imported by the test suite so the test always exercises
# the exact same DDL that Alembic runs.
# ---------------------------------------------------------------------------

UPGRADE_SQL: list[str] = [
    """
    CREATE VIRTUAL TABLE books_fts USING fts5(
      search_text,
      content='books',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );
    """,
    """
    CREATE TRIGGER books_ai AFTER INSERT ON books BEGIN
      INSERT INTO books_fts(rowid, search_text)
      VALUES (new.id, COALESCE(new.search_text, ''));
    END;
    """,
    """
    CREATE TRIGGER books_ad AFTER DELETE ON books BEGIN
      INSERT INTO books_fts(books_fts, rowid, search_text)
      VALUES ('delete', old.id, COALESCE(old.search_text, ''));
    END;
    """,
    """
    CREATE TRIGGER books_au AFTER UPDATE OF search_text ON books BEGIN
      INSERT INTO books_fts(books_fts, rowid, search_text)
      VALUES ('delete', old.id, COALESCE(old.search_text, ''));
      INSERT INTO books_fts(rowid, search_text)
      VALUES (new.id, COALESCE(new.search_text, ''));
    END;
    """,
    "INSERT INTO books_fts(books_fts) VALUES('rebuild');",
]


def upgrade() -> None:
    with op.batch_alter_table("books") as batch:
        batch.add_column(sa.Column("search_text", sa.Text(), nullable=True))

    for sql in UPGRADE_SQL:
        op.execute(sql)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS books_au;")
    op.execute("DROP TRIGGER IF EXISTS books_ad;")
    op.execute("DROP TRIGGER IF EXISTS books_ai;")
    op.execute("DROP TABLE IF EXISTS books_fts;")
    with op.batch_alter_table("books") as batch:
        batch.drop_column("search_text")
