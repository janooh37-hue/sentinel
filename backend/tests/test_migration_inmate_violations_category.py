from __future__ import annotations

import json
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from app.core.classifications import CLASSIFICATIONS

ROOT = Path(__file__).resolve().parents[2]


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option(
        "script_location",
        str(ROOT / "backend" / "app" / "db" / "migrations"),
    )
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def test_0099_separates_inmate_violations_and_registers_classifications(tmp_path: Path) -> None:
    config = _config(tmp_path / "inmate-violations-category.db")
    command.upgrade(config, "0098_legacy_book_categories")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    moved_ids = {101, 102, 103, 104}
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO book_categories (id, name_en, name_ar, prefix) VALUES "
                    "('NAT', 'Violations and warnings', 'المخالفات والإنذارات', 'NAT'), "
                    "('9/1', 'Cat 9/1', NULL, '9/1'), "
                    "('2/1', 'Cat 2/1', NULL, '2/1'), "
                    "('5/1', 'Custom permits', 'تصاريح مخصصة', 'CUSTOM')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO books "
                    "(id, category_id, ref_number, subject, created_at, deleted_at) "
                    "VALUES (:id, :category, :ref, :subject, '2026-01-01', :deleted)"
                ),
                [
                    {
                        "id": 101,
                        "category": "NAT",
                        "ref": "NAT-0101",
                        "subject": "Older ICV version",
                        "deleted": None,
                    },
                    {
                        "id": 102,
                        "category": "NAT",
                        "ref": "NAT-0102",
                        "subject": "Deleted ICV",
                        "deleted": "2026-02-01",
                    },
                    {
                        "id": 103,
                        "category": "NAT",
                        "ref": "NAT-0103",
                        "subject": "Linked document",
                        "deleted": None,
                    },
                    {
                        "id": 104,
                        "category": "NAT",
                        "ref": "NAT-0104",
                        "subject": "INMATE CONDUCT VIOLATIONS - Legacy",
                        "deleted": None,
                    },
                    {
                        "id": 105,
                        "category": "NAT",
                        "ref": "NAT-0105",
                        "subject": "Violation Form",
                        "deleted": None,
                    },
                    {
                        "id": 106,
                        "category": "NAT",
                        "ref": "NAT-0106",
                        "subject": "Violation Form - X",
                        "deleted": None,
                    },
                    {
                        "id": 107,
                        "category": "NAT",
                        "ref": "NAT-0107",
                        "subject": "Inmate Conduct Violations - Not legacy",
                        "deleted": None,
                    },
                    {
                        "id": 108,
                        "category": "9/1",
                        "ref": "9/1-0108",
                        "subject": "Classified book",
                        "deleted": "2026-02-01",
                    },
                ],
            )
            document_id = connection.execute(
                text(
                    "INSERT INTO documents (template_id, ref_number, submission_id, created_at) "
                    "VALUES ('Inmate Conduct Violations', 'NAT-0103', 'migration-test', '2026-01-01') "
                    "RETURNING id"
                )
            ).scalar_one()
            connection.execute(
                text(
                    "INSERT INTO book_versions "
                    "(book_id, version_no, template_id, document_id, created_at) VALUES "
                    "(101, 1, 'Inmate Conduct Violations', NULL, '2026-01-01'), "
                    "(101, 2, 'Violation Form', NULL, '2026-01-02'), "
                    "(102, 1, 'Inmate Conduct Violations', NULL, '2026-01-01'), "
                    "(103, 1, NULL, :document_id, '2026-01-01'), "
                    "(105, 1, 'Violation Form', NULL, '2026-01-01'), "
                    "(107, 1, 'Violation Form', NULL, '2026-01-01')"
                ),
                {"document_id": document_id},
            )
            for email, effect, expiry in (
                ("deny@migration.ae", "deny", None),
                ("grant@migration.ae", "grant", "2027-01-01 12:00:00"),
            ):
                user_id = connection.execute(
                    text(
                        "INSERT INTO users (email, password_hash, role, status) "
                        "VALUES (:email, 'x', 'operator', 'active') RETURNING id"
                    ),
                    {"email": email},
                ).scalar_one()
                connection.execute(
                    text(
                        "INSERT INTO user_permissions (user_id, capability, effect, expires_at) "
                        "VALUES (:user_id, 'books.category.NAT', :effect, :expiry)"
                    ),
                    {"user_id": user_id, "effect": effect, "expiry": expiry},
                )
            connection.execute(
                text(
                    "INSERT INTO role_permissions (role, capability) "
                    "VALUES ('inmate_reporter', 'books.category.NAT')"
                )
            )
            correspondence_id = connection.execute(
                text(
                    "INSERT INTO correspondence_categories (key, name_en, name_ar, created_at) "
                    "VALUES ('inmate_test', 'Inmate test', 'اختبار النزلاء', '2026-01-01') RETURNING id"
                )
            ).scalar_one()
            for trigger, condition in (
                ("document_generated", {"category": "NAT"}),
                (
                    "document_generated",
                    {
                        "category": "nAt",
                        "template_id": "Inmate Conduct Violations",
                        "extra": "preserved",
                    },
                ),
                ("document_generated", {"category": "NAT", "template_id": "Violation Form"}),
                ("document_generated", {"category": "NAT", "template_id": None}),
                ("book_signed", {"category": "NAT"}),
            ):
                connection.execute(
                    text(
                        "INSERT INTO correspondence_rules "
                        "(trigger, condition_json, category_id, enabled, sort, created_at) "
                        "VALUES (:trigger, :condition, :category_id, 0, 77, '2026-01-01')"
                    ),
                    {
                        "trigger": trigger,
                        "condition": json.dumps(condition),
                        "category_id": correspondence_id,
                    },
                )
            original_books = {
                row.id: dict(row)
                for row in connection.execute(text("SELECT * FROM books")).mappings()
            }
            untouched_tables = ("book_versions", "documents", "correspondence_categories")
            before = {
                table: connection.execute(text(f"SELECT * FROM {table} ORDER BY id")).all()
                for table in untouched_tables
            }
            permissions = connection.execute(
                text(
                    "SELECT user_id, effect, expires_at FROM user_permissions WHERE capability = 'books.category.NAT' ORDER BY user_id"
                )
            ).all()
            roles = connection.execute(
                text(
                    "SELECT role FROM role_permissions WHERE capability = 'books.category.NAT' ORDER BY role"
                )
            ).all()
            rules = (
                connection.execute(text("SELECT * FROM correspondence_rules ORDER BY id"))
                .mappings()
                .all()
            )

        command.upgrade(config, "head")

        with engine.begin() as connection:
            categories = {
                row.id: (row.name_en, row.name_ar, row.prefix)
                for row in connection.execute(text("SELECT * FROM book_categories"))
            }
            assert categories["INV"] == ("Inmate violations", "مخالفات النزلاء", "INV")
            assert categories["NAT"] == ("Violations and warnings", "المخالفات والإنذارات", "NAT")
            for classification in CLASSIFICATIONS:
                assert categories[classification.code] == (
                    ("Custom permits", "تصاريح مخصصة", "CUSTOM")
                    if classification.code == "5/1"
                    else (classification.name_en, classification.name_ar, classification.code)
                )
            assert sum(code in categories for code in (c.code for c in CLASSIFICATIONS)) == 15
            for row in connection.execute(text("SELECT * FROM books")).mappings():
                expected = {**original_books[row.id]}
                if row.id in moved_ids:
                    expected["category_id"] = "INV"
                assert dict(row) == expected
            for capability in ("books.category.NAT", "books.category.INV"):
                assert (
                    connection.execute(
                        text(
                            "SELECT user_id, effect, expires_at FROM user_permissions WHERE capability = :capability ORDER BY user_id"
                        ),
                        {"capability": capability},
                    ).all()
                    == permissions
                )
                assert (
                    connection.execute(
                        text(
                            "SELECT role FROM role_permissions WHERE capability = :capability ORDER BY role"
                        ),
                        {"capability": capability},
                    ).all()
                    == roles
                )
            original_ids = {rule["id"] for rule in rules}
            after_rules = (
                connection.execute(text("SELECT * FROM correspondence_rules ORDER BY id"))
                .mappings()
                .all()
            )
            assert [dict(rule) for rule in after_rules if rule["id"] in original_ids] == [
                dict(rule) for rule in rules
            ]
            expected_copies = []
            for rule in rules:
                condition = json.loads(rule["condition_json"])
                if (
                    rule["trigger"] == "document_generated"
                    and str(condition.get("category", "")).upper() == "NAT"
                    and (
                        "template_id" not in condition
                        or condition["template_id"] == "Inmate Conduct Violations"
                    )
                ):
                    expected_copies.append(
                        (
                            rule["trigger"],
                            {**condition, "category": "INV"},
                            rule["category_id"],
                            rule["enabled"],
                            rule["sort"],
                        )
                    )
            copies = [rule for rule in after_rules if rule["id"] not in original_ids]
            assert [
                (
                    rule["trigger"],
                    json.loads(rule["condition_json"]),
                    rule["category_id"],
                    rule["enabled"],
                    rule["sort"],
                )
                for rule in copies
            ] == expected_copies
            assert all(
                rule["created_at"] is not None and rule["created_at"] != "2026-01-01"
                for rule in copies
            )
            for table in untouched_tables:
                assert (
                    connection.execute(text(f"SELECT * FROM {table} ORDER BY id")).all()
                    == before[table]
                )
            connection.execute(
                text(
                    "INSERT INTO books (id, category_id, ref_number, created_at) "
                    "VALUES (109, 'INV', 'INV-0109', '2026-10-08')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO correspondence_rules (trigger, condition_json, category_id, created_at) "
                    "VALUES ('book_signed', :condition, :category_id, CURRENT_TIMESTAMP)"
                ),
                {"condition": json.dumps({"category": "inv"}), "category_id": correspondence_id},
            )

        command.downgrade(config, "0098_legacy_book_categories")

        with engine.connect() as connection:
            for row in connection.execute(text("SELECT * FROM books WHERE id != 109")).mappings():
                assert dict(row) == original_books[row.id]
            assert connection.execute(
                text("SELECT category_id, ref_number FROM books WHERE id = 109")
            ).one() == ("NAT", "INV-0109")
            categories = {
                row.id: (row.name_en, row.name_ar, row.prefix)
                for row in connection.execute(text("SELECT * FROM book_categories"))
            }
            assert "INV" not in categories
            assert categories["9/1"] == ("Cat 9/1", None, "9/1")
            assert categories["5/1"] == ("Custom permits", "تصاريح مخصصة", "CUSTOM")
            assert set(categories) & {c.code for c in CLASSIFICATIONS} == {"5/1", "9/1"}
            for table in ("user_permissions", "role_permissions"):
                assert (
                    connection.execute(
                        text(
                            f"SELECT COUNT(*) FROM {table} WHERE capability = 'books.category.INV'"
                        )
                    ).scalar_one()
                    == 0
                )
            assert (
                connection.execute(
                    text(
                        "SELECT user_id, effect, expires_at FROM user_permissions WHERE capability = 'books.category.NAT' ORDER BY user_id"
                    )
                ).all()
                == permissions
            )
            assert (
                connection.execute(
                    text(
                        "SELECT role FROM role_permissions WHERE capability = 'books.category.NAT' ORDER BY role"
                    )
                ).all()
                == roles
            )
            assert (
                connection.execute(text("SELECT * FROM correspondence_rules ORDER BY id"))
                .mappings()
                .all()
                == rules
            )
            for table in untouched_tables:
                assert (
                    connection.execute(text(f"SELECT * FROM {table} ORDER BY id")).all()
                    == before[table]
                )
    finally:
        engine.dispose()
