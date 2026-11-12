"""Independent printed addressee, tracked with Ledger content.

Legacy saves remain NULL so historical papers and content hashes stay unchanged.
Downgrade discards the independent printed addressee.
"""

import sqlalchemy as sa
from alembic import op

revision = "0126_ledger_addressed_to"
down_revision = "0125_ledger_paper_preset"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("book_drafts") as batch:
        batch.add_column(
            sa.Column("addressed_to", sa.String(500), nullable=False, server_default="")
        )
    with op.batch_alter_table("ledger_book_saves") as batch:
        batch.add_column(sa.Column("addressed_to", sa.String(500), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    seq = int(bind.scalar(sa.text("SELECT seq FROM sqlite_sequence WHERE name='book_drafts'")) or 0)
    with op.batch_alter_table("ledger_book_saves") as batch:
        batch.drop_column("addressed_to")
    with op.batch_alter_table("book_drafts", table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.drop_column("addressed_to")
    result = bind.execute(
        sa.text("UPDATE sqlite_sequence SET seq=MAX(seq,:seq) WHERE name='book_drafts'"),
        {"seq": seq},
    )
    if not result.rowcount and seq:
        bind.execute(
            sa.text("INSERT INTO sqlite_sequence(name,seq) VALUES ('book_drafts',:seq)"),
            {"seq": seq},
        )
