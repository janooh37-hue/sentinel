"""book_versions — version a Book across the approval cycle.

Creates book_versions, adds book_approval_steps.version_id, and backfills one
v1 per existing book (repointing existing steps to it).

Revision ID: 0024_book_versions
Revises: 0023_book_attachments
Create Date: 2026-05-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.db._0024_backfill_helpers import plan_backfill

revision: str = "0024_book_versions"
down_revision: str | Sequence[str] | None = "0023_book_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "book_versions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("book_id", sa.Integer(), sa.ForeignKey("books.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id", ondelete="SET NULL"), nullable=True),
        sa.Column("template_id", sa.String(length=64), nullable=True),
        sa.Column("fields", sa.JSON(), nullable=True),
        sa.Column("trigger", sa.String(length=16), nullable=False, server_default="initial"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="none"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("book_id", "version_no", name="uq_book_versions_book_version"),
    )
    op.create_index("ix_book_versions_book", "book_versions", ["book_id"])

    with op.batch_alter_table("book_approval_steps") as batch_op:
        batch_op.add_column(sa.Column("version_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_book_approval_steps_version_id",
            "book_versions",
            ["version_id"],
            ["id"],
            ondelete="CASCADE",
        )

    conn = op.get_bind()
    books = [dict(r._mapping) for r in conn.execute(sa.text(
        "SELECT id, ref_number, approval_state, created_at, submitted_by_user_id FROM books"
    ))]
    documents = [dict(r._mapping) for r in conn.execute(sa.text(
        "SELECT id, ref_number, role, template_id FROM documents"
    ))]
    steps = [dict(r._mapping) for r in conn.execute(sa.text(
        "SELECT id, book_id FROM book_approval_steps"
    ))]

    versions, step_updates = plan_backfill(books, documents, steps)

    for v in versions:
        conn.execute(sa.text(
            "INSERT INTO book_versions "
            "(book_id, version_no, document_id, template_id, fields, trigger, status, created_by_user_id, created_at) "
            "VALUES (:book_id, :version_no, :document_id, :template_id, :fields, :trigger, :status, :created_by_user_id, :created_at)"
        ), v)

    v1_by_book = {
        r._mapping["book_id"]: r._mapping["id"]
        for r in conn.execute(sa.text("SELECT id, book_id FROM book_versions WHERE version_no = 1"))
    }
    for su in step_updates:
        vid = v1_by_book.get(su["book_id"])
        if vid is not None:
            conn.execute(
                sa.text("UPDATE book_approval_steps SET version_id = :vid WHERE id = :sid"),
                {"vid": vid, "sid": su["step_id"]},
            )


def downgrade() -> None:
    with op.batch_alter_table("book_approval_steps") as batch_op:
        batch_op.drop_column("version_id")
    op.drop_index("ix_book_versions_book", table_name="book_versions")
    op.drop_table("book_versions")
