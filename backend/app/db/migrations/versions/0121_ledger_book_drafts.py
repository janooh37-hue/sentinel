"""Ledger Book drafts, tracked Revision saves, and books.source_draft_id.

ADR 0007 (private Drafts, Save & Send) and ADR 0008 (tracked saves inside one
Revision). ``book_drafts`` holds a writer's private draft until Save & Send
creates the numbered ``books`` row; ``ledger_book_saves`` is the append-only
edit history of one Ledger Book Revision (``book_versions`` row).

``books.source_draft_id`` is added with a plain ``ADD COLUMN`` (no table
rebuild), so the ``books_fts`` triggers are untouched. Downgrade drops the two
tables and the column; their contents are lost.

Revision ID: 0121_ledger_book_drafts
Revises: 0120_record_grade
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0121_ledger_book_drafts"
down_revision: str | Sequence[str] | None = "0120_record_grade"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copies: later edits to app.core.grades must not change this revision.
GRADE_CHECK = "grade IN ('unclassified', 'secret', 'top_secret', 'addressee_only')"
URGENCY_CHECK = "urgency IN ('Normal', 'High', 'Very High')"
TAB_CHECK = "tab IS NULL OR (tab BETWEEN 1 AND 15)"


def upgrade() -> None:
    op.create_table(
        "book_drafts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("tab", sa.Integer(), nullable=True),
        sa.Column("grade", sa.String(length=16), nullable=False, server_default="unclassified"),
        sa.Column("urgency", sa.String(length=16), nullable=False, server_default="Normal"),
        sa.Column("subjects", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("body_html", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_book_drafts"),
        sa.CheckConstraint(TAB_CHECK, name="ck_book_drafts_tab"),
        sa.CheckConstraint(GRADE_CHECK, name="ck_book_drafts_grade"),
        sa.CheckConstraint(URGENCY_CHECK, name="ck_book_drafts_urgency"),
        # Never reuse a deleted draft's id: draft numbers and image URLs carry it.
        sqlite_autoincrement=True,
    )
    op.create_index("ix_book_drafts_owner_user_id", "book_drafts", ["owner_user_id"])

    op.create_table(
        "ledger_book_saves",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("saved_by_user_id", sa.Integer(), nullable=False),
        sa.Column(
            "saved_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("subjects", sa.JSON(), nullable=False),
        sa.Column("body_html", sa.Text(), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_ledger_book_saves"),
        sa.ForeignKeyConstraint(
            ["version_id"],
            ["book_versions.id"],
            name="fk_ledger_book_saves_version_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_ledger_book_saves_version_id", "ledger_book_saves", ["version_id"])

    op.add_column("books", sa.Column("source_draft_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    # Batch recreation drops triggers; retain their frozen database definitions.
    triggers = (
        op.get_bind()
        .execute(
            sa.text("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'books'")
        )
        .scalars()
        .all()
    )
    with op.batch_alter_table("books") as batch:
        batch.drop_column("source_draft_id")
    for sql in triggers:
        op.execute(sql)
    op.drop_index("ix_ledger_book_saves_version_id", table_name="ledger_book_saves")
    op.drop_table("ledger_book_saves")
    op.drop_index("ix_book_drafts_owner_user_id", table_name="book_drafts")
    op.drop_table("book_drafts")
