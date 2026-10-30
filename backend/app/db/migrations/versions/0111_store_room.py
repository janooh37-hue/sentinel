"""Store handovers, item drawings, aliases and delivery-note quantities.

Revision ID: 0111_store_room
Revises: 0110_store

Downgrade deletes zero-quantity delivery lines (stock-neutral note-only rows)
before restoring the previous positive-quantity constraint.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0111_store_room"
down_revision: str | Sequence[str] | None = "0110_store"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
    )


def upgrade() -> None:
    with op.batch_alter_table("store_items") as batch:
        batch.add_column(sa.Column("art_kind", sa.String(24), nullable=True))
        batch.add_column(sa.Column("art_color", sa.String(7), nullable=True))
    with op.batch_alter_table("store_delivery_lines", recreate="always") as batch:
        batch.add_column(sa.Column("noted_quantity", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("difference_reason", sa.String(200), nullable=True))
        batch.drop_constraint("ck_store_delivery_lines_quantity", type_="check")
        batch.create_check_constraint("ck_store_delivery_lines_quantity", "quantity >= 0")
        batch.create_check_constraint(
            "ck_store_delivery_lines_noted_quantity",
            "noted_quantity IS NULL OR noted_quantity >= 0",
        )
    op.create_table(
        "store_handovers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("handed_on", sa.Date(), nullable=False),
        sa.Column("taken_by", sa.String(128), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        _created_at(),
    )
    op.create_index("ix_store_handovers_handed_on", "store_handovers", ["handed_on"])
    op.create_table(
        "store_handover_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "handover_id",
            sa.Integer(),
            sa.ForeignKey("store_handovers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("store_batches.id"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.UniqueConstraint("handover_id", "batch_id", name="uq_store_handover_lines_batch"),
        sa.CheckConstraint("quantity > 0", name="ck_store_handover_lines_quantity"),
    )
    op.create_index("ix_store_handover_lines_batch", "store_handover_lines", ["batch_id"])
    op.create_table(
        "store_item_aliases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
        sa.Column("alias_norm", sa.String(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        _created_at(),
        sa.UniqueConstraint("alias_norm", name="uq_store_item_aliases_alias_norm"),
    )


def downgrade() -> None:
    op.drop_table("store_item_aliases")
    op.drop_index("ix_store_handover_lines_batch", table_name="store_handover_lines")
    op.drop_table("store_handover_lines")
    op.drop_index("ix_store_handovers_handed_on", table_name="store_handovers")
    op.drop_table("store_handovers")
    # These rows recorded a note discrepancy but never changed stock.
    op.execute("DELETE FROM store_delivery_lines WHERE quantity = 0")
    with op.batch_alter_table("store_delivery_lines", recreate="always") as batch:
        batch.drop_constraint("ck_store_delivery_lines_noted_quantity", type_="check")
        batch.drop_constraint("ck_store_delivery_lines_quantity", type_="check")
        batch.create_check_constraint("ck_store_delivery_lines_quantity", "quantity > 0")
        batch.drop_column("difference_reason")
        batch.drop_column("noted_quantity")
    with op.batch_alter_table("store_items") as batch:
        batch.drop_column("art_color")
        batch.drop_column("art_kind")
