"""Migration 0105: odometer schema parity, constraints, and reversibility."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError

from app.db.models import VehicleOdometerReading

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0105_vehicle_odometer"
PARENT = "0104_book_links"


@pytest.fixture
def at_parent(tmp_path: Path) -> Iterator[tuple[Engine, Config]]:
    database = tmp_path / "vehicle-odometer.db"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database}")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record) -> None:
        connection.execute("PRAGMA foreign_keys = ON")

    try:
        with engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO vehicle_sites (id, name_ar, name_en, created_at) "
                    "VALUES (1, 'اختبار', 'Test', '2026-10-01 00:00:00')"
                )
            )
            c.execute(
                text(
                    "INSERT INTO vehicles (id, plate_number, traffic_code, type_ar, type_en, "
                    "class_ar, class_en, site_id, license_start, license_expiry, created_at) "
                    "VALUES (1, '12345', '123456', 'باص', 'Bus', 'خفيف', 'Light', 1, "
                    "'2026-01-01', '2027-01-01', '2026-10-01 00:00:00')"
                )
            )
        yield engine, config
    finally:
        engine.dispose()


def test_revision_follows_parent_in_single_head_history() -> None:
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1
    assert HEAD in {revision.revision for revision in script.walk_revisions("base", heads[0])}
    assert script.get_revision(HEAD).down_revision == PARENT


def test_upgrade_schema_model_parity_constraints_and_cascade(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    inspector = inspect(engine)
    table = "vehicle_odometer_readings"
    columns = {column["name"]: column for column in inspector.get_columns(table)}
    expected_nullable = {
        "id": False,
        "vehicle_id": False,
        "month": False,
        "opening_km": True,
        "closing_km": False,
        "created_at": False,
        "updated_at": True,
    }
    assert {name: column["nullable"] for name, column in columns.items()} == expected_nullable
    assert {
        column.name: column.nullable for column in VehicleOdometerReading.__table__.columns
    } == expected_nullable
    expected_types = {
        "id": "INTEGER",
        "vehicle_id": "INTEGER",
        "month": "VARCHAR(7)",
        "opening_km": "INTEGER",
        "closing_km": "INTEGER",
        "created_at": "DATETIME",
        "updated_at": "DATETIME",
    }
    assert {name: str(column["type"]) for name, column in columns.items()} == expected_types
    assert {
        column.name: str(column.type) for column in VehicleOdometerReading.__table__.columns
    } == expected_types
    assert inspector.get_pk_constraint(table)["constrained_columns"] == ["id"]
    assert {
        (constraint["name"], tuple(constraint["column_names"]))
        for constraint in inspector.get_unique_constraints(table)
    } == {("uq_vehicle_odometer_month", ("vehicle_id", "month"))}
    assert {constraint["name"] for constraint in inspector.get_check_constraints(table)} == {
        "ck_vehicle_odometer_closing_nonnegative",
        "ck_vehicle_odometer_opening_nonnegative",
    }
    assert {
        (
            tuple(fk["constrained_columns"]),
            fk["referred_table"],
            tuple(fk["referred_columns"]),
            fk["options"]["ondelete"],
        )
        for fk in inspector.get_foreign_keys(table)
    } == {(("vehicle_id",), "vehicles", ("id",), "CASCADE")}
    insert = text(
        "INSERT INTO vehicle_odometer_readings "
        "(vehicle_id, month, opening_km, closing_km, created_at) "
        "VALUES (:vehicle, :month, :opening, :closing, '2026-10-01 00:00:00')"
    )
    values = {"vehicle": 1, "month": "2026-09", "opening": None, "closing": 100}
    with engine.begin() as c:
        c.execute(insert, values)
        c.execute(insert, {**values, "month": "2026-10", "opening": 100, "closing": 200})
    for invalid in (
        values,
        {**values, "vehicle": 999},
        {**values, "month": "2026-11", "opening": -1},
        {**values, "month": "2026-11", "closing": -1},
    ):
        with pytest.raises(IntegrityError), engine.begin() as c:
            c.execute(insert, invalid)
    for name in ("vehicle_id", "month", "closing_km", "created_at"):
        with pytest.raises(IntegrityError), engine.begin() as c:
            c.execute(text(f"UPDATE vehicle_odometer_readings SET {name} = NULL WHERE id = 1"))
    with engine.begin() as c:
        c.execute(text("DELETE FROM vehicles WHERE id = 1"))
        assert c.execute(text("SELECT COUNT(*) FROM vehicle_odometer_readings")).scalar_one() == 0


def test_downgrade_round_trip_preserves_vehicles(at_parent: tuple[Engine, Config]) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO vehicle_odometer_readings (vehicle_id, month, closing_km, created_at) "
                "VALUES (1, '2026-10', 200, '2026-10-01 00:00:00')"
            )
        )
    command.downgrade(config, PARENT)
    with engine.connect() as c:
        assert "vehicle_odometer_readings" not in inspect(c).get_table_names()
        assert "book_links" in inspect(c).get_table_names()
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == PARENT
        assert c.execute(text("SELECT id, plate_number FROM vehicles")).all() == [(1, "12345")]
    command.upgrade(config, HEAD)
    with engine.connect() as c:
        assert "vehicle_odometer_readings" in inspect(c).get_table_names()
        assert c.execute(text("SELECT COUNT(*) FROM vehicle_odometer_readings")).scalar_one() == 0
