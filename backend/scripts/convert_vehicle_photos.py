"""Backed-up, rerunnable vehicle-photo conversion and starter seeding.

Both ``--database`` and ``--data-dir`` are required. The command is read-only
unless ``--apply`` is supplied; starter assets are added only with the separate
``--seed-starters`` switch. It never assigns starters to vehicles or removes
legacy/recovery files.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

EXPECTED_REVISION = "0087_vehicle_photo_library"
DEFAULT_MANIFEST = BACKEND_ROOT / "assets" / "vehicle_photos" / "manifest.json"


class ConversionTargetError(RuntimeError):
    """The explicit database/data target is unsafe or has the wrong schema."""


def _absolute_existing_file(path: Path, *, description: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise ConversionTargetError(f"{description} does not exist: {resolved}")
    return resolved


def _absolute_existing_dir(path: Path, *, description: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_dir():
        raise ConversionTargetError(f"{description} does not exist: {resolved}")
    return resolved


def _database_revision(database: Path) -> str:
    try:
        with closing(
            sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
        ) as connection:
            row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
    except sqlite3.Error as exc:
        raise ConversionTargetError(f"Could not inspect database schema: {exc}") from exc
    if row is None or not isinstance(row[0], str):
        raise ConversionTargetError("Database has no Alembic revision.")
    return row[0]


def _require_current_schema(database: Path) -> None:
    revision = _database_revision(database)
    if revision != EXPECTED_REVISION:
        raise ConversionTargetError(
            f"Database revision is {revision!r}; migrate the explicit copy to "
            f"{EXPECTED_REVISION!r} before conversion. No writes were made."
        )
    required = {"vehicle_photo_assets", "vehicle_photo_legacy_assignments"}
    with closing(sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)) as connection:
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    missing = required - tables
    if missing:
        raise ConversionTargetError(
            f"Database revision claims {EXPECTED_REVISION}, but tables are missing: "
            f"{', '.join(sorted(missing))}. No writes were made."
        )


def _backup_database(database: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    destination = backup_dir / f"{database.stem}-vehicle-photos-{stamp}.db"
    counter = 1
    while destination.exists():
        destination = backup_dir / f"{database.stem}-vehicle-photos-{stamp}-{counter}.db"
        counter += 1
    with (
        closing(sqlite3.connect(database)) as source,
        closing(sqlite3.connect(destination)) as target,
    ):
        source.backup(target)
        target.commit()
    return destination


def _contained_file(data_dir: Path, relative_path: str) -> Path:
    path = (data_dir / relative_path).resolve()
    if not path.is_relative_to(data_dir) or not path.is_file():
        raise ConversionTargetError(
            f"Legacy source is missing or outside --data-dir: {relative_path}"
        )
    return path


def _legacy_rows(database: Path) -> list[sqlite3.Row]:
    with closing(sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        return connection.execute(
            """
            SELECT
                asset.id,
                asset.legacy_file_id,
                asset.content_hash,
                asset.canonical_asset_id,
                asset.original_path,
                asset.thumbnail_path,
                asset.preview_path,
                asset.full_path,
                file.path AS legacy_path
            FROM vehicle_photo_assets AS asset
            LEFT JOIN vehicle_files AS file ON file.id = asset.legacy_file_id
            WHERE asset.legacy_file_id IS NOT NULL
            ORDER BY asset.id
            """
        ).fetchall()


def _processed_hashes(database: Path) -> dict[str, int]:
    with closing(sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)) as connection:
        return {
            str(content_hash): int(asset_id)
            for asset_id, content_hash in connection.execute(
                """
                SELECT id, content_hash
                FROM vehicle_photo_assets
                WHERE content_hash IS NOT NULL
                ORDER BY id
                """
            ).fetchall()
        }


def _manifest_entries(manifest: Path) -> list[dict[str, str | None]]:
    manifest = _absolute_existing_file(manifest, description="Starter manifest")
    root = manifest.parent.resolve()
    try:
        raw = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConversionTargetError(f"Could not read starter manifest: {exc}") from exc
    if not isinstance(raw, list):
        raise ConversionTargetError("Starter manifest must be a JSON array.")

    entries: list[dict[str, str | None]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ConversionTargetError(f"Starter manifest item {index} must be an object.")
        filename = item.get("filename")
        label_ar = item.get("label_ar")
        label_en = item.get("label_en")
        if not isinstance(filename, str) or not filename.strip():
            raise ConversionTargetError(f"Starter manifest item {index} has no usable filename.")
        if label_ar is not None and not isinstance(label_ar, str):
            raise ConversionTargetError(f"Starter manifest item {index} label_ar must be text.")
        if label_en is not None and not isinstance(label_en, str):
            raise ConversionTargetError(f"Starter manifest item {index} label_en must be text.")
        if not (str(label_ar or "").strip() or str(label_en or "").strip()):
            raise ConversionTargetError(
                f"Starter manifest item {index} needs label_ar or label_en."
            )
        source = (root / filename).resolve()
        if not source.is_relative_to(root) or not source.is_file():
            raise ConversionTargetError(
                f"Starter manifest item {index} is missing or escapes its directory: {filename}"
            )
        entries.append(
            {
                "filename": filename,
                "label_ar": label_ar.strip() or None if isinstance(label_ar, str) else None,
                "label_en": label_en.strip() or None if isinstance(label_en, str) else None,
            }
        )
    return entries


def _failure(exc: Exception) -> dict[str, str]:
    code = getattr(exc, "code", exc.__class__.__name__)
    return {"code": str(code), "message": str(exc)}


def _dry_run(
    *,
    database: Path,
    data_dir: Path,
    manifest: Path | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    from app.core.vehicle_photos import process_photo

    known = _processed_hashes(database)
    legacy_report: list[dict[str, Any]] = []
    for row in _legacy_rows(database):
        item: dict[str, Any] = {
            "asset_id": int(row["id"]),
            "legacy_file_id": int(row["legacy_file_id"]),
        }
        if row["canonical_asset_id"] is not None:
            item.update(
                status="already_merged",
                canonical_asset_id=int(row["canonical_asset_id"]),
            )
            legacy_report.append(item)
            continue
        ready = all(
            row[name] is not None
            for name in (
                "content_hash",
                "original_path",
                "thumbnail_path",
                "preview_path",
                "full_path",
            )
        )
        if ready:
            item.update(status="already_materialized", content_hash=str(row["content_hash"]))
            legacy_report.append(item)
            continue
        try:
            legacy_path = row["legacy_path"]
            if not isinstance(legacy_path, str):
                raise ConversionTargetError("Legacy file row does not exist.")
            processed = process_photo(_contained_file(data_dir, legacy_path).read_bytes())
            canonical_id = known.get(processed.content_hash)
            if canonical_id is None:
                known[processed.content_hash] = int(row["id"])
                item.update(status="would_materialize", content_hash=processed.content_hash)
            else:
                item.update(
                    status="would_merge",
                    content_hash=processed.content_hash,
                    canonical_asset_id=canonical_id,
                )
        except Exception as exc:
            item.update(status="failed", error=_failure(exc))
        legacy_report.append(item)

    starter_report: list[dict[str, Any]] = []
    if manifest is not None:
        for entry in _manifest_entries(manifest):
            item = {"filename": entry["filename"]}
            try:
                source = manifest.resolve().parent / str(entry["filename"])
                processed = process_photo(source.read_bytes())
                canonical_id = known.get(processed.content_hash)
                if canonical_id is None:
                    item.update(status="would_create", content_hash=processed.content_hash)
                    known[processed.content_hash] = -1
                else:
                    item.update(
                        status="already_present",
                        content_hash=processed.content_hash,
                        canonical_asset_id=canonical_id if canonical_id >= 0 else None,
                    )
            except Exception as exc:
                item.update(status="failed", error=_failure(exc))
            starter_report.append(item)
    return legacy_report, starter_report


def _apply(
    *,
    database: Path,
    data_dir: Path,
    manifest: Path | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import sessionmaker

    previous_data_dir_env = os.environ.get("GSSG_DATA_DIR")
    os.environ["GSSG_DATA_DIR"] = str(data_dir)
    from app.config import get_settings

    settings = get_settings()
    previous_data_dir = settings.data_dir
    settings.data_dir = data_dir
    from app.core.vehicle_photos import process_photo
    from app.db.models import VehiclePhotoAsset
    from app.db.session import _sqlite_url_for, attach_sqlite_pragmas
    from app.services import vehicle_photo_service

    engine = create_engine(_sqlite_url_for(str(database)), future=True)
    attach_sqlite_pragmas(engine)
    make_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    legacy_report: list[dict[str, Any]] = []
    starter_report: list[dict[str, Any]] = []
    try:
        with make_session() as db:
            for row in _legacy_rows(database):
                asset_id = int(row["id"])
                item: dict[str, Any] = {
                    "asset_id": asset_id,
                    "legacy_file_id": int(row["legacy_file_id"]),
                }
                try:
                    before = db.get(VehiclePhotoAsset, asset_id)
                    if before is None:
                        item.update(status="already_merged")
                    else:
                        was_alias = before.canonical_asset_id is not None
                        was_ready = all(
                            value is not None
                            for value in (
                                before.content_hash,
                                before.original_path,
                                before.thumbnail_path,
                                before.preview_path,
                                before.full_path,
                            )
                        )
                        result = vehicle_photo_service.materialize_photo_asset(db, asset_id)
                        item.update(
                            status=(
                                "already_merged"
                                if was_alias
                                else "already_materialized"
                                if was_ready
                                else "materialized"
                                if result.id == asset_id
                                else "merged"
                            ),
                            canonical_asset_id=result.id,
                            content_hash=result.content_hash,
                        )
                except Exception as exc:
                    db.rollback()
                    item.update(status="failed", error=_failure(exc))
                legacy_report.append(item)

            if manifest is not None:
                for entry in _manifest_entries(manifest):
                    item = {"filename": entry["filename"]}
                    try:
                        source = manifest.resolve().parent / str(entry["filename"])
                        data = source.read_bytes()
                        processed = process_photo(data)
                        content_hash = processed.content_hash
                        existing_id = db.scalar(
                            select(VehiclePhotoAsset.id).where(
                                VehiclePhotoAsset.content_hash == content_hash
                            )
                        )
                        asset = vehicle_photo_service.create_photo_asset(
                            db,
                            filename=str(entry["filename"]),
                            data=data,
                            label_ar=entry["label_ar"],
                            label_en=entry["label_en"],
                            processed=processed,
                        )
                        item.update(
                            status="already_present" if existing_id is not None else "created",
                            canonical_asset_id=asset.id,
                            content_hash=asset.content_hash,
                        )
                    except Exception as exc:
                        db.rollback()
                        item.update(status="failed", error=_failure(exc))
                    starter_report.append(item)
    finally:
        engine.dispose()
        settings.data_dir = previous_data_dir
        if previous_data_dir_env is None:
            os.environ.pop("GSSG_DATA_DIR", None)
        else:
            os.environ["GSSG_DATA_DIR"] = previous_data_dir_env
    return legacy_report, starter_report


def run_conversion(
    *,
    database: Path,
    data_dir: Path,
    apply: bool,
    seed_starters: bool,
    starter_manifest: Path = DEFAULT_MANIFEST,
    backup_dir: Path | None = None,
) -> dict[str, Any]:
    database = _absolute_existing_file(database, description="SQLite database")
    data_dir = _absolute_existing_dir(data_dir, description="Data directory")
    _require_current_schema(database)
    manifest = starter_manifest.expanduser().resolve() if seed_starters else None
    if manifest is not None:
        _manifest_entries(manifest)

    backup: Path | None = None
    if apply:
        destination = (
            backup_dir.expanduser().resolve()
            if backup_dir is not None
            else database.parent / "backups"
        )
        backup = _backup_database(database, destination)
        legacy, starters = _apply(
            database=database,
            data_dir=data_dir,
            manifest=manifest,
        )
    else:
        legacy, starters = _dry_run(
            database=database,
            data_dir=data_dir,
            manifest=manifest,
        )

    failures = sum(item.get("status") == "failed" for item in [*legacy, *starters])
    return {
        "mode": "apply" if apply else "dry-run",
        "database": str(database),
        "data_dir": str(data_dir),
        "schema_revision": EXPECTED_REVISION,
        "backup": str(backup) if backup is not None else None,
        "legacy": legacy,
        "starters": starters,
        "summary": {
            "legacy_count": len(legacy),
            "starter_count": len(starters),
            "failures": failures,
        },
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Dry-run or apply the reusable vehicle-photo conversion."
    )
    parser.add_argument("--database", type=Path, required=True, help="Explicit SQLite DB path")
    parser.add_argument("--data-dir", type=Path, required=True, help="Explicit data directory")
    parser.add_argument("--apply", action="store_true", help="Write after creating a SQLite backup")
    parser.add_argument(
        "--seed-starters",
        action="store_true",
        help="Also seed the approved manifest assets; never assigns them to vehicles",
    )
    parser.add_argument(
        "--starter-manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help="Starter JSON manifest (used only with --seed-starters)",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="Backup destination (apply only; default: <database-dir>/backups)",
    )
    parser.add_argument("--report", type=Path, help="Optional JSON report output path")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        report = run_conversion(
            database=args.database,
            data_dir=args.data_dir,
            apply=args.apply,
            seed_starters=args.seed_starters,
            starter_manifest=args.starter_manifest,
            backup_dir=args.backup_dir,
        )
    except ConversionTargetError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False, indent=2))
        return 2
    output = json.dumps(report, ensure_ascii=False, indent=2)
    print(output)
    if args.report is not None:
        report_path = args.report.expanduser().resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = report_path.with_name(f".{report_path.name}.tmp")
        temporary.write_text(output + "\n", encoding="utf-8")
        temporary.replace(report_path)
    return 1 if report["summary"]["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
