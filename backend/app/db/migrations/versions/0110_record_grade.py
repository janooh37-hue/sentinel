"""Record grade and distribution replace confidentiality; priority becomes urgency.

ADR 0007. Upgrade maps each level to a fixed grade and a distribution:

    general  -> unclassified / organization
    directed -> unclassified / named
    personal -> unclassified / named (no recipients: only the creator opens it)
    secret   -> secret / organization

``books.priority`` becomes ``books.urgency`` with the same values, plus the new
``Very High``; the frozen ``book_versions.approval_context`` key ``priority``
becomes ``urgency``.

Downgrade LOSES INFORMATION: Top Secret and Addressee Only become ``secret``,
``Very High`` becomes ``High``, and a named record becomes ``directed`` when it
has any ``book_recipients`` row, otherwise ``personal``.

Revision ID: 0110_record_grade
Revises: 0109_book_folder_shares
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0110_record_grade"
down_revision: str | Sequence[str] | None = "0109_book_folder_shares"
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
GRADE_CHECK = "grade IN ('unclassified', 'secret', 'top_secret', 'addressee_only')"
DISTRIBUTION_CHECK = "distribution IN ('organization', 'named')"
URGENCY_CHECK = "urgency IN ('Normal', 'High', 'Very High')"
LEVEL_CHECK = "confidentiality IN ('general', 'personal', 'secret', 'directed')"


def _restore_books_fts_triggers() -> None:
    for sql in BOOKS_FTS_TRIGGER_SQL:
        op.execute(sql)


def _rename_context_key(old: str, new: str) -> None:
    op.execute(
        f"""
        UPDATE book_versions
        SET approval_context = json_set(
            json_remove(approval_context, '$.{old}'),
            '$.{new}',
            json_extract(approval_context, '$.{old}')
        )
        WHERE approval_context IS NOT NULL
          AND json_valid(approval_context)
          AND json_type(approval_context, '$.{old}') IS NOT NULL
        """
    )


def upgrade() -> None:
    with op.batch_alter_table("books") as batch:
        batch.add_column(
            sa.Column("grade", sa.String(length=16), nullable=False, server_default="unclassified")
        )
        batch.add_column(
            sa.Column(
                "distribution", sa.String(length=16), nullable=False, server_default="organization"
            )
        )
    op.execute(
        """
        UPDATE books SET
          grade = CASE confidentiality WHEN 'secret' THEN 'secret' ELSE 'unclassified' END,
          distribution = CASE
            WHEN confidentiality IN ('personal', 'directed') THEN 'named'
            ELSE 'organization'
          END
        """
    )
    with op.batch_alter_table("books") as batch:
        batch.drop_constraint("ck_books_confidentiality", type_="check")
        batch.drop_column("confidentiality")
        batch.alter_column(
            "priority",
            new_column_name="urgency",
            existing_type=sa.String(length=16),
            existing_nullable=False,
            existing_server_default="Normal",
        )
        batch.create_check_constraint("ck_books_grade", GRADE_CHECK)
        batch.create_check_constraint("ck_books_distribution", DISTRIBUTION_CHECK)
        batch.create_check_constraint("ck_books_urgency", URGENCY_CHECK)
    _rename_context_key("priority", "urgency")
    # Batch mode recreates `books`, which drops the FTS triggers.
    _restore_books_fts_triggers()


def downgrade() -> None:
    with op.batch_alter_table("books") as batch:
        batch.add_column(
            sa.Column(
                "confidentiality", sa.String(length=16), nullable=False, server_default="general"
            )
        )
    op.execute(
        """
        UPDATE books SET confidentiality = CASE
          WHEN grade != 'unclassified' THEN 'secret'
          WHEN distribution = 'organization' THEN 'general'
          WHEN EXISTS (SELECT 1 FROM book_recipients r WHERE r.book_id = books.id)
            THEN 'directed'
          ELSE 'personal'
        END
        """
    )
    op.execute("UPDATE books SET urgency = 'High' WHERE urgency = 'Very High'")
    op.execute(
        """
        UPDATE book_versions
        SET approval_context = json_set(approval_context, '$.urgency', 'High')
        WHERE approval_context IS NOT NULL
          AND json_valid(approval_context)
          AND json_extract(approval_context, '$.urgency') = 'Very High'
        """
    )
    _rename_context_key("urgency", "priority")
    with op.batch_alter_table("books") as batch:
        batch.drop_constraint("ck_books_urgency", type_="check")
        batch.drop_constraint("ck_books_distribution", type_="check")
        batch.drop_constraint("ck_books_grade", type_="check")
        batch.drop_column("distribution")
        batch.drop_column("grade")
        batch.alter_column(
            "urgency",
            new_column_name="priority",
            existing_type=sa.String(length=16),
            existing_nullable=False,
            existing_server_default="Normal",
        )
        batch.create_check_constraint("ck_books_confidentiality", LEVEL_CHECK)
    _restore_books_fts_triggers()
