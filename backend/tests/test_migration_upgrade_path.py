"""Real Alembic upgrades must accept both deployed outcome revision identities."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[2]
PARENT = "0109_book_folder_shares"
OUTCOME = "0110_step_outcome_seen"
PRINTS = "0110_employee_statement_prints"
RECONCILED = "0111_step_outcome_seen"
HEAD = "0118_drop_record_category_overreach"


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def _seed_history(connection: Connection) -> None:
    connection.exec_driver_sql("PRAGMA foreign_keys = ON")
    connection.exec_driver_sql(
        "INSERT INTO employees (id, name_en, created_at, updated_at) "
        "VALUES ('TEST-REPAIR', 'Synthetic employee', '2026-10-01', '2026-10-01')"
    )
    connection.exec_driver_sql(
        "INSERT INTO users (id, email, password_hash, employee_id) "
        "VALUES (9001, 'migration@example.invalid', 'not-a-password', 'TEST-REPAIR')"
    )
    connection.exec_driver_sql(
        "INSERT INTO books (id, category_id, ref_number, employee_id, created_at) "
        "SELECT 9001, id, 'SYNTHETIC-REPAIR', 'TEST-REPAIR', '2026-10-01' "
        "FROM book_categories ORDER BY id LIMIT 1"
    )
    for step_id, state, decided_at in (
        (9001, "approved", "2026-10-01 12:00:00"),
        (9002, "returned", "2026-10-02 12:00:00"),
        (9003, "rejected", "2026-10-03 12:00:00"),
        (9004, "pending", None),
        (9005, "approved", None),
    ):
        connection.execute(
            text(
                "INSERT INTO book_approval_steps "
                "(id, book_id, step_order, stage_label, assignee_user_id, state, decided_at) "
                "VALUES (:id, 9001, :id, 'Synthetic signing', 9001, :state, :decided_at)"
            ),
            {"id": step_id, "state": state, "decided_at": decided_at},
        )


def _seed_print(connection: Connection) -> None:
    connection.exec_driver_sql(
        "INSERT INTO employee_statement_prints "
        "(id, employee_id, serial, kind, to_date, language, options, printed_at) "
        "VALUES (9001, 'TEST-REPAIR', 7, 'activity', '2026-10-01', 'ar', "
        "'{\"synthetic\":true}', '2026-10-01 08:00:00')"
    )


def _seed_store(connection: Connection) -> None:
    connection.exec_driver_sql(
        "INSERT INTO store_items "
        "(id, code, name_en, category_id, counting_unit_en, counting_unit_ar) "
        "VALUES (9001, 'ST-9001', 'Synthetic item', 1, 'Unit', 'Unit')"
    )
    connection.exec_driver_sql("INSERT INTO store_batches (id, item_id) VALUES (9001, 9001)")
    connection.exec_driver_sql(
        "INSERT INTO store_deliveries (id, received_on) VALUES (9001, '2026-10-01')"
    )
    connection.exec_driver_sql(
        "INSERT INTO store_delivery_lines (delivery_id, batch_id, quantity) VALUES (9001, 9001, 10)"
    )
    connection.exec_driver_sql(
        "INSERT INTO store_counts (id, month, counted_on) VALUES (9001, '2026-10', '2026-10-02')"
    )
    connection.exec_driver_sql(
        "INSERT INTO store_count_lines (count_id, batch_id, quantity) VALUES (9001, 9001, 8)"
    )
    connection.exec_driver_sql(
        "INSERT INTO store_disposals (batch_id, disposed_on, quantity, reason) "
        "VALUES (9001, '2026-10-03', 1, 'damaged')"
    )


def _snapshot(connection: Connection) -> dict[str, tuple[list[str], list[tuple]]]:
    inspector = inspect(connection)
    tables = ["employees", "users", "books", "book_approval_steps"]
    tables += [
        name
        for name in inspector.get_table_names()
        if name == "employee_statement_prints" or name.startswith("store_")
    ]
    return {
        table: (
            [column["name"] for column in inspector.get_columns(table)],
            [
                tuple(row)
                for row in connection.exec_driver_sql(f'SELECT * FROM "{table}" ORDER BY id')
            ],
        )
        for table in tables
    }


def _assert_preserved(connection: Connection, before: dict) -> None:
    for table, (columns, rows) in before.items():
        selected = ", ".join(f'"{column}"' for column in columns)
        assert [
            tuple(row)
            for row in connection.exec_driver_sql(f'SELECT {selected} FROM "{table}" ORDER BY id')
        ] == rows, table
    assert connection.exec_driver_sql("PRAGMA integrity_check").scalars().all() == ["ok"]
    assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []


@pytest.mark.parametrize(
    "starting_revisions",
    [
        (PARENT,),
        (PRINTS,),
        (OUTCOME,),
        (PRINTS, OUTCOME),
        (RECONCILED,),
        ("0112_store",),
        ("0113_store_room",),
        (HEAD,),
    ],
    ids=[
        "shared-parent",
        "prints-only",
        "historical-outcome",
        "deployed-split",
        "renamed-outcome",
        "store",
        "store-room",
        "store-count",
    ],
)
def test_populated_deployed_paths_preserve_rows(
    tmp_path: Path, starting_revisions: tuple[str, ...]
) -> None:
    database = tmp_path / "historical.db"
    config = _config(database)
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    try:
        with engine.begin() as connection:
            _seed_history(connection)
        for revision in starting_revisions:
            command.upgrade(config, revision)
        with engine.begin() as connection:
            tables = inspect(connection).get_table_names()
            has_outcome = "outcome_seen_at" in {
                column["name"] for column in inspect(connection).get_columns("book_approval_steps")
            }
            if has_outcome:
                # Post-migration unread redecisions and explicit later acknowledgements
                # must survive reconciliation: neither historical backfill may replay.
                connection.exec_driver_sql(
                    "UPDATE book_approval_steps SET outcome_seen_at = NULL WHERE id = 9002"
                )
                connection.exec_driver_sql(
                    "UPDATE book_approval_steps SET outcome_seen_at = '2026-10-04 09:00:00' "
                    "WHERE id = 9003"
                )
            if "employee_statement_prints" in tables:
                _seed_print(connection)
            if "store_items" in tables:
                _seed_store(connection)
            before = _snapshot(connection)
        command.upgrade(config, "head")
        with engine.connect() as connection:
            _assert_preserved(connection, before)
            assert connection.exec_driver_sql(
                "SELECT version_num FROM alembic_version"
            ).scalars().all() == [HEAD]
            assert connection.exec_driver_sql(
                "SELECT outcome_seen_at FROM book_approval_steps ORDER BY id"
            ).scalars().all() == [
                "2026-10-01 12:00:00",
                None if has_outcome else "2026-10-02 12:00:00",
                "2026-10-04 09:00:00" if has_outcome else "2026-10-03 12:00:00",
                None,
                None,
            ]
            assert {
                "employee_statement_prints",
                "store_items",
                "store_handovers",
                "store_item_aliases",
            } <= set(inspect(connection).get_table_names())
        # A merge-only downgrade must not remove the column it does not own.
        command.downgrade(config, RECONCILED)
        with engine.connect() as connection:
            before_unmerge = _snapshot(connection)
        for target in (OUTCOME, PRINTS):
            command.downgrade(config, target)
            with engine.connect() as connection:
                assert set(
                    connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalars()
                ) == {PRINTS, OUTCOME}
                _assert_preserved(connection, before_unmerge)
            command.upgrade(config, RECONCILED)
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.exec_driver_sql(
                "SELECT outcome_seen_at FROM book_approval_steps WHERE id = 9002"
            ).scalar() == (None if has_outcome else "2026-10-02 12:00:00")
            if "employee_statement_prints" in tables:
                assert (
                    connection.exec_driver_sql(
                        "SELECT serial FROM employee_statement_prints WHERE id = 9001"
                    ).scalar()
                    == 7
                )
    finally:
        engine.dispose()


def test_empty_database_reaches_head_and_reverses_new_schema(tmp_path: Path) -> None:
    database = tmp_path / "empty.db"
    config = _config(database)
    command.upgrade(config, "head")
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    try:
        with engine.connect() as connection:
            assert (
                connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar()
                == HEAD
            )
            assert connection.exec_driver_sql("PRAGMA integrity_check").scalar() == "ok"
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        command.downgrade(config, PARENT)
        with engine.connect() as connection:
            tables = inspect(connection).get_table_names()
            assert "employee_statement_prints" not in tables
            assert not any(table.startswith("store_") for table in tables)
            assert "outcome_seen_at" not in {
                column["name"] for column in inspect(connection).get_columns("book_approval_steps")
            }
            assert connection.exec_driver_sql("PRAGMA integrity_check").scalar() == "ok"
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        command.upgrade(config, "head")
    finally:
        engine.dispose()
