from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[2]
VEHICLE_TABLES = {
    "vehicle_sites",
    "vehicles",
    "vehicle_files",
    "vehicle_license_renewals",
    "vehicle_fines",
    "vehicle_accidents",
    "vehicle_maintenance",
}


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option(
        "script_location",
        str(ROOT / "backend" / "app" / "db" / "migrations"),
    )
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


@pytest.fixture
def migrated_0083(tmp_path: Path) -> Iterator[tuple[Config, Engine]]:
    config = _config(tmp_path / "vehicles-migration.db")
    command.upgrade(config, "0083_vehicles")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        yield config, engine
    finally:
        engine.dispose()


PROFILE_COLUMNS = {
    "make",
    "model",
    "model_year",
    "colour",
    "insurance_expiry",
    "inmate_capacity",
    "passenger_capacity",
    "accessories_ar",
    "accessories_en",
    "notes_ar",
    "notes_en",
    "archived_at",
    "insurance_reminder_sent_for",
}


@pytest.fixture
def migrated_0085(tmp_path: Path) -> Iterator[tuple[Config, Engine]]:
    config = _config(tmp_path / "vehicle-profile-migration.db")
    command.upgrade(config, "0085_vehicle_profile_archive")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        yield config, engine
    finally:
        engine.dispose()


def _plateless_unique_indexes(connection: Any) -> list[dict[str, Any]]:
    matches = []
    for index in inspect(connection).get_indexes("vehicles"):
        where = str(index.get("dialect_options", {}).get("sqlite_where", "")).lower()
        if (
            index["unique"]
            and index["column_names"] == ["plate_number"]
            and "plate_code" in where
            and "is null" in where
        ):
            matches.append(index)
    return matches


def _vehicle_columns(connection: Any) -> set[str]:
    return {column["name"] for column in inspect(connection).get_columns("vehicles")}


def test_0085_profile_columns_round_trip_over_populated_vehicles(
    migrated_0085: tuple[Config, Engine],
) -> None:
    config, engine = migrated_0085

    with engine.begin() as connection:
        assert _vehicle_columns(connection) >= PROFILE_COLUMNS
        connection.execute(
            text(
                "INSERT INTO vehicle_sites (name_ar, name_en, created_at) "
                "VALUES ('الموقع', 'Site', '2026-01-01 00:00:00')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO vehicles ("
                "plate_code, plate_number, traffic_code, type_ar, type_en, class_ar, class_en, "
                "vin, site_id, license_start, license_expiry, created_at, "
                "make, model, model_year, colour, insurance_expiry, inmate_capacity, "
                "passenger_capacity, accessories_ar, accessories_en, notes_ar, notes_en, "
                "archived_at, insurance_reminder_sent_for"
                ") VALUES ("
                "'14', '58216', '1180021637', 'تويوتا هايس', 'Toyota Hiace', "
                "'باص خفيف', 'Light bus', 'JT123456789012345', 1, "
                "'2026-01-01', '2026-12-31', '2026-01-01 00:00:00', "
                "'Toyota', 'Hiace', 2024, 'White', '2026-11-30', 0, 12, "
                "'مكيف', 'AC unit', 'ملاحظة', 'Note', "
                "'2026-02-01 00:00:00', '2026-11-30'"
                ")"
            )
        )
        # A legacy row that predates the profile columns keeps them unset.
        connection.execute(
            text(
                "INSERT INTO vehicles ("
                "plate_code, plate_number, traffic_code, type_ar, type_en, class_ar, class_en, "
                "site_id, license_start, license_expiry, created_at"
                ") VALUES ("
                "NULL, '99001', '1180021638', 'مركبة', 'Vehicle', 'خفيفة', 'Light', "
                "1, '2026-01-01', '2026-12-31', '2026-01-01 00:00:00'"
                ")"
            )
        )

    command.downgrade(config, "0084_merge_0083_heads")

    with engine.begin() as connection:
        assert PROFILE_COLUMNS.isdisjoint(_vehicle_columns(connection))
        surviving = (
            connection.execute(
                text(
                    "SELECT plate_code, plate_number, traffic_code, type_en, class_en, vin, "
                    "site_id, license_start, license_expiry FROM vehicles ORDER BY id"
                )
            )
            .mappings()
            .all()
        )
        assert [dict(row) for row in surviving] == [
            {
                "plate_code": "14",
                "plate_number": "58216",
                "traffic_code": "1180021637",
                "type_en": "Toyota Hiace",
                "class_en": "Light bus",
                "vin": "JT123456789012345",
                "site_id": 1,
                "license_start": "2026-01-01",
                "license_expiry": "2026-12-31",
            },
            {
                "plate_code": None,
                "plate_number": "99001",
                "traffic_code": "1180021638",
                "type_en": "Vehicle",
                "class_en": "Light",
                "vin": None,
                "site_id": 1,
                "license_start": "2026-01-01",
                "license_expiry": "2026-12-31",
            },
        ]
        # The partial plate-uniqueness index must survive the batch rebuild.
        assert len(_plateless_unique_indexes(connection)) == 1
        with pytest.raises(IntegrityError):
            connection.execute(
                text(
                    "INSERT INTO vehicles ("
                    "plate_code, plate_number, traffic_code, type_ar, type_en, "
                    "class_ar, class_en, site_id, license_start, license_expiry, created_at"
                    ") VALUES ("
                    "NULL, '99001', '1180021639', 'مركبة', 'Vehicle', 'خفيفة', 'Light', "
                    "1, '2026-01-01', '2026-12-31', '2026-01-01 00:00:00'"
                    ")"
                )
            )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        assert _vehicle_columns(connection) >= PROFILE_COLUMNS
        assert len(_plateless_unique_indexes(connection)) == 1
        # Re-upgrading never backfills synthetic profile facts.
        reupgraded = (
            connection.execute(
                text(
                    "SELECT make, model, model_year, colour, insurance_expiry, inmate_capacity, "
                    "passenger_capacity, accessories_ar, accessories_en, notes_ar, notes_en, "
                    "archived_at, insurance_reminder_sent_for FROM vehicles ORDER BY id"
                )
            )
            .mappings()
            .all()
        )
        assert len(reupgraded) == 2
        for row in reupgraded:
            assert set(row.keys()) == PROFILE_COLUMNS
            assert all(value is None for value in row.values()), dict(row)


def test_0083_rejects_duplicate_number_for_plates_without_a_code(
    migrated_0083: tuple[Config, Engine],
) -> None:
    _, engine = migrated_0083
    vehicle_insert = text(
        "INSERT INTO vehicles ("
        "plate_code, plate_number, traffic_code, type_ar, type_en, class_ar, class_en, "
        "site_id, license_start, license_expiry, created_at"
        ") VALUES ("
        "NULL, :plate_number, :traffic_code, 'مركبة', 'Vehicle', 'خفيفة', 'Light', "
        "1, '2026-01-01', '2026-12-31', '2026-01-01 00:00:00'"
        ")"
    )

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO vehicle_sites (name_ar, name_en, created_at) "
                "VALUES ('الموقع', 'Site', '2026-01-01 00:00:00')"
            )
        )
        connection.execute(
            vehicle_insert,
            {"plate_number": "58216", "traffic_code": "1180021637"},
        )

        with pytest.raises(IntegrityError):
            connection.execute(
                vehicle_insert,
                {"plate_number": "58216", "traffic_code": "1180021638"},
            )

        indexes = inspect(connection).get_indexes("vehicles")
        null_code_unique_indexes = []
        for index in indexes:
            where = str(index.get("dialect_options", {}).get("sqlite_where", "")).lower()
            if (
                index["unique"]
                and index["column_names"] == ["plate_number"]
                and "plate_code" in where
                and "is null" in where
            ):
                null_code_unique_indexes.append(index)

        assert len(null_code_unique_indexes) == 1, indexes


def test_0083_downgrade_keeps_referenced_category_and_removes_vehicle_tables(
    migrated_0083: tuple[Config, Engine],
) -> None:
    config, engine = migrated_0083

    with engine.begin() as connection:
        categories = connection.execute(
            text(
                "SELECT id, name_en, name_ar, prefix FROM book_categories "
                "WHERE id IN ('VF', 'VA') ORDER BY id"
            )
        ).mappings()
        assert [dict(row) for row in categories] == [
            {
                "id": "VA",
                "name_en": "Vehicle Accidents",
                "name_ar": "حوادث المركبات",
                "prefix": "VA",
            },
            {
                "id": "VF",
                "name_en": "Vehicle Fines",
                "name_ar": "مخالفات المركبات",
                "prefix": "VF",
            },
        ]
        connection.execute(
            text(
                "INSERT INTO books (category_id, ref_number, created_at) "
                "VALUES ('VF', 'VF-0001', '2026-01-01 00:00:00')"
            )
        )

    command.downgrade(config, "0082_service_records_caps")

    with engine.connect() as connection:
        assert VEHICLE_TABLES.isdisjoint(inspect(connection).get_table_names())
        remaining_categories = connection.execute(
            text("SELECT id FROM book_categories WHERE id IN ('VF', 'VA') ORDER BY id")
        ).scalars()
        assert list(remaining_categories) == ["VF"]
        assert (
            connection.execute(
                text("SELECT category_id FROM books WHERE ref_number = 'VF-0001'")
            ).scalar_one()
            == "VF"
        )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        assert set(inspect(connection).get_table_names()) >= VEHICLE_TABLES
        restored_categories = connection.execute(
            text("SELECT id FROM book_categories WHERE id IN ('VF', 'VA') ORDER BY id")
        ).scalars()
        assert list(restored_categories) == ["VA", "VF"]
