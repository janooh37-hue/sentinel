"""0113 records a head's "keep" on department sends and round-trips populated rows."""

from alembic import command
from sqlalchemy import create_engine, inspect, text

from tests.test_migration_department_sends import (
    migration_config,
    seed_books,
    seed_employees,
    seed_users,
)

PARENT = "0112_department_sends"
HEAD = "0113_department_send_keep"


def _columns(connection) -> set[str]:
    return {column["name"] for column in inspect(connection).get_columns("book_department_sends")}


def test_department_send_keep_migration_round_trip(tmp_path):
    config = migration_config(tmp_path, "keep.db")
    command.upgrade(config, PARENT)
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        with engine.begin() as connection:
            seed_employees(connection, ["H1"])
            seed_users(connection, [701])
            connection.execute(
                text(
                    "INSERT INTO departments (id, name_en, name_ar, head_employee_id) VALUES (1, 'Finance', 'المالية', 'H1')"
                )
            )
            seed_books(connection)
            connection.execute(
                text(
                    "INSERT INTO book_department_sends (id, book_id, department_id, sent_by_user_id, purpose) VALUES (9, 701, 1, 701, 'info')"
                )
            )
        command.upgrade(config, HEAD)
        with engine.begin() as connection:
            assert {"kept_at", "kept_by_user_id"} <= _columns(connection)
            assert connection.execute(
                text("SELECT id, kept_at, kept_by_user_id FROM book_department_sends")
            ).all() == [(9, None, None)]
            connection.execute(
                text(
                    "UPDATE book_department_sends SET kept_at = CURRENT_TIMESTAMP, kept_by_user_id = 701"
                )
            )
        command.downgrade(config, PARENT)
        with engine.begin() as connection:
            assert not {"kept_at", "kept_by_user_id"} & _columns(connection)
            assert connection.execute(
                text("SELECT id, department_id, purpose FROM book_department_sends")
            ).all() == [(9, 1, "info")]
        command.upgrade(config, HEAD)
    finally:
        engine.dispose()
