"""books table — add deleted_at column; seed book_categories for fresh installs.

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-20

Changes:
  - books.deleted_at  DATETIME NULL  — soft-delete timestamp (NULL = active).
  - Inserts the 12 default book categories (INSERT OR IGNORE) so fresh
    installs that did not run import_v3.py still have a populated table.
    v3-import paths already write these rows; INSERT OR IGNORE is a no-op
    in that case.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Keep this list in sync with app.core.constants.DEFAULT_CATEGORIES.
# Do NOT import application code from migrations — alembic env may not have
# the full package on the path during offline migrations.
_DEFAULT_CATEGORIES = [
    ("1",  "Employee Staff",  "شؤون الموظفين",   "1"),
    ("2",  "Logistics",       "اللوجستيك",        "2"),
    ("3",  "Employee Fines",  "مخالفات الموظفين", "3"),
    ("4",  "Training",        "التدريب",          "4"),
    ("5",  "Incidents",       "الحوادث",          "5"),
    ("6",  "Equipment",       "المعدات",          "6"),
    ("7",  "Client Comm",     "التواصل مع العملاء","7"),
    ("8",  "Memos",           "المذكرات",         "8"),
    ("9",  "Attendance",      "الحضور",           "9"),
    ("10", "Performance",     "الأداء",           "10"),
    ("11", "Contracts",       "العقود",           "11"),
    ("12", "Misc",            "متفرقات",          "12"),
]


def upgrade() -> None:
    # 1. Add deleted_at to books.
    with op.batch_alter_table("books") as batch_op:
        batch_op.add_column(
            sa.Column("deleted_at", sa.DateTime(), nullable=True, server_default=None)
        )

    # 2. Seed default categories for fresh installs (no-op if already present).
    conn = op.get_bind()
    for cat_id, name_en, name_ar, prefix in _DEFAULT_CATEGORIES:
        conn.execute(
            sa.text(
                "INSERT OR IGNORE INTO book_categories (id, name_en, name_ar, prefix)"
                " VALUES (:id, :name_en, :name_ar, :prefix)"
            ),
            {"id": cat_id, "name_en": name_en, "name_ar": name_ar, "prefix": prefix},
        )


def downgrade() -> None:
    with op.batch_alter_table("books") as batch_op:
        batch_op.drop_column("deleted_at")
    # Do NOT remove seed categories on downgrade — existing book rows may
    # reference them via FK and removal would violate referential integrity.
