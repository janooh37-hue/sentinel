from __future__ import annotations

import io
import json
from pathlib import Path

from alembic import command
from alembic.config import Config
from PIL import Image
from sqlalchemy import create_engine, text

from scripts.convert_vehicle_photos import run_conversion

ROOT = Path(__file__).resolve().parents[2]


def _config(database: Path) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "backend" / "app" / "db" / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def _png(colour: str) -> bytes:
    output = io.BytesIO()
    with Image.new("RGB", (32, 20), colour) as image:
        image.save(output, format="PNG")
    return output.getvalue()


def test_conversion_is_dry_by_default_backed_up_exact_and_idempotent(
    tmp_path: Path,
) -> None:
    database = tmp_path / "fleet-copy.db"
    data_dir = tmp_path / "data-copy"
    data_dir.mkdir()
    config = _config(database)
    command.upgrade(config, "0086_merge_0085_heads")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    red = _png("red")
    first_relative = "vehicle_files/1/photo/first.png"
    second_relative = "vehicle_files/2/photo/second.png"
    for relative in (first_relative, second_relative):
        path = data_dir / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(red)
    starter_dir = tmp_path / "approved-starters"
    starter_dir.mkdir()
    (starter_dir / "blue.png").write_bytes(_png("blue"))
    manifest = starter_dir / "manifest.json"
    manifest.write_text(
        json.dumps(
            [
                {
                    "filename": "blue.png",
                    "label_ar": "مركبة زرقاء",
                    "label_en": "Blue vehicle",
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO vehicle_sites (name_ar, name_en, created_at) "
                    "VALUES ('الموقع', 'Site', '2026-01-01 00:00:00')"
                )
            )
            for vehicle_id in (1, 2):
                connection.execute(
                    text(
                        """
                        INSERT INTO vehicles (
                            id,
                            plate_number,
                            traffic_code,
                            type_ar,
                            type_en,
                            class_ar,
                            class_en,
                            site_id,
                            license_start,
                            license_expiry,
                            photo_file_id,
                            created_at
                        )
                        VALUES (
                            :id,
                            :plate,
                            :traffic,
                            'مركبة',
                            'Vehicle',
                            'خفيفة',
                            'Light',
                            1,
                            '2026-01-01',
                            '2026-12-31',
                            :id,
                            '2026-01-01 00:00:00'
                        )
                        """
                    ),
                    {
                        "id": vehicle_id,
                        "plate": f"8000{vehicle_id}",
                        "traffic": f"118002170{vehicle_id}",
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
                            :id,
                            :id,
                            'photo',
                            :path,
                            :name,
                            'image/png',
                            :size,
                            '2026-01-01 00:00:00'
                        )
                        """
                    ),
                    {
                        "id": vehicle_id,
                        "path": first_relative if vehicle_id == 1 else second_relative,
                        "name": f"legacy-{vehicle_id}.png",
                        "size": len(red),
                    },
                )

        command.upgrade(config, "0087_vehicle_photo_library")
        with engine.connect() as connection:
            original_pointers = list(
                connection.execute(
                    text("SELECT photo_asset_id FROM vehicles ORDER BY id")
                ).scalars()
            )
            assert len(set(original_pointers)) == 2

        dry_run = run_conversion(
            database=database,
            data_dir=data_dir,
            apply=False,
            seed_starters=True,
            starter_manifest=manifest,
        )
        assert dry_run["backup"] is None
        assert [row["status"] for row in dry_run["legacy"]] == [
            "would_materialize",
            "would_merge",
        ]
        assert dry_run["starters"][0]["status"] == "would_create"
        with engine.connect() as connection:
            assert (
                connection.scalar(
                    text("SELECT count(*) FROM vehicle_photo_assets WHERE content_hash IS NOT NULL")
                )
                == 0
            )
        assert not (data_dir / "vehicle_photos").exists()

        applied = run_conversion(
            database=database,
            data_dir=data_dir,
            apply=True,
            seed_starters=True,
            starter_manifest=manifest,
            backup_dir=tmp_path / "backups",
        )
        assert applied["summary"]["failures"] == 0
        assert Path(applied["backup"]).is_file()
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM vehicle_photo_assets")) == 3
            assert (
                connection.scalar(
                    text("SELECT count(*) FROM vehicle_photo_assets WHERE content_hash IS NOT NULL")
                )
                == 2
            )
            assert (
                connection.scalar(
                    text(
                        "SELECT count(*) FROM vehicle_photo_assets "
                        "WHERE canonical_asset_id IS NOT NULL"
                    )
                )
                == 1
            )
            alias_paths = connection.execute(
                text(
                    "SELECT original_path, thumbnail_path, preview_path, full_path "
                    "FROM vehicle_photo_assets WHERE canonical_asset_id IS NOT NULL"
                )
            ).one()
            assert tuple(alias_paths) == (None, None, None, None)
            shared_pointers = list(
                connection.execute(
                    text("SELECT photo_asset_id FROM vehicles ORDER BY id")
                ).scalars()
            )
            assert len(set(shared_pointers)) == 1
            mappings = connection.execute(
                text(
                    "SELECT photo_file_id, photo_asset_id FROM "
                    "vehicle_photo_legacy_assignments ORDER BY vehicle_id"
                )
            ).all()
            assert [row[0] for row in mappings] == [1, 2]
            assert len({row[1] for row in mappings}) == 1
        assert (data_dir / first_relative).read_bytes() == red
        assert (data_dir / second_relative).read_bytes() == red

        repeated = run_conversion(
            database=database,
            data_dir=data_dir,
            apply=True,
            seed_starters=True,
            starter_manifest=manifest,
            backup_dir=tmp_path / "backups",
        )
        assert repeated["summary"]["failures"] == 0
        assert all(
            row["status"] in {"already_materialized", "already_merged"}
            for row in repeated["legacy"]
        )
        assert repeated["starters"][0]["status"] == "already_present"
        assert Path(repeated["backup"]).is_file()
        assert repeated["backup"] != applied["backup"]
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM vehicle_photo_assets")) == 3
        assert len([path for path in (data_dir / "vehicle_photos").iterdir() if path.is_dir()]) == 2

        command.downgrade(config, "0086_merge_0085_heads")
        with engine.connect() as connection:
            assert list(
                connection.execute(text("SELECT photo_file_id FROM vehicles ORDER BY id")).scalars()
            ) == [1, 2]
        assert (data_dir / first_relative).read_bytes() == red
        assert (data_dir / second_relative).read_bytes() == red
    finally:
        engine.dispose()
