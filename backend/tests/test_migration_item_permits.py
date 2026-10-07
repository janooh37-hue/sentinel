from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

ROOT = Path(__file__).resolve().parents[2]


def test_item_permits_migration_upgrades_and_downgrades(tmp_path: Path) -> None:
    database = tmp_path / "item-permits.db"
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE alembic_version (version_num VARCHAR(255))")
        connection.exec_driver_sql(
            "INSERT INTO alembic_version VALUES ('0095_employee_status_events')"
        )

    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, "0096_item_permits")

    inspector = inspect(engine)
    assert {c["name"] for c in inspector.get_columns("item_permits")} >= {
        "employee_id",
        "zone",
        "items",
        "book_id",
        "deleted_at",
    }
    assert "ix_item_permits_employee" in {i["name"] for i in inspector.get_indexes("item_permits")}

    command.downgrade(config, "0095_employee_status_events")
    assert "item_permits" not in inspect(engine).get_table_names()
    engine.dispose()
