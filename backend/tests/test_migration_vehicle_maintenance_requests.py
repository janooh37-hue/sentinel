"""Migration 0104: maintenance request schema, constraints, and reversibility."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError

from app.db.models import VehicleMaintenanceRequest

ROOT = Path(__file__).resolve().parents[2]
HEAD = "0104_vehicle_maintenance_requests"
PARENT = "0103_odometer_optional_closing"
TABLE = "vehicle_maintenance_requests"


@pytest.fixture()
def at_parent(tmp_path: Path) -> Iterator[tuple[Engine, Config]]:
    database = tmp_path / "vehicle-maintenance-requests.db"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, PARENT)
    engine = create_engine(f"sqlite:///{database}")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record) -> None:
        connection.execute("PRAGMA foreign_keys = ON")

    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO vehicle_sites (id, name_ar, name_en, created_at) "
                    "VALUES (1, 'اختبار', 'Test', '2026-10-01 00:00:00')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO vehicles (id, plate_number, traffic_code, type_ar, type_en, "
                    "class_ar, class_en, site_id, license_start, license_expiry, created_at) "
                    "VALUES (1, '12345', '123456', 'باص', 'Bus', 'خفيف', 'Light', 1, "
                    "'2026-01-01', '2027-01-01', '2026-10-01 00:00:00')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO employees (id, name_en, created_at, updated_at) "
                    "VALUES ('G1001', 'Test Driver', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO vehicle_odometer_readings "
                    "(vehicle_id, month, opening_km, created_at) "
                    "VALUES (1, '2026-10', 125000, '2026-10-01 00:00:00')"
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


def test_upgrade_schema_model_parity_constraints_and_vehicle_cascade(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    inspector = inspect(engine)
    columns = {column["name"]: column for column in inspector.get_columns(TABLE)}
    expected_nullable = {
        "id": False,
        "vehicle_id": False,
        "employee_id": True,
        "type": False,
        "description": False,
        "odometer_km": True,
        "book_id": True,
        "status": False,
        "maintenance_id": True,
        "created_by_user_id": True,
        "created_at": False,
        "completed_at": True,
    }
    assert {name: column["nullable"] for name, column in columns.items()} == expected_nullable
    assert {
        column.name: column.nullable for column in VehicleMaintenanceRequest.__table__.columns
    } == expected_nullable
    expected_types = {
        "id": "INTEGER",
        "vehicle_id": "INTEGER",
        "employee_id": "VARCHAR(16)",
        "type": "VARCHAR(16)",
        "description": "TEXT",
        "odometer_km": "INTEGER",
        "book_id": "INTEGER",
        "status": "VARCHAR(8)",
        "maintenance_id": "INTEGER",
        "created_by_user_id": "INTEGER",
        "created_at": "DATETIME",
        "completed_at": "DATETIME",
    }
    assert {name: str(column["type"]) for name, column in columns.items()} == expected_types
    assert {
        column.name: str(column.type) for column in VehicleMaintenanceRequest.__table__.columns
    } == expected_types
    assert inspector.get_pk_constraint(TABLE)["constrained_columns"] == ["id"]
    assert {
        (index["name"], tuple(index["column_names"])) for index in inspector.get_indexes(TABLE)
    } == {("ix_vehicle_maintenance_requests_vehicle_status", ("vehicle_id", "status"))}
    assert {constraint["name"] for constraint in inspector.get_check_constraints(TABLE)} == {
        "ck_vehicle_maintenance_requests_type",
        "ck_vehicle_maintenance_requests_status",
    }
    assert {
        (
            tuple(foreign_key["constrained_columns"]),
            foreign_key["referred_table"],
            tuple(foreign_key["referred_columns"]),
            foreign_key["options"].get("ondelete"),
        )
        for foreign_key in inspector.get_foreign_keys(TABLE)
    } == {
        (("vehicle_id",), "vehicles", ("id",), "CASCADE"),
        (("employee_id",), "employees", ("id",), None),
    }
    insert = text(
        "INSERT INTO vehicle_maintenance_requests "
        "(vehicle_id, employee_id, type, description, odometer_km, book_id, status, "
        "maintenance_id, created_by_user_id, created_at) "
        "VALUES (:vehicle, :employee, :type, :description, :odometer, 999, :status, "
        "998, 997, '2026-10-01 00:00:00')"
    )
    values = {
        "vehicle": 1,
        "employee": "G1001",
        "type": "repair",
        "description": "فحص المحرك",
        "odometer": 125000,
        "status": "open",
    }
    with engine.begin() as connection:
        for maintenance_type in ("service", "repair", "tires", "other"):
            connection.execute(insert, {**values, "type": maintenance_type})
        connection.execute(insert, {**values, "employee": None, "odometer": None, "status": "done"})
        connection.execute(
            text(
                "INSERT INTO vehicle_maintenance_requests "
                "(vehicle_id, type, description, created_at) "
                "VALUES (1, 'service', 'تبديل الزيت', '2026-10-01 00:00:00')"
            )
        )
        assert (
            connection.execute(
                text("SELECT status FROM vehicle_maintenance_requests ORDER BY id DESC LIMIT 1")
            ).scalar_one()
            == "open"
        )
    for invalid in (
        {**values, "vehicle": 999},
        {**values, "employee": "G9999"},
        {**values, "type": "inspection"},
        {**values, "status": "closed"},
        {**values, "description": None},
    ):
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(insert, invalid)
    for column in ("vehicle_id", "type", "description", "status", "created_at"):
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(text(f"UPDATE vehicle_maintenance_requests SET {column} = NULL"))
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM vehicles WHERE id = 1"))
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM vehicle_maintenance_requests")
            ).scalar_one()
            == 0
        )
        assert connection.execute(text("SELECT id FROM employees")).all() == [("G1001",)]


def test_downgrade_round_trip_preserves_vehicle_driver_and_odometer(
    at_parent: tuple[Engine, Config],
) -> None:
    engine, config = at_parent
    command.upgrade(config, HEAD)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO vehicle_maintenance_requests "
                "(vehicle_id, employee_id, type, description, created_at) "
                "VALUES (1, 'G1001', 'repair', 'فحص المحرك', '2026-10-01 00:00:00')"
            )
        )
    command.downgrade(config, PARENT)
    with engine.connect() as connection:
        assert TABLE not in inspect(connection).get_table_names()
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == PARENT
        )
        assert connection.execute(text("SELECT id, plate_number FROM vehicles")).all() == [
            (1, "12345")
        ]
        assert connection.execute(text("SELECT id, name_en FROM employees")).all() == [
            ("G1001", "Test Driver")
        ]
        assert connection.execute(
            text("SELECT vehicle_id, month, opening_km, closing_km FROM vehicle_odometer_readings")
        ).all() == [(1, "2026-10", 125000, None)]
    command.upgrade(config, HEAD)
    with engine.connect() as connection:
        assert TABLE in inspect(connection).get_table_names()
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM vehicle_maintenance_requests")
            ).scalar_one()
            == 0
        )
        assert connection.execute(text("SELECT id, plate_number FROM vehicles")).all() == [
            (1, "12345")
        ]
