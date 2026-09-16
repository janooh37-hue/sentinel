from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
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


def test_0087_preserves_legacy_assignments_and_downgrades_live_selection_safely(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "vehicle-photo-migration.db"
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    config = _config(database)
    command.upgrade(config, "0086_merge_0085_heads")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    original_relative = "vehicle_files/1/photo/legacy.webp"
    original_path = data_dir / original_relative
    original_path.parent.mkdir(parents=True)
    original_path.write_bytes(b"legacy-original")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO vehicle_sites (name_ar, name_en, created_at) "
                    "VALUES ('الموقع', 'Site', '2026-01-01 00:00:00')"
                )
            )
            for index, archived_at in enumerate((None, "2026-02-01 00:00:00", None, None), start=1):
                connection.execute(
                    text(
                        """
                        INSERT INTO vehicles (
                            plate_number,
                            traffic_code,
                            type_ar,
                            type_en,
                            class_ar,
                            class_en,
                            site_id,
                            license_start,
                            license_expiry,
                            archived_at,
                            created_at
                        )
                        VALUES (
                            :plate_number,
                            :traffic_code,
                            'مركبة',
                            'Vehicle',
                            'خفيفة',
                            'Light',
                            1,
                            '2026-01-01',
                            '2026-12-31',
                            :archived_at,
                            '2026-01-01 00:00:00'
                        )
                        """
                    ),
                    {
                        "plate_number": f"70{index:03d}",
                        "traffic_code": f"11800216{index:02d}",
                        "archived_at": archived_at,
                    },
                )
            connection.execute(
                text(
                    """
                    INSERT INTO vehicle_files (
                        id,
                        vehicle_id,
                        kind,
                        path,
                        original_name,
                        media_type,
                        size,
                        created_at
                    )
                    VALUES (
                        1,
                        1,
                        'photo',
                        :path,
                        'legacy.webp',
                        'image/webp',
                        15,
                        '2026-01-01 00:00:00'
                    )
                    """
                ),
                {"path": original_relative},
            )
            connection.execute(text("UPDATE vehicles SET photo_file_id = 1 WHERE id IN (1, 2)"))
            connection.execute(text("UPDATE vehicles SET photo_file_id = 999 WHERE id = 3"))

        command.upgrade(config, "0087_vehicle_photo_library")
        with engine.connect() as connection:
            columns = _vehicle_columns(connection)
            assert "photo_asset_id" in columns
            assert "photo_file_id" not in columns
            pointers = list(
                connection.execute(
                    text("SELECT photo_asset_id FROM vehicles ORDER BY id")
                ).scalars()
            )
            assert pointers[0] == pointers[1]
            assert pointers[0] is not None
            assert pointers[2] is not None and pointers[2] != pointers[0]
            assert pointers[3] is None
            assignments = connection.execute(
                text(
                    "SELECT vehicle_id, photo_file_id FROM "
                    "vehicle_photo_legacy_assignments ORDER BY vehicle_id"
                )
            ).all()
            assert [tuple(row) for row in assignments] == [(1, 1), (2, 1), (3, 999)]

        command.downgrade(config, "0086_merge_0085_heads")
        with engine.connect() as connection:
            assert list(
                connection.execute(text("SELECT photo_file_id FROM vehicles ORDER BY id")).scalars()
            ) == [1, 1, 999, None]
            assert original_path.read_bytes() == b"legacy-original"

        command.upgrade(config, "0087_vehicle_photo_library")
        shared_relative = "vehicle_photos/new/full.webp"
        shared_path = data_dir / shared_relative
        shared_path.parent.mkdir(parents=True)
        shared_path.write_bytes(b"new-shared-photo")
        with engine.begin() as connection:
            inserted = connection.execute(
                text(
                    """
                    INSERT INTO vehicle_photo_assets (
                        label_ar,
                        label_en,
                        original_name,
                        content_hash,
                        width,
                        height,
                        thumbnail_path,
                        preview_path,
                        full_path,
                        created_at
                    )
                    VALUES (
                        'مشترك',
                        'Shared',
                        'shared.webp',
                        :content_hash,
                        100,
                        80,
                        :path,
                        :path,
                        :path,
                        '2026-09-10 00:00:00'
                    )
                    """
                ),
                {"content_hash": "a" * 64, "path": shared_relative},
            )
            assert inserted.lastrowid is not None
            new_asset_id = int(inserted.lastrowid)
            connection.execute(text("UPDATE vehicles SET photo_asset_id = NULL WHERE id = 1"))
            connection.execute(
                text("UPDATE vehicles SET photo_asset_id = :asset_id WHERE id IN (2, 4)"),
                {"asset_id": new_asset_id},
            )

        from app.config import get_settings

        monkeypatch.setattr(get_settings(), "data_dir", data_dir)
        command.downgrade(config, "0086_merge_0085_heads")
        with engine.connect() as connection:
            downgraded = connection.execute(
                text(
                    """
                    SELECT vehicle.id, vehicle.photo_file_id, file.path
                    FROM vehicles AS vehicle
                    LEFT JOIN vehicle_files AS file ON file.id = vehicle.photo_file_id
                    ORDER BY vehicle.id
                    """
                )
            ).all()
            assert tuple(downgraded[0]) == (1, None, None)
            assert tuple(downgraded[2]) == (3, 999, None)
            assert downgraded[1][1] not in {None, 1}
            assert downgraded[3][1] not in {None, 1}
            copied_paths = {
                str(downgraded[1][2]),
                str(downgraded[3][2]),
            }
            assert len(copied_paths) == 2
            assert shared_relative not in copied_paths
            assert all(
                (data_dir / path).read_bytes() == b"new-shared-photo" for path in copied_paths
            )
            assert original_path.read_bytes() == b"legacy-original"

        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == ScriptDirectory.from_config(config).get_current_head()
            )
            restored = list(
                connection.execute(
                    text("SELECT photo_asset_id FROM vehicles ORDER BY id")
                ).scalars()
            )
            assert restored[0] is None
            assert restored[1] is not None
            assert restored[2] is not None
            assert restored[3] is not None
    finally:
        engine.dispose()


@pytest.fixture
def migrated_0088(tmp_path: Path) -> Iterator[tuple[Config, Engine]]:
    config = _config(tmp_path / "vehicle-fines-ledger-migration.db")
    command.upgrade(config, "0088_inmate_statistics_workflow")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        yield config, engine
    finally:
        engine.dispose()


def _seed_vehicle_and_site(connection: Any) -> None:
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
            "site_id, license_start, license_expiry, created_at"
            ") VALUES ("
            "'14', '58216', '1180021637', 'مركبة', 'Vehicle', 'خفيفة', 'Light', "
            "1, '2026-01-01', '2026-12-31', '2026-01-01 00:00:00'"
            ")"
        )
    )


def test_0089_converts_legacy_amounts_to_exact_fils_and_backfills_unknown(
    migrated_0088: tuple[Config, Engine],
) -> None:
    config, engine = migrated_0088

    with engine.begin() as connection:
        _seed_vehicle_and_site(connection)
        connection.execute(
            text(
                "INSERT INTO vehicle_fines (vehicle_id, date, amount, amount_after_discount, "
                "black_points, source, created_at) "
                "VALUES (1, '2026-08-20', 349, 300, 4, 'manual', '2026-08-20 00:00:00')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO vehicle_fines (vehicle_id, date, amount, black_points, source, "
                "created_at) "
                "VALUES (1, '2026-08-21', 725, 0, 'manual', '2026-08-21 00:00:00')"
            )
        )

    command.upgrade(config, "0089_vehicle_fines_ledger")

    with engine.connect() as connection:
        rows = (
            connection.execute(
                text(
                    "SELECT amount_fils, amount_after_discount_fils, payment_status, "
                    "receipt_file_id, archived_at FROM vehicle_fines ORDER BY id"
                )
            )
            .mappings()
            .all()
        )
        assert [dict(row) for row in rows] == [
            {
                "amount_fils": 34900,
                "amount_after_discount_fils": 30000,
                "payment_status": "unknown",
                "receipt_file_id": None,
                "archived_at": None,
            },
            {
                "amount_fils": 72500,
                "amount_after_discount_fils": None,
                "payment_status": "unknown",
                "receipt_file_id": None,
                "archived_at": None,
            },
        ]
        columns = {column["name"] for column in inspect(connection).get_columns("vehicle_fines")}
        assert "amount" not in columns
        assert "amount_after_discount" not in columns


def test_0089_downgrade_restores_legacy_columns_for_untouched_rows(
    migrated_0088: tuple[Config, Engine],
) -> None:
    config, engine = migrated_0088

    with engine.begin() as connection:
        _seed_vehicle_and_site(connection)
        connection.execute(
            text(
                "INSERT INTO vehicle_fines (vehicle_id, date, amount, amount_after_discount, "
                "black_points, source, created_at) "
                "VALUES (1, '2026-08-20', 349, 300, 4, 'manual', '2026-08-20 00:00:00')"
            )
        )

    command.upgrade(config, "0089_vehicle_fines_ledger")
    command.downgrade(config, "0088_inmate_statistics_workflow")

    with engine.connect() as connection:
        row = dict(
            connection.execute(
                text("SELECT amount, amount_after_discount FROM vehicle_fines WHERE id = 1")
            )
            .mappings()
            .one()
        )
        assert row == {"amount": 349, "amount_after_discount": 300}
        columns = {column["name"] for column in inspect(connection).get_columns("vehicle_fines")}
        assert "amount_fils" not in columns
        assert "payment_status" not in columns
        assert "receipt_file_id" not in columns
        assert "archived_at" not in columns

    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version"))
            == ScriptDirectory.from_config(config).get_current_head()
        )


@pytest.mark.parametrize(
    "mutate_sql",
    [
        "UPDATE vehicle_fines SET payment_status = 'paid' WHERE id = 1",
        "UPDATE vehicle_fines SET archived_at = '2026-09-01 00:00:00' WHERE id = 1",
        "UPDATE vehicle_fines SET receipt_file_id = 999 WHERE id = 1",
    ],
)
def test_0089_downgrade_refuses_to_discard_paid_archived_or_receipted_fines(
    migrated_0088: tuple[Config, Engine],
    mutate_sql: str,
) -> None:
    config, engine = migrated_0088

    with engine.begin() as connection:
        _seed_vehicle_and_site(connection)
        connection.execute(
            text(
                "INSERT INTO vehicle_fines (vehicle_id, date, amount, black_points, source, "
                "created_at) "
                "VALUES (1, '2026-08-20', 349, 4, 'manual', '2026-08-20 00:00:00')"
            )
        )

    command.upgrade(config, "0089_vehicle_fines_ledger")
    with engine.begin() as connection:
        connection.execute(text(mutate_sql))

    with pytest.raises(RuntimeError, match="Cannot downgrade"):
        command.downgrade(config, "0088_inmate_statistics_workflow")

    # Refused before mutating: still on the fils schema with the row intact.
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT COUNT(*) FROM vehicle_fines WHERE amount_fils = 34900"))
            == 1
        )


def test_0089_downgrade_refuses_fractional_amounts(
    migrated_0088: tuple[Config, Engine],
) -> None:
    config, engine = migrated_0088

    with engine.begin() as connection:
        _seed_vehicle_and_site(connection)
        connection.execute(
            text(
                "INSERT INTO vehicle_fines (vehicle_id, date, amount, black_points, source, "
                "created_at) "
                "VALUES (1, '2026-08-20', 349, 4, 'manual', '2026-08-20 00:00:00')"
            )
        )

    command.upgrade(config, "0089_vehicle_fines_ledger")
    with engine.begin() as connection:
        # A fractional fils amount (349.50 AED) has no whole-AED representation.
        connection.execute(text("UPDATE vehicle_fines SET amount_fils = 34950 WHERE id = 1"))

    with pytest.raises(RuntimeError, match="Cannot downgrade"):
        command.downgrade(config, "0088_inmate_statistics_workflow")


CERTIFICATE_COLUMNS = {
    "expiry_date",
    "expiry_reminder_sent_for",
    "is_historical",
    "superseded_by_file_id",
}


def _vehicle_file_columns(connection: Any) -> set[str]:
    return {column["name"] for column in inspect(connection).get_columns("vehicle_files")}


def test_0090_certificate_columns_round_trip_over_populated_vehicle_files(
    tmp_path: Path,
) -> None:
    config = _config(tmp_path / "vehicle-certificates-migration.db")
    command.upgrade(config, "0089_vehicle_fines_ledger")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))

    try:
        with engine.begin() as connection:
            assert CERTIFICATE_COLUMNS.isdisjoint(_vehicle_file_columns(connection))
            _seed_vehicle_and_site(connection)
            # A pre-existing non-certificate file row (photo) survives untouched.
            connection.execute(
                text(
                    "INSERT INTO vehicle_files ("
                    "vehicle_id, kind, label_ar, label_en, path, original_name, media_type, size, "
                    "created_at"
                    ") VALUES ("
                    "1, 'photo', NULL, NULL, 'vehicle_files/1/photo/a.jpg', 'a.jpg', "
                    "'image/jpeg', 1024, '2026-01-01 00:00:00'"
                    ")"
                )
            )

        command.upgrade(config, "0090_vehicle_certificates")

        with engine.begin() as connection:
            assert _vehicle_file_columns(connection) >= CERTIFICATE_COLUMNS
            photo_row = (
                connection.execute(
                    text(
                        "SELECT expiry_date, expiry_reminder_sent_for, is_historical, "
                        "superseded_by_file_id FROM vehicle_files WHERE kind = 'photo'"
                    )
                )
                .mappings()
                .one()
            )
            assert photo_row["expiry_date"] is None
            assert photo_row["expiry_reminder_sent_for"] is None
            assert photo_row["is_historical"] == 0
            assert photo_row["superseded_by_file_id"] is None

            # Dated, non-expiring, historical, and replacement metadata all persist.
            connection.execute(
                text(
                    "INSERT INTO vehicle_files ("
                    "vehicle_id, kind, label_ar, label_en, path, original_name, media_type, size, "
                    "created_at, expiry_date, expiry_reminder_sent_for, is_historical, "
                    "superseded_by_file_id"
                    ") VALUES ("
                    "1, 'certificate', 'شهادة', 'Certificate', "
                    "'vehicle_files/1/certificate/b.pdf', 'b.pdf', 'application/pdf', 2048, "
                    "'2026-02-01 00:00:00', '2027-01-01', NULL, 0, NULL"
                    ")"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO vehicle_files ("
                    "vehicle_id, kind, label_ar, label_en, path, original_name, media_type, size, "
                    "created_at, expiry_date, expiry_reminder_sent_for, is_historical, "
                    "superseded_by_file_id"
                    ") VALUES ("
                    "1, 'certificate', 'شهادة قديمة', 'Old certificate', "
                    "'vehicle_files/1/certificate/c.pdf', 'c.pdf', 'application/pdf', 1024, "
                    "'2026-01-15 00:00:00', '2026-06-01', '2026-06-01', 1, 2"
                    ")"
                )
            )

        command.downgrade(config, "0089_vehicle_fines_ledger")

        with engine.begin() as connection:
            assert CERTIFICATE_COLUMNS.isdisjoint(_vehicle_file_columns(connection))
            surviving = (
                connection.execute(
                    text("SELECT kind, original_name, size FROM vehicle_files ORDER BY id")
                )
                .mappings()
                .all()
            )
            assert [dict(row) for row in surviving] == [
                {"kind": "photo", "original_name": "a.jpg", "size": 1024},
                {"kind": "certificate", "original_name": "b.pdf", "size": 2048},
                {"kind": "certificate", "original_name": "c.pdf", "size": 1024},
            ]

        command.upgrade(config, "head")

        with engine.connect() as connection:
            assert _vehicle_file_columns(connection) >= CERTIFICATE_COLUMNS
            # Re-upgrading never resurrects the removed metadata.
            rows = (
                connection.execute(
                    text(
                        "SELECT expiry_date, expiry_reminder_sent_for, is_historical, "
                        "superseded_by_file_id FROM vehicle_files ORDER BY id"
                    )
                )
                .mappings()
                .all()
            )
            assert len(rows) == 3
            for row in rows:
                assert row["expiry_date"] is None
                assert row["expiry_reminder_sent_for"] is None
                assert row["is_historical"] == 0
                assert row["superseded_by_file_id"] is None
    finally:
        engine.dispose()


def test_alembic_history_has_exactly_one_head(tmp_path: Path) -> None:
    config = _config(tmp_path / "heads-check.db")
    script = ScriptDirectory.from_config(config)
    assert len(script.get_heads()) == 1
