"""Ledger paper preset, bottom-block references/folders and the Revision layout pin.

Revision ID: 0115_ledger_paper_preset
Revises: 0114_ledger_addressees_signer

Drafts gain ``paper_preset`` (``normal``/``report``), ``reference_book_ids``
and ``folder_ids``. Revisions gain ``paper_preset`` and ``paper_layout``, set
for Ledger Revisions only; existing Ledger Revisions are backfilled to
``normal``/1. The draft rebuild (for the CHECK) keeps the AUTOINCREMENT
high-water mark so a deleted draft's number is never reused. Downgrade loses
the preset, reference and folder selections.
"""

import sqlalchemy as sa
from alembic import op

revision = "0115_ledger_paper_preset"
down_revision = "0114_ledger_addressees_signer"
branch_labels = None
depends_on = None

LEDGER_TEMPLATE_ID = "Ledger Book"


def _draft_seq() -> int:
    bind = op.get_bind()
    return int(
        bind.scalar(sa.text("SELECT seq FROM sqlite_sequence WHERE name='book_drafts'")) or 0
    )


def _restore_draft_seq(seq: int) -> None:
    bind = op.get_bind()
    result = bind.execute(
        sa.text("UPDATE sqlite_sequence SET seq=MAX(seq,:seq) WHERE name='book_drafts'"),
        {"seq": seq},
    )
    if not result.rowcount and seq:
        bind.execute(
            sa.text("INSERT INTO sqlite_sequence(name,seq) VALUES ('book_drafts',:seq)"),
            {"seq": seq},
        )


def upgrade() -> None:
    seq = _draft_seq()
    with op.batch_alter_table("book_drafts", table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.add_column(
            sa.Column("paper_preset", sa.String(16), nullable=False, server_default="normal")
        )
        batch.add_column(
            sa.Column("reference_book_ids", sa.JSON(), nullable=False, server_default="[]")
        )
        batch.add_column(sa.Column("folder_ids", sa.JSON(), nullable=False, server_default="[]"))
        batch.create_check_constraint(
            "ck_book_drafts_paper_preset", "paper_preset IN ('normal', 'report')"
        )
    _restore_draft_seq(seq)
    with op.batch_alter_table("book_versions") as batch:
        batch.add_column(sa.Column("paper_preset", sa.String(16), nullable=True))
        batch.add_column(sa.Column("paper_layout", sa.Integer(), nullable=True))
    op.get_bind().execute(
        sa.text(
            "UPDATE book_versions SET paper_preset='normal', paper_layout=1 "
            "WHERE template_id=:template"
        ),
        {"template": LEDGER_TEMPLATE_ID},
    )


def downgrade() -> None:
    with op.batch_alter_table("book_versions") as batch:
        batch.drop_column("paper_layout")
        batch.drop_column("paper_preset")
    seq = _draft_seq()
    with op.batch_alter_table("book_drafts", table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.drop_constraint("ck_book_drafts_paper_preset", type_="check")
        batch.drop_column("folder_ids")
        batch.drop_column("reference_book_ids")
        batch.drop_column("paper_preset")
    _restore_draft_seq(seq)
