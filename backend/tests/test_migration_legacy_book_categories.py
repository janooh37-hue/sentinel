from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[2]
SEED_CATEGORIES = [
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


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option(
        "script_location",
        str(ROOT / "backend" / "app" / "db" / "migrations"),
    )
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def test_0098_removes_only_unreferenced_seeds_and_restores_them(
    tmp_path: Path,
) -> None:
    config = _config(tmp_path / "legacy-book-categories.db")
    command.upgrade(config, "0097_item_permit_zones")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    untouched_tables = (
        "books",
        "user_permissions",
        "role_permissions",
        "permission_requests",
    )
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO book_categories (id, name_en, name_ar, prefix) VALUES "
                    "('GS', 'Cat GS', NULL, 'GS'), "
                    "('HR', 'People', 'الأفراد', 'HR'), "
                    "('NAT', 'Cat NAT', NULL, 'NAT'), "
                    "('SC', 'Cat SC', NULL, 'SC'), "
                    "('9/1', 'Classification', 'تصنيف', '9/1')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO books (category_id, ref_number, created_at, deleted_at) "
                    "VALUES ('1', '1-0001', '2026-01-01', '2026-02-01'), "
                    "('2', '2-0001', '2026-01-01', NULL), "
                    "('GS', 'GS-0001', '2026-01-01', NULL)"
                )
            )
            user_id = connection.execute(
                text(
                    "INSERT INTO users (email, password_hash, role, status) "
                    "VALUES ('migration@x.ae', 'x', 'operator', 'active') RETURNING id"
                )
            ).scalar_one()
            connection.execute(
                text(
                    "INSERT INTO user_permissions (user_id, capability, effect) "
                    "VALUES (:user_id, 'books.category.3', 'deny')"
                ),
                {"user_id": user_id},
            )
            connection.execute(
                text(
                    "INSERT INTO role_permissions (role, capability) "
                    "VALUES ('operator', 'books.category.3')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO permission_requests (user_id, capability) "
                    "VALUES (:user_id, 'books.category.3')"
                ),
                {"user_id": user_id},
            )
            before = {
                table: connection.execute(text(f"SELECT * FROM {table}")).fetchall()
                for table in untouched_tables
            }
            other_categories = connection.execute(
                text("SELECT * FROM book_categories WHERE id IN ('9/1', 'VA', 'VF') ORDER BY id")
            ).fetchall()

        command.upgrade(config, "0098_legacy_book_categories")

        with engine.connect() as connection:
            categories = {
                row.id: (row.name_en, row.name_ar, row.prefix)
                for row in connection.execute(
                    text("SELECT id, name_en, name_ar, prefix FROM book_categories")
                )
            }
            assert set(categories) & {row[0] for row in SEED_CATEGORIES} == {"1", "2"}
            assert categories["GS"] == (
                "General correspondence",
                "المراسلات العامة",
                "GS",
            )
            assert categories["HR"] == ("People", "الأفراد", "HR")
            assert categories["NAT"] == (
                "Violations and warnings",
                "المخالفات والإنذارات",
                "NAT",
            )
            assert categories["SC"] == ("Supplies and materials", "اللوازم والمواد", "SC")
            assert (
                connection.execute(
                    text(
                        "SELECT * FROM book_categories WHERE id IN ('9/1', 'VA', 'VF') ORDER BY id"
                    )
                ).fetchall()
                == other_categories
            )
            for table in untouched_tables:
                assert (
                    connection.execute(text(f"SELECT * FROM {table}")).fetchall() == before[table]
                )

        command.downgrade(config, "0097_item_permit_zones")

        with engine.connect() as connection:
            categories = {
                row.id: (row.name_en, row.name_ar, row.prefix)
                for row in connection.execute(
                    text("SELECT id, name_en, name_ar, prefix FROM book_categories")
                )
            }
            assert set(categories) & {row[0] for row in SEED_CATEGORIES} == {
                row[0] for row in SEED_CATEGORIES
            }
            for category_id, name_en, name_ar, prefix in SEED_CATEGORIES:
                assert categories[category_id] == (name_en, name_ar, prefix)
            assert categories["GS"] == ("Cat GS", None, "GS")
            assert categories["HR"] == ("People", "الأفراد", "HR")
            assert categories["NAT"] == ("Cat NAT", None, "NAT")
            assert categories["SC"] == ("Cat SC", None, "SC")
            for table in untouched_tables:
                assert (
                    connection.execute(text(f"SELECT * FROM {table}")).fetchall() == before[table]
                )
    finally:
        engine.dispose()
