"""Add books.created_by_user_id (immutable creator) and backfill it.

Revision ID: 0094_book_created_by
Revises: 0093_password_setup
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0094_book_created_by"
down_revision: str | Sequence[str] | None = "0093_password_setup"
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
    # No FK to users.id: SQLite batch ALTER cannot add a named FK constraint to
    # an existing table; integrity is enforced at the app layer.
    with op.batch_alter_table("books") as batch:
        batch.add_column(sa.Column("created_by_user_id", sa.Integer(), nullable=True))
        batch.create_index("ix_books_created_by_user_id", ["created_by_user_id"])

    # SQLite batch recreation drops triggers attached to the old books table.
    _restore_books_fts_triggers()

    # Backfill precedence: v1 version creator, then the earliest Word edit
    # session user, then the submitter. Ledger `created_by` is a G-number string
    # that is overwritten on revise, so it is deliberately excluded.
    op.execute(
        sa.text(
            """
            UPDATE books
            SET created_by_user_id = COALESCE(
                (
                    SELECT v.created_by_user_id
                    FROM book_versions AS v
                    WHERE v.book_id = books.id
                      AND v.version_no = (
                          SELECT MIN(c.version_no)
                          FROM book_versions AS c
                          WHERE c.book_id = books.id
                      )
                ),
                (
                    SELECT s.user_id
                    FROM book_edit_sessions AS s
                    WHERE s.book_id = books.id
                    ORDER BY s.created_at ASC, s.id ASC
                    LIMIT 1
                ),
                books.submitted_by_user_id
            )
            WHERE created_by_user_id IS NULL
            """
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("books") as batch:
        batch.drop_index("ix_books_created_by_user_id")
        batch.drop_column("created_by_user_id")

    _restore_books_fts_triggers()
