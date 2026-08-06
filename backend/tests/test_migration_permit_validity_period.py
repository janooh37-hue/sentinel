from datetime import date, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.db.models import Permit
from app.schemas.permit import PermitRead

ROOT = Path(__file__).resolve().parents[2]


def test_permit_model_exposes_validity_columns_and_unit_constraint() -> None:
    assert Permit.__table__.c.validity_value.type.python_type is int
    assert Permit.__table__.c.validity_unit.type.length == 8
    assert "ck_permits_validity_unit" in {
        constraint.name for constraint in Permit.__table__.constraints
    }


def test_metadata_created_permit_rejects_invalid_validity_unit() -> None:
    engine = create_engine("sqlite://")
    Permit.__table__.create(engine)
    with engine.begin() as connection, pytest.raises(IntegrityError):
        connection.execute(
            Permit.__table__.insert().values(
                company="ACME",
                zones=["green"],
                start_date=date(2026, 1, 1),
                validity_value=1,
                validity_unit="fortnight",
                end_date=date(2026, 1, 1),
                created_at=datetime(2026, 1, 1),
            )
        )


def test_permit_read_accepts_legacy_ten_year_period() -> None:
    permit = PermitRead.model_validate(
        {
            "id": 1,
            "company": "Legacy ACME",
            "zones": ["green"],
            "access_areas": {"al_wathba_1": ["green"]},
            "start_date": date(2016, 1, 1),
            "validity": {"value": 3653, "unit": "day"},
            "end_date": date(2025, 12, 31),
            "status": "active",
            "created_at": datetime(2016, 1, 1),
        }
    )
    assert permit.start_date == date(2016, 1, 1)
    assert permit.end_date == date(2025, 12, 31)
    assert permit.validity.value == 3653


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
                "VALUES (1, '2016-01-01', '2025-12-31', :zones, :access)"
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
        assert row.start_date == "2016-01-01"
        assert row.end_date == "2025-12-31"
        assert row.zones == '["green"]'
        assert row.access_areas == '{"work_residence":true}'
        assert row.validity_value == 3653
        assert row.validity_unit == "day"
        assert {column["name"] for column in inspect(connection).get_columns("permits")} >= {
            "validity_value",
            "validity_unit",
        }
        with pytest.raises(IntegrityError):
            connection.execute(
                text(
                    "INSERT INTO permits "
                    "(id, start_date, end_date, zones, access_areas, "
                    "validity_value, validity_unit) "
                    "VALUES (2, '2016-01-01', '2025-12-31', :zones, :access, 1, 'fortnight')"
                ),
                {"zones": '["green"]', "access": '{"work_residence":true}'},
            )

    command.downgrade(config, "0066")

    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT start_date, end_date, zones, access_areas FROM permits WHERE id = 1")
        ).one()
        assert row == ("2016-01-01", "2025-12-31", '["green"]', '{"work_residence":true}')
        columns = {column["name"] for column in inspect(connection).get_columns("permits")}
        assert "validity_value" not in columns
        assert "validity_unit" not in columns

    command.upgrade(config, "0067")

    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT start_date, end_date, validity_value, validity_unit "
                "FROM permits WHERE id = 1"
            )
        ).one()
        assert row == ("2016-01-01", "2025-12-31", 3653, "day")
