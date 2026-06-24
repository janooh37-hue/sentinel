"""v3 → v4 migration service.

Thin layer between the API router and ``app.v3_import.run_import``.  Handles:
- Status detection (has DB, has data, v3 dir probe, last-run timestamp).
- Running the import (real or dry) and recording the result in app_settings.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import Settings
from app.db.models import AppSetting, Employee
from app.schemas.migration import MigrationResult, MigrationStatus
from app.v3_import import run_import

log = logging.getLogger(__name__)

# Key used to record the last migration timestamp in app_settings.
_LAST_RUN_KEY = "migration.last_run"

# Candidate v3 data directories to probe (most specific first).
_V3_CANDIDATE_DIRS: list[str] = [
    r"C:\Users\Amh\Documents\projects\Gssg_manger\data",
]


def _v3_candidate_dirs() -> list[Path]:
    """Build the probe list, expanding env vars at call time."""
    candidates: list[Path] = []
    for raw in _V3_CANDIDATE_DIRS:
        candidates.append(Path(raw))

    # %LOCALAPPDATA%\GSSG_Manager\*\data  (versioned installs)
    local_app = os.environ.get("LOCALAPPDATA")
    if local_app:
        base = Path(local_app) / "GSSG_Manager"
        if base.is_dir():
            for sub in sorted(base.iterdir()):
                candidate = sub / "data"
                if candidate.is_dir():
                    candidates.append(candidate)

    # %APPDATA%\GSSG_Manager\data
    app_data = os.environ.get("APPDATA")
    if app_data:
        candidates.append(Path(app_data) / "GSSG_Manager" / "data")

    return candidates


def get_migration_status(db: Session, settings: Settings) -> MigrationStatus:
    """Return current migration status without side-effects."""
    has_db = settings.db_path.exists()

    has_data = False
    if has_db:
        try:
            row = db.execute(select(Employee).limit(1)).first()
            has_data = row is not None
        except Exception:
            has_data = False

    v3_data_dir_detected: str | None = None
    for candidate in _v3_candidate_dirs():
        if candidate.is_dir():
            v3_data_dir_detected = str(candidate)
            break

    last_migration: datetime | None = None
    try:
        setting_row = db.execute(
            select(AppSetting).where(AppSetting.key == _LAST_RUN_KEY)
        ).scalar_one_or_none()
        if setting_row is not None:
            raw = json.loads(setting_row.value)
            last_migration = datetime.fromisoformat(raw)
    except Exception:
        last_migration = None

    return MigrationStatus(
        has_db=has_db,
        has_data=has_data,
        v3_data_dir_detected=v3_data_dir_detected,
        last_migration=last_migration,
    )


def run_migration(
    db: Session,
    settings: Settings,
    v3_data_dir: Path,
    *,
    dry_run: bool,
) -> MigrationResult:
    """Run the v3 import (or a dry-run preview).

    On success (non-dry), records the timestamp in app_settings so
    ``get_migration_status`` can surface ``last_migration``.

    Raises :class:`app.api.errors.AppError` on failure.
    """
    db_url = f"sqlite:///{settings.db_path.as_posix()}"
    backup_root = settings.data_dir / "backups"

    try:
        summary = run_import(
            src_dir=v3_data_dir,
            db_url=db_url,
            backup_root=backup_root,
            force=False,
            dry=dry_run,
        )
    except RuntimeError as exc:
        # "destination DB already has parity rows; pass force=True to wipe"
        raise AppError(
            "MIGRATION_ALREADY_RAN",
            str(exc),
            http_status=409,
        ) from exc
    except FileNotFoundError as exc:
        raise AppError(
            "V3_DIR_NOT_FOUND",
            str(exc),
            http_status=400,
        ) from exc
    except Exception as exc:
        log.exception("Migration failed: %s", exc)
        raise AppError(
            "MIGRATION_FAILED",
            f"Import failed: {exc}",
            http_status=500,
        ) from exc

    # Record last-run timestamp (only on a real run, not dry).
    if not dry_run:
        _record_last_run(db)

    return MigrationResult(
        dry_run=dry_run,
        employees=summary.employees,
        leaves=summary.leaves,
        books=summary.books,
        vault_files=summary.vault_files,
        violations=summary.violations,
        backup_path=str(summary.backup_dir) if summary.backup_dir else None,
    )


def _record_last_run(db: Session) -> None:
    """Upsert migration.last_run in app_settings."""
    now_iso = datetime.now(UTC).replace(tzinfo=None).isoformat()
    existing = db.execute(
        select(AppSetting).where(AppSetting.key == _LAST_RUN_KEY)
    ).scalar_one_or_none()
    encoded = json.dumps(now_iso)
    if existing is None:
        db.add(AppSetting(key=_LAST_RUN_KEY, value=encoded))
    else:
        existing.value = encoded
    db.commit()
