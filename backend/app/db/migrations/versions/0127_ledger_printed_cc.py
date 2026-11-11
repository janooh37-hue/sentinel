"""Independent printed CC, tracked with Ledger content.

Legacy saves remain NULL so historical papers and content hashes stay unchanged.
Downgrade discards the independent printed CC.
"""

import sqlalchemy as sa
from alembic import op

revision = "0127_ledger_printed_cc"
down_revision = "0126_ledger_addressed_to"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("book_drafts") as batch:
        batch.add_column(sa.Column("printed_cc", sa.JSON(), nullable=False, server_default="[]"))
    with op.batch_alter_table("ledger_book_saves") as batch:
        batch.add_column(sa.Column("printed_cc", sa.JSON(none_as_null=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    seq = int(bind.scalar(sa.text("SELECT seq FROM sqlite_sequence WHERE name='book_drafts'")) or 0)
    with op.batch_alter_table("ledger_book_saves") as batch:
        batch.drop_column("printed_cc")
    with op.batch_alter_table("book_drafts", table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.drop_column("printed_cc")
    result = bind.execute(
        sa.text("UPDATE sqlite_sequence SET seq=MAX(seq,:seq) WHERE name='book_drafts'"),
        {"seq": seq},
    )
    if not result.rowcount and seq:
        bind.execute(
            sa.text("INSERT INTO sqlite_sequence(name,seq) VALUES ('book_drafts',:seq)"),
            {"seq": seq},
        )
