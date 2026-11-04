"""Assets uniform: catalogue, sizes, receipts, hand-outs, returns, adjustments.

Revision ID: 0115_uniform
Revises: 0114_store_count
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.schema import SchemaItem

revision: str = "0115_uniform"
down_revision: str | Sequence[str] | None = "0114_store_count"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DRAWINGS = (
    "suit",
    "boots",
    "polo",
    "cargo",
    "belt",
    "cap",
    "socks",
    "jacket",
    "vest",
    "parka",
    "dressshirt",
    "longsleeve",
)
_DRAWING_SQL = ", ".join(f"'{kind}'" for kind in DRAWINGS)

LETTER = ("S", "M", "L", "XL", "XXL", "XXXL")
WAIST = ("28", "30", "32", "34", "36", "38", "40", "42", "44")
SHOE = ("38", "39", "40", "41", "42", "43", "44", "45", "46", "47")
ONE = ("one",)

# (drawing, group, tracking, default_qty, name_en, name_ar, desc_en, desc_ar, sizes)
SEED = (
    (
        "suit",
        "formal",
        "holder",
        2,
        "Formal suit",
        "بدلة رسمية",
        "Tailored navy jacket and trousers, white shirt",
        "سترة وبنطال كحليان مفصّلان وقميص أبيض",
        (),
    ),
    (
        "polo",
        "guard",
        "shelf",
        2,
        "Polo shirt",
        "قميص بولو",
        "Olive, with logo",
        "زيتي، مع الشعار",
        LETTER,
    ),
    ("cargo", "guard", "shelf", 2, "Cargo trousers", "بنطال كارغو", "Khaki", "خاكي", WAIST),
    ("belt", "guard", "shelf", 1, "Belt", "حزام", "Brown, silver buckle", "بني بإبزيم فضي", ONE),
    ("boots", "guard", "shelf", 2, "Field boots", "حذاء ميداني", "Tan, lace-up", "بيج برباط", SHOE),
    ("cap", "guard", "shelf", 1, "Cap", "قبعة", "Khaki, with logo", "خاكي، مع الشعار", ONE),
    ("socks", "guard", "shelf", 2, "Socks", "جوارب", "Khaki, pairs", "خاكي، أزواج", ONE),
    (
        "parka",
        "winter",
        "shelf",
        1,
        "Winter jacket",
        "سترة شتوية",
        "Insulated, hooded",
        "مبطنة بغطاء للرأس",
        LETTER,
    ),
)


def _timestamps() -> list[sa.Column[Any]]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
    ]


def _creator() -> sa.Column[Any]:
    return sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True)


def _void(table: str) -> list[SchemaItem]:
    return [
        sa.Column("voided_at", sa.DateTime(), nullable=True),
        sa.Column("voided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("void_reason", sa.String(length=500), nullable=True),
        sa.CheckConstraint(
            "(voided_at IS NULL AND void_reason IS NULL)"
            " OR (voided_at IS NOT NULL AND void_reason IS NOT NULL"
            " AND length(trim(void_reason)) > 0)",
            name=f"ck_{table}_void",
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "uniform_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name_en", sa.String(length=120), nullable=False),
        sa.Column("name_ar", sa.String(length=120), nullable=False),
        sa.Column("description_en", sa.String(length=500), nullable=True),
        sa.Column("description_ar", sa.String(length=500), nullable=True),
        sa.Column("group_key", sa.String(length=16), nullable=False),
        sa.Column("drawing", sa.String(length=16), nullable=False),
        sa.Column("tracking", sa.String(length=8), nullable=False),
        sa.Column("default_qty", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        _creator(),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.CheckConstraint(
            "group_key IN ('formal', 'guard', 'winter')", name="ck_uniform_items_group"
        ),
        sa.CheckConstraint(f"drawing IN ({_DRAWING_SQL})", name="ck_uniform_items_drawing"),
        sa.CheckConstraint("tracking IN ('shelf', 'holder')", name="ck_uniform_items_tracking"),
        sa.CheckConstraint("default_qty >= 1", name="ck_uniform_items_default_qty"),
    )
    op.create_index(
        "uq_uniform_items_name_active",
        "uniform_items",
        [sa.text("lower(name_en)")],
        unique=True,
        sqlite_where=sa.text("archived_at IS NULL"),
    )
    op.create_index(
        "uq_uniform_items_drawing_active",
        "uniform_items",
        ["drawing"],
        unique=True,
        sqlite_where=sa.text("archived_at IS NULL"),
    )
    op.create_table(
        "uniform_sizes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "item_id",
            sa.Integer(),
            sa.ForeignKey("uniform_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(length=16), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("on_hand", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("min_qty", sa.Integer(), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint("on_hand >= 0", name="ck_uniform_sizes_on_hand"),
        sa.CheckConstraint("min_qty IS NULL OR min_qty >= 0", name="ck_uniform_sizes_min_qty"),
    )
    op.create_index(
        "uq_uniform_sizes_item_label_active",
        "uniform_sizes",
        ["item_id", sa.text("lower(label)")],
        unique=True,
        sqlite_where=sa.text("archived_at IS NULL"),
    )
    op.create_table(
        "uniform_receipts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("received_on", sa.Date(), nullable=False),
        sa.Column("reference", sa.String(length=120), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        _creator(),
        *_void("uniform_receipts"),
        *_timestamps(),
    )
    op.create_table(
        "uniform_receipt_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "receipt_id",
            sa.Integer(),
            sa.ForeignKey("uniform_receipts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("size_id", sa.Integer(), sa.ForeignKey("uniform_sizes.id"), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("qty > 0", name="ck_uniform_receipt_lines_qty"),
        sa.UniqueConstraint("receipt_id", "size_id", name="uq_uniform_receipt_lines_size"),
    )
    op.create_table(
        "uniform_issues",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False
        ),
        sa.Column("issued_on", sa.Date(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        _creator(),
        *_void("uniform_issues"),
        *_timestamps(),
    )
    op.create_index("ix_uniform_issues_employee", "uniform_issues", ["employee_id"])
    op.create_table(
        "uniform_issue_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "issue_id",
            sa.Integer(),
            sa.ForeignKey("uniform_issues.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("uniform_items.id"), nullable=False),
        sa.Column("size_id", sa.Integer(), sa.ForeignKey("uniform_sizes.id"), nullable=True),
        sa.Column("qty", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("qty > 0", name="ck_uniform_issue_lines_qty"),
        sa.UniqueConstraint("issue_id", "item_id", "size_id", name="uq_uniform_issue_lines_line"),
    )
    # NULL size_id is distinct in UNIQUE, so holder lines need their own guard.
    op.create_index(
        "uq_uniform_issue_lines_holder",
        "uniform_issue_lines",
        ["issue_id", "item_id"],
        unique=True,
        sqlite_where=sa.text("size_id IS NULL"),
    )
    op.create_table(
        "uniform_returns",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "employee_id", sa.String(length=16), sa.ForeignKey("employees.id"), nullable=False
        ),
        sa.Column("returned_on", sa.Date(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        _creator(),
        *_void("uniform_returns"),
        *_timestamps(),
    )
    op.create_index("ix_uniform_returns_employee", "uniform_returns", ["employee_id"])
    op.create_table(
        "uniform_return_lines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "return_id",
            sa.Integer(),
            sa.ForeignKey("uniform_returns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("uniform_items.id"), nullable=False),
        sa.Column("size_id", sa.Integer(), sa.ForeignKey("uniform_sizes.id"), nullable=True),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("condition", sa.String(length=8), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("qty > 0", name="ck_uniform_return_lines_qty"),
        sa.CheckConstraint(
            "condition IN ('reusable', 'damaged')", name="ck_uniform_return_lines_condition"
        ),
    )
    op.create_table(
        "uniform_adjustments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("size_id", sa.Integer(), sa.ForeignKey("uniform_sizes.id"), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=False),
        sa.Column("adjusted_on", sa.Date(), nullable=False),
        _creator(),
        *_void("uniform_adjustments"),
        *_timestamps(),
        sa.CheckConstraint("delta <> 0", name="ck_uniform_adjustments_delta"),
        sa.CheckConstraint("length(trim(reason)) > 0", name="ck_uniform_adjustments_reason"),
    )
    op.create_index("ix_uniform_adjustments_size", "uniform_adjustments", ["size_id"])
    _seed()


def _seed() -> None:
    connection = op.get_bind()
    for order, (
        drawing,
        group_key,
        tracking,
        default_qty,
        name_en,
        name_ar,
        description_en,
        description_ar,
        sizes,
    ) in enumerate(SEED, start=1):
        exists = connection.execute(
            sa.text(
                "SELECT id FROM uniform_items WHERE drawing = :drawing AND archived_at IS NULL"
            ),
            {"drawing": drawing},
        ).scalar()
        if exists is not None:
            continue
        item_id = connection.execute(
            sa.text(
                "INSERT INTO uniform_items (name_en, name_ar, description_en, description_ar,"
                " group_key, drawing, tracking, default_qty, sort_order)"
                " VALUES (:name_en, :name_ar, :description_en, :description_ar,"
                " :group_key, :drawing, :tracking, :default_qty, :sort_order)"
            ),
            {
                "name_en": name_en,
                "name_ar": name_ar,
                "description_en": description_en,
                "description_ar": description_ar,
                "group_key": group_key,
                "drawing": drawing,
                "tracking": tracking,
                "default_qty": default_qty,
                "sort_order": order,
            },
        ).lastrowid
        for size_order, label in enumerate(sizes, start=1):
            connection.execute(
                sa.text(
                    "INSERT INTO uniform_sizes (item_id, label, sort_order, on_hand)"
                    " VALUES (:item_id, :label, :sort_order, 0)"
                ),
                {"item_id": item_id, "label": label, "sort_order": size_order},
            )


def downgrade() -> None:
    op.drop_index("ix_uniform_adjustments_size", table_name="uniform_adjustments")
    op.drop_table("uniform_adjustments")
    op.drop_table("uniform_return_lines")
    op.drop_index("ix_uniform_returns_employee", table_name="uniform_returns")
    op.drop_table("uniform_returns")
    op.drop_index("uq_uniform_issue_lines_holder", table_name="uniform_issue_lines")
    op.drop_table("uniform_issue_lines")
    op.drop_index("ix_uniform_issues_employee", table_name="uniform_issues")
    op.drop_table("uniform_issues")
    op.drop_table("uniform_receipt_lines")
    op.drop_table("uniform_receipts")
    op.drop_index("uq_uniform_sizes_item_label_active", table_name="uniform_sizes")
    op.drop_table("uniform_sizes")
    op.drop_index("uq_uniform_items_drawing_active", table_name="uniform_items")
    op.drop_index("uq_uniform_items_name_active", table_name="uniform_items")
    op.drop_table("uniform_items")
