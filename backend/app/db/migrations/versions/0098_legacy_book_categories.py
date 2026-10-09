"""Remove unused legacy seed categories and name imported placeholders.

Revision ID: 0098_legacy_book_categories
Revises: 0097_item_permit_zones
Create Date: 2026-10-08 00:00:00.000000

Seed rows '1' through '12' without any book are removed; referenced rows stay,
including those referenced only by soft-deleted books. Stored
``books.category.<id>`` overrides are left untouched on purpose: they are inert
without a catalog row, and retaining them makes downgrade exact.

Rename unchanged 'Cat <id>' / NULL placeholders for GS, HR, NAT and SC to real
English/Arabic names. Downgrade reverts only exact renamed pairs and restores
missing 0004 seed rows with INSERT OR IGNORE, preserving admin-set names.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0098_legacy_book_categories"
down_revision: str | Sequence[str] | None = "0097_item_permit_zones"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEFAULT_CATEGORIES = [
    ("1", "Employee Staff", "شؤون الموظفين", "1"),
    ("2", "Logistics", "اللوجستيك", "2"),
    ("3", "Employee Fines", "مخالفات الموظفين", "3"),
    ("4", "Training", "التدريب", "4"),
    ("5", "Incidents", "الحوادث", "5"),
    ("6", "Equipment", "المعدات", "6"),
    ("7", "Client Comm", "التواصل مع العملاء", "7"),
    ("8", "Memos", "المذكرات", "8"),
    ("9", "Attendance", "الحضور", "9"),
    ("10", "Performance", "الأداء", "10"),
    ("11", "Contracts", "العقود", "11"),
    ("12", "Misc", "متفرقات", "12"),
]
_RENAMED_CATEGORIES = [
    ("GS", "General correspondence", "المراسلات العامة"),
    ("HR", "Human resources", "الموارد البشرية"),
    ("NAT", "Violations and warnings", "المخالفات والإنذارات"),
    ("SC", "Supplies and materials", "اللوازم والمواد"),
]


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM book_categories "
            "WHERE id IN ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12') "
            "AND NOT EXISTS ("
            "SELECT 1 FROM books WHERE books.category_id = book_categories.id"
            ")"
        )
    )
    for category_id, name_en, name_ar in _RENAMED_CATEGORIES:
        conn.execute(
            sa.text(
                "UPDATE book_categories SET name_en = :name_en, name_ar = :name_ar "
                "WHERE id = :id AND name_en = :placeholder AND name_ar IS NULL"
            ),
            {
                "id": category_id,
                "name_en": name_en,
                "name_ar": name_ar,
                "placeholder": f"Cat {category_id}",
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    for category_id, name_en, name_ar in _RENAMED_CATEGORIES:
        conn.execute(
            sa.text(
                "UPDATE book_categories SET name_en = :placeholder, name_ar = NULL "
                "WHERE id = :id AND name_en = :name_en AND name_ar = :name_ar"
            ),
            {
                "id": category_id,
                "name_en": name_en,
                "name_ar": name_ar,
                "placeholder": f"Cat {category_id}",
            },
        )
    for category_id, name_en, name_ar, prefix in _DEFAULT_CATEGORIES:
        conn.execute(
            sa.text(
                "INSERT OR IGNORE INTO book_categories (id, name_en, name_ar, prefix) "
                "VALUES (:id, :name_en, :name_ar, :prefix)"
            ),
            {"id": category_id, "name_en": name_en, "name_ar": name_ar, "prefix": prefix},
        )
