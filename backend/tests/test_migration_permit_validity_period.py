from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.db.models import Permit


ROOT = Path(__file__).resolve().parents[2]


def test_permit_model_exposes_validity_columns() -> None:
    assert Permit.__table__.c.validity_value.type.python_type is int
    assert Permit.__table__.c.validity_unit.type.length == 8


def test_permit_validity_migration_backfills_and_downgrades(tmp_path: Path) -> None:
    database = tmp_path / "permit-validity.db"
    engine = create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE permits (
                id INTEGER PRIMARY KEY,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                zones JSON NOT NULL,
                access_areas JSON
            )
            """
        )
        connection.execute(
            text(
                "INSERT INTO permits (id, start_date, end_date, zones, access_areas) "
                "VALUES (1, '2026-01-01', '2026-01-05', :zones, :access)"
            ),
            {"zones": '["green"]', "access": '{"work_residence":true}'},
        )
        connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
        )
        connection.execute(text("INSERT INTO alembic_version VALUES ('0066')"))

    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, "0067")

    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT start_date, end_date, zones, access_areas, "
                "validity_value, validity_unit FROM permits WHERE id = 1"
            )
        ).one()
        assert row.start_date == "2026-01-01"
        assert row.end_date == "2026-01-05"
        assert row.zones == '["green"]'
        assert row.access_areas == '{"work_residence":true}'
        assert row.validity_value == 5
        assert row.validity_unit == "day"
        assert {column["name"] for column in inspect(connection).get_columns("permits")} >= {
            "validity_value",
            "validity_unit",
        }

    command.downgrade(config, "0066")

    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT start_date, end_date, zones, access_areas FROM permits WHERE id = 1")
        ).one()
        assert row == ("2026-01-01", "2026-01-05", '["green"]', '{"work_residence":true}')
        columns = {column["name"] for column in inspect(connection).get_columns("permits")}
        assert "validity_value" not in columns
        assert "validity_unit" not in columns
