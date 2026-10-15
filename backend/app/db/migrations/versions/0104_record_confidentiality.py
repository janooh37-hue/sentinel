"""Record confidentiality level and direct-send recipients.

Revision ID: 0104_record_confidentiality
Revises: 0103_odometer_optional_closing
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0104_record_confidentiality"
down_revision: str | Sequence[str] | None = "0103_odometer_optional_closing"
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
    # The CHECK constraint makes batch mode recreate `books`, which drops the
    # FTS triggers; restore them afterwards (IF NOT EXISTS also repairs 0098).
    with op.batch_alter_table("books") as batch:
        batch.add_column(
            sa.Column(
                "confidentiality",
                sa.String(length=16),
                nullable=False,
                server_default="general",
            )
        )
        batch.create_check_constraint(
            "ck_books_confidentiality",
            "confidentiality IN ('general', 'personal', 'secret', 'directed')",
        )
    _restore_books_fts_triggers()

    op.create_table(
        "book_recipients",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "book_id",
            sa.Integer(),
            sa.ForeignKey("books.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("sent_by_user_id", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(length=16), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_user_id", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('info', 'action', 'reply', 'sign')",
            name="ck_book_recipients_purpose",
        ),
    )
    op.create_index("ix_book_recipients_user_revoked", "book_recipients", ["user_id", "revoked_at"])
    op.create_index("ix_book_recipients_book", "book_recipients", ["book_id"])
    op.create_index(
        "uq_book_recipients_active",
        "book_recipients",
        ["book_id", "user_id"],
        unique=True,
        sqlite_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_book_recipients_active", table_name="book_recipients")
    op.drop_index("ix_book_recipients_book", table_name="book_recipients")
    op.drop_index("ix_book_recipients_user_revoked", table_name="book_recipients")
    op.drop_table("book_recipients")

    with op.batch_alter_table("books") as batch:
        batch.drop_constraint("ck_books_confidentiality", type_="check")
        batch.drop_column("confidentiality")
    _restore_books_fts_triggers()
