"""Migration 0118 is linear, reversible and matches former-number ownership."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.db.session import attach_sqlite_pragmas

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0119_employee_former_ids"
PARENT = "0118_drop_record_category_overreach"


def test_single_head_roundtrip_and_foreign_keys(tmp_path: Path) -> None:
    config = Config(str(ROOT / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    assert script.get_heads() == [HEAD]
    database = tmp_path / "former_ids.db"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    engine = create_engine(f"sqlite:///{database}")
    attach_sqlite_pragmas(engine, wal=False)
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE employees (id VARCHAR(16) PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO employees VALUES ('G100')")
        connection.exec_driver_sql("INSERT INTO users VALUES (1)")
        connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(64) NOT NULL)"
        )
        connection.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": PARENT})
    try:
        command.upgrade(config, HEAD)
        engine.dispose()
        with engine.begin() as connection:
            indexes = inspect(connection).get_indexes("employee_former_ids")
            assert {index["name"] for index in indexes} == {
                "ix_employee_former_ids_employee_id",
                "ix_employee_former_ids_former_id",
            }
            assert all(not index["unique"] for index in indexes)
            for _ in range(2):
                connection.exec_driver_sql(
                    "INSERT INTO employee_former_ids (employee_id, former_id, new_id, changed_at, changed_by_user_id, reason) "
                    "VALUES ('G100', 'G099', 'G100', '2026-11-10 08:00:00', 1, 'Corrected number')"
                )
            connection.exec_driver_sql("DELETE FROM users WHERE id = 1")
            assert (
                connection.scalar(
                    text(
                        "SELECT count(*) FROM employee_former_ids WHERE changed_by_user_id IS NULL"
                    )
                )
                == 2
            )
            connection.exec_driver_sql("DELETE FROM employees WHERE id = 'G100'")
            assert connection.scalar(text("SELECT count(*) FROM employee_former_ids")) == 0
        command.downgrade(config, PARENT)
        engine.dispose()
        with engine.connect() as connection:
            assert "employee_former_ids" not in inspect(connection).get_table_names()
        command.upgrade(config, HEAD)
        engine.dispose()
        with engine.connect() as connection:
            assert "employee_former_ids" in inspect(connection).get_table_names()
    finally:
        engine.dispose()
