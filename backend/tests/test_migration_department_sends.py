"""Department-send migration preserves restricted folder audiences on a round trip."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0112_department_sends"
PARENT = "0111_book_department"


def test_department_sends_migration_round_trip(tmp_path: Path) -> None:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option(
        "sqlalchemy.url", f"sqlite:///{(tmp_path / 'departments.db').as_posix()}"
    )
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT
    command.upgrade(config, PARENT)
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (id, email, password_hash, role, status) "
                    "VALUES (701, 'migration-departments@x.ae', 'x', 'operator', 'active')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO departments (id, name_en, name_ar, parent_id) VALUES "
                    "(1, 'Finance', 'المالية', NULL), (2, 'Operations', 'العمليات', NULL), "
                    "(3, 'Shared', 'مشترك', NULL), (4, 'Shared', 'فرع مشترك', 2)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO book_folders (id, name, created_by_user_id) "
                    "VALUES (:id, :name, 701)"
                ),
                [{"id": value, "name": f"Restricted {value}"} for value in range(1, 7)],
            )
            connection.execute(
                text(
                    "INSERT INTO book_folder_shares (id, folder_id, department) "
                    "VALUES (:id, :folder_id, :department)"
                ),
                [
                    {"id": 1, "folder_id": 1, "department": "Finance"},
                    {"id": 2, "folder_id": 1, "department": " finance "},
                    {"id": 3, "folder_id": 1, "department": " المالية "},
                    {"id": 4, "folder_id": 2, "department": " Unknown "},
                    {"id": 5, "folder_id": 3, "department": "Shared"},
                    {"id": 6, "folder_id": 5, "department": "Future Name"},
                ],
            )
            connection.execute(
                text("INSERT INTO book_folder_shares (folder_id, user_id) VALUES (4, 701)")
            )
            connection.execute(
                text("INSERT OR IGNORE INTO book_categories (id, prefix) VALUES ('HR', 'HR')")
            )
            connection.execute(
                text(
                    "INSERT INTO books (id, category_id, ref_number, search_text, created_at) "
                    "VALUES (701, 'HR', 'HR-0701', 'migration', '2026-10-01 00:00:00')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO book_recipients "
                    "(book_id, user_id, sent_by_user_id, purpose, created_at) "
                    "VALUES (701, 701, 701, 'info', '2026-10-01 00:00:00')"
                )
            )
        command.upgrade(config, HEAD)
        with engine.begin() as connection:
            inspector = inspect(connection)
            assert connection.execute(
                text(
                    "SELECT folder_id, user_id, department_id, department "
                    "FROM book_folder_shares ORDER BY folder_id"
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
            send_columns = {
                column["name"]: column for column in inspector.get_columns("book_department_sends")
            }
            assert send_columns["purpose"]["type"].length == 16
            assert send_columns["created_at"]["nullable"] is False
            assert send_columns["created_at"]["default"] is not None
            foreign_keys = {
                tuple(key["constrained_columns"]): key
                for key in inspector.get_foreign_keys("book_department_sends")
            }
            assert foreign_keys[("book_id",)]["referred_table"] == "books"
            assert foreign_keys[("book_id",)]["options"]["ondelete"] == "CASCADE"
            assert foreign_keys[("department_id",)]["referred_table"] == "departments"
            assert foreign_keys[("parent_send_id",)]["referred_table"] == "book_department_sends"
            assert not any(
                "department_send_id" in foreign_key["constrained_columns"]
                for foreign_key in inspector.get_foreign_keys("book_recipients")
            )
            assert not any(
                "department_id" in foreign_key["constrained_columns"]
                for foreign_key in inspector.get_foreign_keys("book_folder_shares")
            )
            connection.execute(text("UPDATE departments SET name_en = 'Future Name' WHERE id = 2"))
            connection.execute(
                text(
                    "INSERT INTO book_folder_shares (folder_id, department_id) "
                    "VALUES (5, 2), (6, 3), (6, 4)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO book_department_sends "
                    "(id, book_id, department_id, parent_send_id, sent_by_user_id, purpose) "
                    "VALUES (1, 701, 1, NULL, 701, 'info'), (2, 701, 2, 1, 701, 'action')"
                )
            )
            connection.execute(
                text("UPDATE book_recipients SET department_send_id = 1 WHERE book_id = 701")
            )
        invalid_statements = [
            "INSERT INTO book_folder_shares (folder_id) VALUES (1)",
            "INSERT INTO book_folder_shares (folder_id, user_id, department_id) VALUES (1, 701, 1)",
            "INSERT INTO book_folder_shares (folder_id, department_id, department) "
            "VALUES (1, 1, 'Finance')",
            "INSERT INTO book_folder_shares (folder_id, department_id) VALUES (1, 1)",
            "INSERT INTO book_department_sends (book_id, department_id, sent_by_user_id, purpose) "
            "VALUES (701, 1, 701, 'info')",
            "INSERT INTO book_department_sends (book_id, department_id, sent_by_user_id, purpose) "
            "VALUES (701, 3, 701, 'sign')",
        ]
        for statement in invalid_statements:
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(text(statement))
        with engine.begin() as connection:
            connection.execute(
                text("UPDATE book_department_sends SET revoked_at = CURRENT_TIMESTAMP WHERE id = 1")
            )
            connection.execute(
                text(
                    "INSERT INTO book_department_sends "
                    "(book_id, department_id, sent_by_user_id, purpose) VALUES (701, 1, 701, 'reply')"
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
                connection.execute(text("SELECT COUNT(*) FROM book_recipients")).scalar_one() == 1
            )
        for statement in (
            "INSERT INTO book_folder_shares (folder_id) VALUES (1)",
            "INSERT INTO book_folder_shares (folder_id, user_id, department) "
            "VALUES (1, 701, 'Finance')",
        ):
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(text(statement))
        command.upgrade(config, HEAD)
        with engine.connect() as connection:
            assert connection.execute(
                text(
                    "SELECT folder_id, user_id, department_id, department "
                    "FROM book_folder_shares ORDER BY folder_id"
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
                connection.execute(text("SELECT COUNT(*) FROM book_department_sends")).scalar_one()
                == 0
            )
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO book_recipients "
                    "(book_id, user_id, sent_by_user_id, purpose, created_at) "
                    "VALUES (701, 701, 701, 'info', CURRENT_TIMESTAMP)"
                )
            )
    finally:
        engine.dispose()


def _visible_folder_ids(connection: Connection, user_id: int) -> set[int]:
    """Execute the folder audience rule against either side of the migration."""
    department_leg = ""
    if "department_id" in {
        column["name"] for column in inspect(connection).get_columns("book_folder_shares")
    }:
        department_leg = (
            " OR shares.department_id IN "
            "(SELECT department_id FROM department_members WHERE user_id = account.id)"
        )
    return set(
        connection.execute(
            text(
                "SELECT folder.id FROM book_folders AS folder "
                "JOIN users AS account ON account.id = :user_id "
                "LEFT JOIN employees AS employee ON employee.id = account.employee_id "
                "WHERE folder.owner_user_id = account.id OR (folder.owner_user_id IS NULL AND ("
                "NOT EXISTS (SELECT 1 FROM book_folder_shares WHERE folder_id = folder.id) "
                "OR EXISTS (SELECT 1 FROM book_folder_shares AS shares "
                "WHERE shares.folder_id = folder.id AND (shares.user_id = account.id "
                "OR lower(trim(shares.department)) = lower(trim(employee.department))"
                f"{department_leg}))))"
            ),
            {"user_id": user_id},
        ).scalars()
    )


def test_department_folder_visibility_survives_downgrade(tmp_path: Path) -> None:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{(tmp_path / 'visibility.db').as_posix()}")
    command.upgrade(config, PARENT)
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO employees (id, name_en, department, created_at, updated_at) "
                    "VALUES (:id, :name, :department, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                [
                    {"id": f"G{uid}", "name": f"User {uid}", "department": department}
                    for uid, department in [
                        (702, "Elsewhere"),
                        (703, "Finance"),
                        (704, "Shared"),
                        (705, "Other"),
                        (706, ""),
                        (707, "Another"),
                        (708, "Elsewhere"),
                    ]
                ],
            )
            connection.execute(
                text(
                    "INSERT INTO users (id, email, password_hash, role, status, employee_id) "
                    "VALUES (:id, :email, 'x', 'operator', 'active', :employee_id)"
                ),
                [
                    {
                        "id": uid,
                        "email": f"visibility-{uid}@test.ae",
                        "employee_id": f"G{uid}" if uid != 701 else None,
                    }
                    for uid in range(701, 709)
                ],
            )
            connection.execute(
                text(
                    "INSERT INTO departments (id, name_en, name_ar, parent_id) VALUES "
                    "(1, 'Finance', 'المالية', NULL), (2, 'Shared', 'مشترك', NULL), "
                    "(3, 'Shared', 'فرع مشترك', 2), (4, 'Empty', 'فارغ', NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO department_members (department_id, user_id, role, is_primary) "
                    "VALUES (1, 702, 'head', 1), (1, 708, 'member', 1), "
                    "(2, 705, 'member', 1), (3, 707, 'member', 1)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO book_folders (id, name, created_by_user_id) VALUES "
                    "(1, 'Arabic-only share', 701), (2, 'Ambiguous legacy', 701), "
                    "(3, 'Empty department', 701)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO book_folder_shares (folder_id, department) VALUES "
                    "(1, ' المالية '), (2, ' Shared '), (3, 'Empty')"
                )
            )
            # Existing explicit recipients must not collide with the membership snapshot.
            connection.execute(
                text("INSERT INTO book_folder_shares (folder_id, user_id) VALUES (1, 702)")
            )
        command.upgrade(config, HEAD)
        with engine.connect() as connection:
            assert connection.execute(
                text(
                    "SELECT department_id, department FROM book_folder_shares "
                    "WHERE folder_id = 1 AND user_id IS NULL"
                )
            ).one() == (1, None)
            assert connection.execute(
                text("SELECT department_id, department FROM book_folder_shares WHERE folder_id = 2")
            ).one() == (None, " Shared ")
            expected = {
                701: set(),
                702: {1},
                703: set(),
                704: {2},
                705: set(),
                706: set(),
                707: set(),
                708: {1},
            }
            assert {uid: _visible_folder_ids(connection, uid) for uid in expected} == expected
        command.downgrade(config, PARENT)
        with engine.connect() as connection:
            expected[701] = {3}  # Empty departments retain a creator-only restriction.
            assert {uid: _visible_folder_ids(connection, uid) for uid in expected} == expected
            assert connection.execute(
                text(
                    "SELECT user_id, department FROM book_folder_shares "
                    "WHERE folder_id = 1 ORDER BY user_id"
                )
            ).all() == [(702, None), (708, None)]
            assert connection.execute(
                text("SELECT user_id, department FROM book_folder_shares WHERE folder_id = 2")
            ).one() == (None, " Shared ")
        command.upgrade(config, HEAD)
        with engine.connect() as connection:
            assert {uid: _visible_folder_ids(connection, uid) for uid in expected} == expected
    finally:
        engine.dispose()
