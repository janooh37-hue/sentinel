"""record included papers

Revision ID: 0068_record_included_papers
Revises: 0067
Create Date: 2026-08-10 10:34:34.915867
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0068_record_included_papers"
down_revision: str | Sequence[str] | None = "0067"
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


def _restore_books_fts_triggers() -> None:
    for sql in BOOKS_FTS_TRIGGER_SQL:
        op.execute(sql)


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("base_pdf_path", sa.Text(), nullable=True))

    with op.batch_alter_table("books") as batch:
        batch.add_column(
            sa.Column(
                "included_papers_revision",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )

    # SQLite batch recreation drops triggers attached to the old books table.
    _restore_books_fts_triggers()

    with op.batch_alter_table("book_versions") as batch:
        batch.add_column(sa.Column("signed_base_pdf_path", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column(
                "signed_embedded_paper_ids",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("book_versions") as batch:
        batch.drop_column("signed_embedded_paper_ids")
        batch.drop_column("signed_base_pdf_path")

    with op.batch_alter_table("books") as batch:
        batch.drop_column("included_papers_revision")

    _restore_books_fts_triggers()

    with op.batch_alter_table("documents") as batch:
        batch.drop_column("base_pdf_path")
