"""Ledger addressee snapshots and a draft signing manager.

Revision ID: 0124_ledger_addressees_signer
Revises: 0123_book_folder_box

Downgrade loses addressees and external/signer selections. Frozen SQL preserves
books FTS triggers and the draft AUTOINCREMENT high-water mark during rebuilds.
"""

import sqlalchemy as sa
from alembic import op

revision = "0124_ledger_addressees_signer"
down_revision = "0123_book_folder_box"
branch_labels = None
depends_on = None

BOOKS_FTS_TRIGGER_SQL = (
    "CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN INSERT INTO books_fts(rowid, search_text) VALUES (new.id, COALESCE(new.search_text, '')); END;",
    "CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN INSERT INTO books_fts(books_fts, rowid, search_text) VALUES ('delete', old.id, COALESCE(old.search_text, '')); END;",
    "CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE OF search_text ON books BEGIN INSERT INTO books_fts(books_fts, rowid, search_text) VALUES ('delete', old.id, COALESCE(old.search_text, '')); INSERT INTO books_fts(rowid, search_text) VALUES (new.id, COALESCE(new.search_text, '')); END;",
)


def _restore_fts() -> None:
    for sql in BOOKS_FTS_TRIGGER_SQL:
        op.execute(sql)


def upgrade() -> None:
    with op.batch_alter_table("book_drafts", table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.add_column(sa.Column("external", sa.Boolean(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("signer_manager_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("addressees", sa.JSON(), nullable=False, server_default="[]"))
    with op.batch_alter_table("books") as batch:
        batch.add_column(sa.Column("external", sa.Boolean(), nullable=False, server_default="0"))
    op.create_table(
        "book_addressees",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "book_id", sa.Integer(), sa.ForeignKey("books.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("role", sa.String(2), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("contact_id", sa.Integer(), nullable=True),
        sa.Column("name_ar", sa.String(256), nullable=True),
        sa.Column("name_en", sa.String(256), nullable=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.CheckConstraint("role IN ('to', 'cc')", name="ck_book_addressees_role"),
    )
    op.create_index("ix_book_addressees_book_id", "book_addressees", ["book_id"])


def downgrade() -> None:
    op.drop_table("book_addressees")
    with op.batch_alter_table("books") as batch:
        batch.drop_column("external")
    _restore_fts()
    bind = op.get_bind()
    seq = int(bind.scalar(sa.text("SELECT seq FROM sqlite_sequence WHERE name='book_drafts'")) or 0)
    with op.batch_alter_table("book_drafts", table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.drop_column("addressees")
        batch.drop_column("signer_manager_id")
        batch.drop_column("external")
    result = bind.execute(
        sa.text("UPDATE sqlite_sequence SET seq=MAX(seq,:seq) WHERE name='book_drafts'"),
        {"seq": seq},
    )
    if not result.rowcount and seq:
        bind.execute(
            sa.text("INSERT INTO sqlite_sequence(name,seq) VALUES ('book_drafts',:seq)"),
            {"seq": seq},
        )
