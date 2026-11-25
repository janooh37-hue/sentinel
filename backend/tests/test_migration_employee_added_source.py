"""Migration 0125 distinguishes bulk imports from historical individual additions."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[2]
REVISION = "0125_employee_added_source"
PARENT = "0124_id_release_denies"


def test_employee_added_backfill_marks_only_bulk_minutes_and_reverses(tmp_path: Path) -> None:
    url = f"sqlite:///{(tmp_path / 'employee_added.db').as_posix()}"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, PARENT)

    employees = [
        *[(f"G10{i}", f"2026-06-24 08:01:{i:02}") for i in range(5)],
        *[(f"G20{i}", f"2026-06-24 08:02:{i:02}") for i in range(4)],
        ("G300", "2026-06-25 08:01:00"),
    ]
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO employees (id, name_en, created_at, updated_at) "
                    "VALUES (:id, :id, :created_at, :created_at)"
                ),
                [
                    {"id": employee_id, "created_at": created_at}
                    for employee_id, created_at in employees
                ],
            )

        assert ScriptDirectory.from_config(config).get_revision(REVISION).down_revision == PARENT
        command.upgrade(config, REVISION)
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT id, imported, created_by_user_id FROM employees ORDER BY id")
            ).all() == [(employee_id, i < 5, None) for i, (employee_id, _) in enumerate(employees)]

        command.downgrade(config, PARENT)
        with engine.connect() as connection:
            columns = {column["name"] for column in inspect(connection).get_columns("employees")}
            assert {"imported", "created_by_user_id"}.isdisjoint(columns)
            assert (
                connection.execute(text("SELECT id, created_at FROM employees ORDER BY id")).all()
                == employees
            )
    finally:
        engine.dispose()
