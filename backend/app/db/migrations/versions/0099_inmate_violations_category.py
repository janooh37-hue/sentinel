"""Separate inmate violations and register all General Book classifications.

Revision ID: 0099_inmate_violations_category
Revises: 0098_legacy_book_categories
Create Date: 2026-10-08 00:00:00.000000

Create INV and move NAT books with any inmate-violation version or linked
inmate-violation document, including soft-deleted books. Versionless legacy
imports qualify by subject prefix. Only category_id changes; existing refs stay
unchanged. New refs use INV-NNNN from the shared global counter.

NAT permission overrides and eligible document_generated correspondence rules
are copied, not moved, so employee violations retain their permissions/logging.
Classification placeholders get registry names; missing rows get code prefixes;
custom names are preserved.

Downgrade restores referenced registry-named classifications to placeholders and
deletes unreferenced ones. A placeholder with no books before upgrade is deleted
rather than restored: no state distinguishes it from an inserted row. Remove
all INV-conditioned rules and INV permissions, move all INV books (including new
ones) back to NAT, then delete INV. Existing refs remain unchanged both ways.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0099_inmate_violations_category"
down_revision: str | Sequence[str] | None = "0098_legacy_book_categories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CLASSIFICATIONS = [
    ("1/1", "Unexcused absences", "الغيابات دون عذر رسمي"),
    ("2/1", "Meeting minutes & monthly schedule", "محاضر الإجتماع وجدول الإجتماع الشهري"),
    ("3/1", "Annual leaves", "الإجازات السنوية"),
    ("4/1", "Sick leaves", "الإجازات المرضية"),
    ("5/1", "Security permits", "التصاريح الأمنية"),
    ("6/1", "Statistics & monthly reports", "الإحصائيات والتقارير الشهرية"),
    ("7/1", "Financial affairs", "الشؤون المالية بشكل عام"),
    ("8/1", "Salary certificates & passport requests", "شهادات الرواتب وطلبات جواز السفر"),
    ("9/1", "Custody, clothing & ID cards", "العهدة والملابس والبطاقات التعريفية"),
    ("10/1", "Consumables inventory", "جرد المواد الإستهلاكية"),
    ("11/1", "Maintenance works", "أعمال الصيانة"),
    ("12/1", "Force affairs", "شؤون القوة"),
    ("13/1", "Inmates affairs & deposits", "شؤون النزلاء والأمانات"),
    ("14/1", "Clinic", "العيادة"),
    ("15/1", "(Miscellaneous)", "( متنوعة )"),
]


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "INSERT OR IGNORE INTO book_categories (id, name_en, name_ar, prefix) "
            "VALUES ('INV', 'Inmate violations', 'مخالفات النزلاء', 'INV')"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE books SET category_id = 'INV' WHERE category_id = 'NAT' AND ("
            "EXISTS (SELECT 1 FROM book_versions v "
            "LEFT JOIN documents d ON d.id = v.document_id "
            "WHERE v.book_id = books.id AND ("
            "v.template_id = 'Inmate Conduct Violations' OR "
            "d.template_id = 'Inmate Conduct Violations')) OR ("
            "NOT EXISTS (SELECT 1 FROM book_versions v WHERE v.book_id = books.id) "
            "AND lower(subject) LIKE 'inmate conduct violations%'))"
        )
    )
    conn.execute(
        sa.text(
            "INSERT OR IGNORE INTO user_permissions (user_id, capability, effect, expires_at) "
            "SELECT user_id, 'books.category.INV', effect, expires_at "
            "FROM user_permissions WHERE capability = 'books.category.NAT'"
        )
    )
    conn.execute(
        sa.text(
            "INSERT OR IGNORE INTO role_permissions (role, capability) "
            "SELECT role, 'books.category.INV' FROM role_permissions "
            "WHERE capability = 'books.category.NAT'"
        )
    )
    rules = (
        conn.execute(
            sa.text(
                "SELECT trigger, condition_json, category_id, enabled, sort "
                "FROM correspondence_rules WHERE trigger = 'document_generated'"
            )
        )
        .mappings()
        .all()
    )
    for rule in rules:
        condition = json.loads(rule["condition_json"] or "{}")
        if str(condition.get("category", "")).strip().upper() != "NAT":
            continue
        template_id = str(condition.get("template_id", "inmate conduct violations"))
        # Mirror correspondence_service._match_rule: trimmed, case-insensitive.
        if template_id.strip().lower() != "inmate conduct violations":
            continue
        condition["category"] = "INV"
        conn.execute(
            sa.text(
                "INSERT INTO correspondence_rules "
                "(trigger, condition_json, category_id, enabled, sort, created_at) "
                "VALUES (:trigger, :condition_json, :category_id, :enabled, :sort, CURRENT_TIMESTAMP)"
            ),
            {**rule, "condition_json": json.dumps(condition)},
        )
    for code, name_en, name_ar in _CLASSIFICATIONS:
        values = {"id": code, "name_en": name_en, "name_ar": name_ar, "placeholder": f"Cat {code}"}
        conn.execute(
            sa.text(
                "UPDATE book_categories SET name_en = :name_en, name_ar = :name_ar "
                "WHERE id = :id AND name_en = :placeholder AND name_ar IS NULL"
            ),
            values,
        )
        conn.execute(
            sa.text(
                "INSERT OR IGNORE INTO book_categories (id, name_en, name_ar, prefix) "
                "VALUES (:id, :name_en, :name_ar, :id)"
            ),
            values,
        )


def downgrade() -> None:
    conn = op.get_bind()
    for code, name_en, name_ar in _CLASSIFICATIONS:
        values = {"id": code, "name_en": name_en, "name_ar": name_ar, "placeholder": f"Cat {code}"}
        conn.execute(
            sa.text(
                "UPDATE book_categories SET name_en = :placeholder, name_ar = NULL "
                "WHERE id = :id AND name_en = :name_en AND name_ar = :name_ar "
                "AND EXISTS (SELECT 1 FROM books WHERE books.category_id = book_categories.id)"
            ),
            values,
        )
        conn.execute(
            sa.text(
                "DELETE FROM book_categories "
                "WHERE id = :id AND name_en = :name_en AND name_ar = :name_ar "
                "AND NOT EXISTS (SELECT 1 FROM books WHERE books.category_id = book_categories.id)"
            ),
            values,
        )
    rules = conn.execute(sa.text("SELECT id, condition_json FROM correspondence_rules")).all()
    for rule in rules:
        condition = json.loads(rule.condition_json or "{}")
        if str(condition.get("category", "")).strip().upper() == "INV":
            conn.execute(
                sa.text("DELETE FROM correspondence_rules WHERE id = :id"), {"id": rule.id}
            )
    conn.execute(sa.text("DELETE FROM user_permissions WHERE capability = 'books.category.INV'"))
    conn.execute(sa.text("DELETE FROM role_permissions WHERE capability = 'books.category.INV'"))
    # NAT is not seeded by any migration; recreate it if INV books must go back.
    conn.execute(
        sa.text(
            "INSERT OR IGNORE INTO book_categories (id, name_en, name_ar, prefix) "
            "SELECT 'NAT', 'Violations and warnings', 'المخالفات والإنذارات', 'NAT' "
            "WHERE EXISTS (SELECT 1 FROM books WHERE category_id = 'INV')"
        )
    )
    conn.execute(sa.text("UPDATE books SET category_id = 'NAT' WHERE category_id = 'INV'"))
    conn.execute(sa.text("DELETE FROM book_categories WHERE id = 'INV'"))
