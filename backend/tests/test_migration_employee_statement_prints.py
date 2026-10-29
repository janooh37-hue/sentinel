"""Migration 0115 adds the statement print serial table and reverses cleanly."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0115_employee_statement_prints"
PARENT = "0114_step_outcome_seen"


def test_single_head_and_round_trip(tmp_path: Path) -> None:
    config = Config(str(ROOT / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {rev.revision for rev in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT
    database = tmp_path / "prints.db"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE employees (id VARCHAR(16) PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO employees VALUES ('G1')")
        connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
        )
        connection.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": PARENT})
    insert = text(
        "INSERT INTO employee_statement_prints (employee_id, serial, kind, to_date, "
        "language, options, printed_at) VALUES ('G1', 1, 'activity', '2026-10-01', 'ar', "
        "'{}', '2026-10-01 08:00:00')"
    )
    try:
        command.upgrade(config, HEAD)
        engine.dispose()
        with engine.begin() as connection:
            indexes = inspect(connection).get_indexes("employee_statement_prints")
            assert {"ix_employee_statement_prints_employee_id"} <= {i["name"] for i in indexes}
            connection.execute(insert)
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(insert)
        command.downgrade(config, PARENT)
        with engine.connect() as connection:
            assert "employee_statement_prints" not in inspect(connection).get_table_names()
            assert connection.scalar(text("SELECT COUNT(*) FROM employees")) == 1
        command.upgrade(config, HEAD)
        with engine.connect() as connection:
            assert "employee_statement_prints" in inspect(connection).get_table_names()
    finally:
        engine.dispose()
