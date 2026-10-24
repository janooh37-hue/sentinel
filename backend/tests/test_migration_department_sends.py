"""The org-tree department migrations preserve populated data and folder audiences."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
BASE = "0109_book_folder_shares"
DEPARTMENTS = "0110_departments"
PARENT = "0111_book_department"
HEAD = "0112_department_sends"


def migration_config(tmp_path, name):
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend/app/db/migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{(tmp_path / name).as_posix()}")
    return config


def seed_employees(connection, ids):
    connection.execute(
        text(
            "INSERT INTO employees (id, name_en, department, created_at, updated_at) VALUES (:id, :id, 'Legacy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        [{"id": employee_id} for employee_id in ids],
    )


def seed_users(connection, ids):
    connection.execute(
        text(
            "INSERT INTO users (id, email, password_hash, role, status) VALUES (:id, :email, 'x', 'operator', 'active')"
        ),
        [{"id": uid, "email": f"migration-{uid}@test.ae"} for uid in ids],
    )


def seed_books(connection):
    connection.execute(
        text("INSERT OR IGNORE INTO book_categories (id, prefix) VALUES ('HR', 'HR')")
    )
    connection.execute(
        text(
            "INSERT INTO books (id, category_id, ref_number, search_text, created_by_user_id, created_at) VALUES (:id, 'HR', :ref, 'migration', :creator, CURRENT_TIMESTAMP)"
        ),
        [
            {"id": uid, "ref": f"HR-{uid}", "creator": creator}
            for uid, creator in [(701, 701), (702, 702), (703, None)]
        ],
    )


def test_org_tree_department_migrations_round_trip_on_populated_database(tmp_path):
    config = migration_config(tmp_path, "org-tree.db")
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT
    assert script.get_revision(PARENT).down_revision == DEPARTMENTS
    assert script.get_revision(DEPARTMENTS).down_revision == BASE
    command.upgrade(config, BASE)
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        with engine.begin() as connection:
            seed_employees(connection, ["HEAD", "STAFF", "OUTSIDE"])
            seed_users(connection, [701, 702])
            connection.execute(
                text("UPDATE employees SET supervisor_id = 'HEAD' WHERE id = 'STAFF'")
            )
            connection.execute(text("UPDATE users SET employee_id = 'STAFF' WHERE id = 701"))
            seed_books(connection)
        command.upgrade(config, DEPARTMENTS)
        with engine.begin() as connection:
            inspector = inspect(connection)
            assert {
                "departments",
                "department_members",
                "department_exceptions",
                "department_services",
            } <= set(inspector.get_table_names())
            columns = {column["name"]: column for column in inspector.get_columns("departments")}
            assert columns["head_employee_id"]["nullable"] is False
            assert columns["parent_id"]["nullable"] is True
            assert "is_primary" not in {
                column["name"] for column in inspector.get_columns("department_members")
            }
            assert {
                tuple(item["column_names"])
                for item in inspector.get_unique_constraints("departments")
            } >= {("name_en",), ("name_ar",), ("head_employee_id",)}
            assert {
                tuple(item["constrained_columns"]): item["options"].get("ondelete")
                for item in inspector.get_foreign_keys("departments")
            } == {("head_employee_id",): "RESTRICT", ("parent_id",): "SET NULL"}
            assert {
                tuple(item["constrained_columns"]): item["options"].get("ondelete")
                for item in inspector.get_foreign_keys("department_exceptions")
            } == {("employee_id",): "CASCADE", ("department_id",): "CASCADE"}
            assert inspector.get_pk_constraint("department_exceptions")["constrained_columns"] == [
                "employee_id"
            ]
            connection.execute(
                text(
                    "INSERT INTO departments (id, name_en, name_ar, head_employee_id) VALUES (1, 'Operations', 'العمليات', 'HEAD')"
                )
            )
            # 0110 adds materialized storage; normal application writes run recompute.
            connection.execute(
                text("UPDATE employees SET department_id = 1 WHERE id IN ('HEAD', 'STAFF')")
            )
            connection.execute(
                text(
                    "INSERT INTO department_members (department_id, user_id, role) VALUES (1, 701, 'deputy'), (1, 702, 'viewer')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO department_exceptions (employee_id, department_id) VALUES ('OUTSIDE', NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO department_services (department_id, service_id) VALUES (1, 'General Book')"
                )
            )
        invalid = [
            "INSERT INTO departments (name_en, name_ar) VALUES ('Missing head', 'بلا رئيس')",
            "INSERT INTO departments (name_en, name_ar, head_employee_id) VALUES ('Duplicate head', 'مكرر', 'HEAD')",
            "INSERT INTO departments (name_en, name_ar, head_employee_id) VALUES ('Operations', 'اسم آخر', 'OUTSIDE')",
            "INSERT INTO departments (name_en, name_ar, head_employee_id) VALUES ('Other', 'العمليات', 'OUTSIDE')",
            *[
                f"INSERT INTO department_members (department_id, user_id, role) VALUES (1, 703, '{role}')"
                for role in ("head", "member", "invented")
            ],
            "INSERT INTO department_members (department_id, user_id, role) VALUES (1, 701, 'viewer')",
        ]
        for statement in invalid:
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(text(statement))
        command.upgrade(config, PARENT)
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT id, department_id FROM books ORDER BY id")
            ).all() == [(701, 1), (702, None), (703, None)]
            assert "ix_books_department_id" in {
                index["name"] for index in inspect(connection).get_indexes("books")
            }
        command.upgrade(config, HEAD)
        with engine.connect() as connection:
            assert "book_department_sends" in inspect(connection).get_table_names()
            assert (
                connection.execute(
                    text("SELECT department_id FROM books WHERE id = 701")
                ).scalar_one()
                == 1
            )
        command.downgrade(config, DEPARTMENTS)
        with engine.connect() as connection:
            assert "department_id" not in {
                column["name"] for column in inspect(connection).get_columns("books")
            }
            assert connection.execute(text("SELECT count(*) FROM books")).scalar_one() == 3
        command.downgrade(config, BASE)
        with engine.connect() as connection:
            inspector = inspect(connection)
            assert not {
                "departments",
                "department_members",
                "department_exceptions",
                "department_services",
                "book_department_sends",
            } & set(inspector.get_table_names())
            assert "department_id" not in {
                column["name"] for column in inspector.get_columns("employees")
            }
            assert connection.execute(
                text("SELECT id, department, supervisor_id FROM employees ORDER BY id")
            ).all() == [
                ("HEAD", "Legacy", None),
                ("OUTSIDE", "Legacy", None),
                ("STAFF", "Legacy", "HEAD"),
            ]
            assert (
                connection.execute(
                    text("SELECT employee_id FROM users WHERE id = 701")
                ).scalar_one()
                == "STAFF"
            )
        command.upgrade(config, HEAD)
        with engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM books")).scalar_one() == 3
            assert connection.execute(text("SELECT count(*) FROM departments")).scalar_one() == 0
    finally:
        engine.dispose()


def test_department_sends_migration_round_trip(tmp_path):
    config = migration_config(tmp_path, "sends.db")
    command.upgrade(config, PARENT)
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        with engine.begin() as connection:
            seed_employees(connection, ["H1", "H2", "H3", "H4"])
            seed_users(connection, [701, 702])
            connection.execute(
                text(
                    "INSERT INTO departments (id, name_en, name_ar, head_employee_id, parent_id) VALUES (1, 'Finance', 'المالية', 'H1', NULL), (2, 'Operations', 'العمليات', 'H2', NULL), (3, 'Shared', 'مشترك', 'H3', NULL), (4, 'Nested', 'Shared', 'H4', 2)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO book_folders (id, name, created_by_user_id) VALUES (:id, :name, 701)"
                ),
                [{"id": value, "name": f"Restricted {value}"} for value in range(1, 7)],
            )
            connection.execute(
                text(
                    "INSERT INTO book_folder_shares (folder_id, department) VALUES (1, 'Finance'), (1, ' finance '), (1, ' المالية '), (2, ' Unknown '), (3, 'Shared'), (5, 'Future Name')"
                )
            )
            connection.execute(
                text("INSERT INTO book_folder_shares (folder_id, user_id) VALUES (4, 701)")
            )
            seed_books(connection)
            connection.execute(
                text(
                    "INSERT INTO book_recipients (book_id, user_id, sent_by_user_id, purpose, created_at) VALUES (701, 701, 701, 'info', CURRENT_TIMESTAMP)"
                )
            )
        command.upgrade(config, HEAD)
        with engine.begin() as connection:
            inspector = inspect(connection)
            assert connection.execute(
                text(
                    "SELECT folder_id, user_id, department_id, department FROM book_folder_shares ORDER BY folder_id"
                )
            ).all() == [
                (1, None, 1, None),
                (2, None, None, " Unknown "),
                (3, None, None, "Shared"),
                (4, 701, None, None),
                (5, None, None, "Future Name"),
            ]
            assert "ix_book_recipients_department_send_id" in {
                index["name"] for index in inspector.get_indexes("book_recipients")
            }
            columns = {
                column["name"]: column for column in inspector.get_columns("book_department_sends")
            }
            assert columns["purpose"]["type"].length == 16
            assert columns["created_at"]["nullable"] is False
            assert columns["created_at"]["default"] is not None
            foreign_keys = {
                tuple(key["constrained_columns"]): key
                for key in inspector.get_foreign_keys("book_department_sends")
            }
            assert foreign_keys[("book_id",)]["referred_table"] == "books"
            assert foreign_keys[("book_id",)]["options"]["ondelete"] == "CASCADE"
            assert foreign_keys[("department_id",)]["referred_table"] == "departments"
            assert foreign_keys[("parent_send_id",)]["referred_table"] == "book_department_sends"
            assert not any(
                "department_send_id" in key["constrained_columns"]
                for key in inspector.get_foreign_keys("book_recipients")
            )
            assert not any(
                "department_id" in key["constrained_columns"]
                for key in inspector.get_foreign_keys("book_folder_shares")
            )
            connection.execute(text("UPDATE departments SET name_en = 'Future Name' WHERE id = 2"))
            connection.execute(
                text(
                    "INSERT INTO book_folder_shares (folder_id, department_id) VALUES (5, 2), (6, 3), (6, 4)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO book_department_sends (id, book_id, department_id, parent_send_id, sent_by_user_id, purpose) VALUES (1, 701, 1, NULL, 701, 'info'), (2, 701, 2, 1, 701, 'action')"
                )
            )
            connection.execute(
                text("UPDATE book_recipients SET department_send_id = 1 WHERE book_id = 701")
            )
        for statement in [
            "INSERT INTO book_folder_shares (folder_id) VALUES (1)",
            "INSERT INTO book_folder_shares (folder_id, user_id, department_id) VALUES (1, 701, 1)",
            "INSERT INTO book_folder_shares (folder_id, department_id, department) VALUES (1, 1, 'Finance')",
            "INSERT INTO book_folder_shares (folder_id, department_id) VALUES (1, 1)",
            "INSERT INTO book_department_sends (book_id, department_id, sent_by_user_id, purpose) VALUES (701, 1, 701, 'info')",
            "INSERT INTO book_department_sends (book_id, department_id, sent_by_user_id, purpose) VALUES (701, 3, 701, 'sign')",
        ]:
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(text(statement))
        with engine.begin() as connection:
            connection.execute(
                text("UPDATE book_department_sends SET revoked_at = CURRENT_TIMESTAMP WHERE id = 1")
            )
            connection.execute(
                text(
                    "INSERT INTO book_department_sends (book_id, department_id, sent_by_user_id, purpose) VALUES (701, 1, 701, 'reply')"
                )
            )
        command.downgrade(config, PARENT)
        with engine.connect() as connection:
            inspector = inspect(connection)
            assert "book_department_sends" not in inspector.get_table_names()
            assert "department_send_id" not in {
                column["name"] for column in inspector.get_columns("book_recipients")
            }
            assert "department_id" not in {
                column["name"] for column in inspector.get_columns("book_folder_shares")
            }
            assert connection.execute(
                text(
                    "SELECT folder_id, user_id, department FROM book_folder_shares ORDER BY folder_id"
                )
            ).all() == [
                (1, 701, None),
                (2, None, " Unknown "),
                (3, None, "Shared"),
                (4, 701, None),
                (5, None, "Future Name"),
                (6, 701, None),
            ]
            assert (
                connection.execute(text("SELECT count(*) FROM book_recipients")).scalar_one() == 1
            )
        for statement in [
            "INSERT INTO book_folder_shares (folder_id) VALUES (1)",
            "INSERT INTO book_folder_shares (folder_id, user_id, department) VALUES (1, 701, 'Finance')",
        ]:
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(text(statement))
        command.upgrade(config, HEAD)
        with engine.connect() as connection:
            assert connection.execute(
                text(
                    "SELECT folder_id, user_id, department_id, department FROM book_folder_shares ORDER BY folder_id"
                )
            ).all() == [
                (1, 701, None, None),
                (2, None, None, " Unknown "),
                (3, None, None, "Shared"),
                (4, 701, None, None),
                (5, None, 2, None),
                (6, 701, None, None),
            ]
            assert (
                connection.execute(text("SELECT count(*) FROM book_department_sends")).scalar_one()
                == 0
            )
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO book_recipients (book_id, user_id, sent_by_user_id, purpose, created_at) VALUES (701, 701, 701, 'info', CURRENT_TIMESTAMP)"
                )
            )
    finally:
        engine.dispose()


def test_downgrade_snapshots_active_derived_head_deputy_and_viewer_audience(tmp_path):
    config = migration_config(tmp_path, "audience.db")
    command.upgrade(config, HEAD)
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        with engine.begin() as connection:
            seed_employees(connection, ["HEAD", "MEMBER", "DISABLED", "EMPTY", "OUTSIDER"])
            seed_users(connection, range(701, 710))
            connection.execute(
                text(
                    "INSERT INTO departments (id, name_en, name_ar, head_employee_id) VALUES (1, 'Finance', 'المالية', 'HEAD'), (2, 'Empty', 'فارغ', 'EMPTY')"
                )
            )
            # Head membership must be included even if materialized membership differs.
            connection.execute(text("UPDATE users SET employee_id = 'HEAD' WHERE id = 702"))
            connection.execute(text("UPDATE users SET employee_id = 'MEMBER' WHERE id = 703"))
            connection.execute(
                text("UPDATE employees SET department_id = 1 WHERE id IN ('MEMBER', 'DISABLED')")
            )
            connection.execute(
                text(
                    "UPDATE users SET employee_id = 'DISABLED', status = 'disabled' WHERE id = 706"
                )
            )
            connection.execute(text("UPDATE users SET status = 'pending' WHERE id = 707"))
            connection.execute(text("UPDATE users SET employee_id = 'OUTSIDER' WHERE id = 708"))
            # An inactive department's head is not part of the live audience.
            connection.execute(text("UPDATE users SET employee_id = 'EMPTY' WHERE id = 709"))
            connection.execute(text("UPDATE departments SET active = 0 WHERE id = 2"))
            connection.execute(
                text("UPDATE employees SET department = 'Finance' WHERE id = 'OUTSIDER'")
            )
            connection.execute(
                text(
                    "INSERT INTO department_members (department_id, user_id, role) VALUES (1, 704, 'deputy'), (1, 705, 'viewer'), (1, 702, 'viewer'), (1, 706, 'viewer'), (1, 707, 'deputy')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO book_folders (id, name, created_by_user_id) VALUES (1, 'Audience', 701), (2, 'Empty', 701), (3, 'Legacy', 701), (4, 'Mixed', 701)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO book_folder_shares (folder_id, department_id) VALUES (1, 1), (2, 2), (4, 1)"
                )
            )
            # Existing explicit shares do not collide, and mixed legacy legs survive.
            connection.execute(
                text("INSERT INTO book_folder_shares (folder_id, user_id) VALUES (1, 702)")
            )
            connection.execute(
                text(
                    "INSERT INTO book_folder_shares (folder_id, department) VALUES (3, ' Unknown '), (4, 'Legacy')"
                )
            )
        command.downgrade(config, PARENT)
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT folder_id, user_id, department FROM book_folder_shares ORDER BY folder_id, user_id"
                )
            ).all()
            assert rows == [
                (1, 702, None),
                (1, 703, None),
                (1, 704, None),
                (1, 705, None),
                (2, 701, None),
                (3, None, " Unknown "),
                (4, None, "Legacy"),
                (4, 702, None),
                (4, 703, None),
                (4, 704, None),
                (4, 705, None),
            ]
            assert not any(uid in {706, 707, 708, 709} for _, uid, _ in rows)
        command.upgrade(config, HEAD)
        with engine.connect() as connection:
            assert (
                connection.execute(
                    text(
                        "SELECT folder_id, user_id, department FROM book_folder_shares ORDER BY folder_id, user_id"
                    )
                ).all()
                == rows
            )
    finally:
        engine.dispose()
