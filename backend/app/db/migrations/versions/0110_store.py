"""Assets store: categories, items, batches, deliveries, stock counts, disposals.

Revision ID: 0110_store
Revises: 0109_book_folder_shares
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0110_store"
down_revision: str | Sequence[str] | None = "0109_book_folder_shares"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
    )


def upgrade() -> None:
    op.create_table(
        "store_categories",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name_en", sa.String(length=128), nullable=False),
        sa.Column("name_ar", sa.String(length=128), nullable=False),
        _created_at(),
        sa.UniqueConstraint("name_en", name="uq_store_categories_name_en"),
    )
    op.create_table(
        "store_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("name_en", sa.String(length=255), nullable=False),
        sa.Column("name_ar", sa.String(length=255), nullable=True),
        sa.Column(
            "category_id", sa.Integer(), sa.ForeignKey("store_categories.id"), nullable=False
        ),
        sa.Column("counting_unit_en", sa.String(length=64), nullable=False),
        sa.Column("counting_unit_ar", sa.String(length=64), nullable=False),
        sa.Column("contains_qty", sa.Integer(), nullable=True),
        sa.Column("contains_unit_en", sa.String(length=64), nullable=True),
        sa.Column("contains_unit_ar", sa.String(length=64), nullable=True),
        sa.Column("minimum_level", sa.Integer(), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        _created_at(),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("code", name="uq_store_items_code"),
        sa.CheckConstraint(
            "contains_qty IS NULL OR contains_qty >= 2", name="ck_store_items_contains_qty"
        ),
        sa.CheckConstraint(
            "(contains_qty IS NULL AND contains_unit_en IS NULL AND contains_unit_ar IS NULL)"
            " OR (contains_qty IS NOT NULL AND contains_unit_en IS NOT NULL"
            " AND contains_unit_ar IS NOT NULL)",
            name="ck_store_items_contains_together",
        ),
        sa.CheckConstraint(
            "minimum_level IS NULL OR minimum_level >= 0", name="ck_store_items_minimum_level"
        ),
    )
    op.create_index("ix_store_items_category", "store_items", ["category_id"])
    op.create_table(
        "store_batches",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "item_id",
            sa.Integer(),
            sa.ForeignKey("store_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("expiry_month_only", sa.Boolean(), nullable=False, server_default="0"),
        _created_at(),
    )
    op.create_index(
        "uq_store_batches_item_expiry",
        "store_batches",
        ["item_id", "expiry_date"],
        unique=True,
        sqlite_where=sa.text("expiry_date IS NOT NULL"),
    )
    op.create_index(
        "uq_store_batches_item_undated",
        "store_batches",
        ["item_id"],
        unique=True,
        sqlite_where=sa.text("expiry_date IS NULL"),
    )
    op.create_table(
        "store_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("received_on", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("note_file_path", sa.Text(), nullable=True),
        sa.Column("note_file_name", sa.String(length=255), nullable=True),
        sa.Column("note_file_media_type", sa.String(length=64), nullable=True),
        sa.Column("note_file_size", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        _created_at(),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_store_deliveries_received_on", "store_deliveries", ["received_on"])
    op.create_table(
        "store_delivery_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "delivery_id",
            sa.Integer(),
            sa.ForeignKey("store_deliveries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("store_batches.id"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.UniqueConstraint("delivery_id", "batch_id", name="uq_store_delivery_lines_batch"),
        sa.CheckConstraint("quantity > 0", name="ck_store_delivery_lines_quantity"),
    )
    op.create_index("ix_store_delivery_lines_batch", "store_delivery_lines", ["batch_id"])
    op.create_table(
        "store_counts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("month", sa.String(length=7), nullable=False),
        sa.Column("counted_on", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        _created_at(),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("month", name="uq_store_counts_month"),
    )
    op.create_index("ix_store_counts_counted_on", "store_counts", ["counted_on"])
    op.create_table(
        "store_count_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "count_id",
            sa.Integer(),
            sa.ForeignKey("store_counts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("store_batches.id"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.UniqueConstraint("count_id", "batch_id", name="uq_store_count_lines_batch"),
        sa.CheckConstraint("quantity >= 0", name="ck_store_count_lines_quantity"),
    )
    op.create_index("ix_store_count_lines_batch", "store_count_lines", ["batch_id"])
    op.create_table(
        "store_disposals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("store_batches.id"), nullable=False),
        sa.Column("disposed_on", sa.Date(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=8), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        _created_at(),
        sa.CheckConstraint("quantity > 0", name="ck_store_disposals_quantity"),
        sa.CheckConstraint("reason IN ('expired', 'damaged')", name="ck_store_disposals_reason"),
    )
    op.create_index("ix_store_disposals_batch", "store_disposals", ["batch_id"])
    op.create_index("ix_store_disposals_disposed_on", "store_disposals", ["disposed_on"])

    categories = sa.table(
        "store_categories",
        sa.column("name_en", sa.String()),
        sa.column("name_ar", sa.String()),
    )
    op.bulk_insert(
        categories,
        [
            {"name_en": "Pantry", "name_ar": "ضيافة"},
            {"name_en": "Protective", "name_ar": "وقاية"},
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_store_disposals_disposed_on", table_name="store_disposals")
    op.drop_index("ix_store_disposals_batch", table_name="store_disposals")
    op.drop_table("store_disposals")
    op.drop_index("ix_store_count_lines_batch", table_name="store_count_lines")
    op.drop_table("store_count_lines")
    op.drop_index("ix_store_counts_counted_on", table_name="store_counts")
    op.drop_table("store_counts")
    op.drop_index("ix_store_delivery_lines_batch", table_name="store_delivery_lines")
    op.drop_table("store_delivery_lines")
    op.drop_index("ix_store_deliveries_received_on", table_name="store_deliveries")
    op.drop_table("store_deliveries")
    op.drop_index("uq_store_batches_item_undated", table_name="store_batches")
    op.drop_index("uq_store_batches_item_expiry", table_name="store_batches")
    op.drop_table("store_batches")
    op.drop_index("ix_store_items_category", table_name="store_items")
    op.drop_table("store_items")
    op.drop_table("store_categories")
