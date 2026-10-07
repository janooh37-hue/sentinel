import json
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[2]
_CHECK = "ck_item_permits_zone"


def _insert(conn, column: str, value: str, emp: str) -> None:
    conn.execute(
        text(
            f"INSERT INTO item_permits (employee_id, recipient, {column}, site, items, created_at)"
            " VALUES (:e, 'r', :v, 's', '[]', '2026-10-06 00:00:00')"
        ),
        {"e": emp, "v": value},
    )


def test_item_permit_zones_migration_round_trip(tmp_path: Path) -> None:
    database = tmp_path / "item-permit-zones.db"
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        # item_permits.employee_id FK target: batch mode reflects it.
        connection.exec_driver_sql("CREATE TABLE employees (id VARCHAR(16) PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE alembic_version (version_num VARCHAR(255))")
        connection.exec_driver_sql(
            "INSERT INTO alembic_version VALUES ('0095_employee_status_events')"
        )

    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, "0096_item_permits")

    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=OFF"))
        _insert(conn, "zone", "red", "G1")
        _insert(conn, "zone", "green", "G2")

    def table_sql() -> str:
        with engine.connect() as conn:
            return conn.execute(
                text("SELECT sql FROM sqlite_master WHERE name = 'item_permits'")
            ).scalar_one()

    def columns() -> set[str]:
        return {c["name"] for c in inspect(engine).get_columns("item_permits")}

    assert _CHECK in table_sql()

    command.upgrade(config, "0097_item_permit_zones")
    assert "zones" in columns() and "zone" not in columns()
    assert _CHECK not in table_sql()
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT employee_id, zones FROM item_permits ORDER BY id"))
        assert [(e, json.loads(z)) for e, z in rows] == [("G1", ["red"]), ("G2", ["green"])]
    assert "ix_item_permits_employee" in {
        i["name"] for i in inspect(engine).get_indexes("item_permits")
    }

    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=OFF"))
        _insert(conn, "zones", json.dumps(["work_residence", "green"]), "G3")
        _insert(conn, "zones", json.dumps(["green", "red"]), "G4")

    # work_residence did not exist under the old CHECK -> 'red' fallback;
    # otherwise the first zone is kept.
    command.downgrade(config, "0096_item_permits")
    assert "zone" in columns() and "zones" not in columns()
    assert _CHECK in table_sql()
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT employee_id, zone FROM item_permits ORDER BY id"))
        assert list(rows) == [("G1", "red"), ("G2", "green"), ("G3", "red"), ("G4", "green")]

    command.upgrade(config, "0097_item_permit_zones")
    assert "zones" in columns() and "zone" not in columns()
    assert _CHECK not in table_sql()
    engine.dispose()
