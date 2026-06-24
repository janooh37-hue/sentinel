"""System endpoints — health, version, diagnostic info, admin-key, crash-report."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import __version__
from app.api.deps import get_current_user, require_capability
from app.api.errors import AppError
from app.config import get_settings
from app.db.models import User
from app.db.session import get_db
from app.schemas.crash import CrashReportPayload
from app.schemas.migration import MigrateRequest, MigrationResult, MigrationStatus
from app.schemas.system import SystemInfo, UpdateCheckResult
from app.services import crash_service, migration_service, settings_service, system_service

router = APIRouter(prefix="/system", tags=["system"])

# Prevent concurrent migration runs (one at a time is enough).
_migration_lock = threading.Lock()

_STARTED_AT = time.monotonic()


class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_seconds: float


class AdminKeyRequest(BaseModel):
    enabled: bool


class AdminKeyResponse(BaseModel):
    admin_gate_enabled: bool


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        uptime_seconds=round(time.monotonic() - _STARTED_AT, 3),
    )


@router.get("/info", response_model=SystemInfo)
def system_info(
    _user: Annotated[User, Depends(get_current_user)],
) -> SystemInfo:
    # Requires a session: the response carries filesystem paths (db/log/data)
    # that must not be exposed to anonymous callers. The pre-login launcher and
    # migration wizard only use /system/health and /system/migration-status,
    # which stay public; this endpoint is consumed by the (authenticated)
    # Settings page.
    settings = get_settings()
    return system_service.get_system_info(settings)


@router.get("/update-check", response_model=UpdateCheckResult)
def update_check() -> UpdateCheckResult:
    settings = get_settings()
    return system_service.check_for_updates(settings)


@router.post("/admin-key", response_model=AdminKeyResponse)
def toggle_admin_key(
    body: AdminKeyRequest,
    _user: Annotated[User, Depends(require_capability("system.admin"))],
) -> AdminKeyResponse:
    new_state = settings_service.set_admin_gate(body.enabled)
    return AdminKeyResponse(admin_gate_enabled=new_state)


class CrashReportResponse(BaseModel):
    report_id: str
    path: str


@router.post("/crash-report", response_model=CrashReportResponse, status_code=201)
def post_crash_report(
    body: CrashReportPayload,
    _user: Annotated[User, Depends(get_current_user)],
) -> CrashReportResponse:
    """Accept a frontend crash report, bundle it with log tail and system info."""
    settings = get_settings()
    zip_path = crash_service.record_crash(body, settings)
    return CrashReportResponse(report_id=zip_path.stem, path=str(zip_path))


# ---------------------------------------------------------------------------
# Migration endpoints
# ---------------------------------------------------------------------------


@router.get("/migration-status", response_model=MigrationStatus)
def get_migration_status(db: Annotated[Session, Depends(get_db)]) -> MigrationStatus:
    """Return current migration status (has_db, has_data, detected v3 dir, last run)."""
    settings = get_settings()
    return migration_service.get_migration_status(db, settings)


@router.post("/migrate-v3", response_model=MigrationResult)
def migrate_v3(
    body: MigrateRequest,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("system.admin"))],
) -> MigrationResult:
    """Run (or dry-run) the v3 → v4 data migration.

    Rejects path traversal in ``v3_data_dir``.  Acquires a lock so only one
    migration can run at a time.
    """
    settings = get_settings()

    # Validate and confine the path: resolve symlinks, reject traversal, and
    # require the real path be an existing directory (no symlink escape).
    raw_path = body.v3_data_dir
    if ".." in raw_path:
        raise AppError("INVALID_PATH", "v3_data_dir must not contain '..'", http_status=400)

    try:
        v3_dir = Path(raw_path).resolve(strict=True)
    except (OSError, RuntimeError) as e:
        raise AppError(
            "V3_DIR_NOT_FOUND",
            f"v3 data directory does not exist: {raw_path}",
            http_status=400,
        ) from e
    # Reject a path whose final component is itself a symlink (resolve() follows
    # parents, so this catches a swapped-in link pointing outside the tree).
    if Path(raw_path).is_symlink() or not v3_dir.is_dir():
        raise AppError(
            "INVALID_PATH",
            "v3_data_dir must be a real directory (symlinks are not allowed).",
            http_status=400,
        )

    acquired = _migration_lock.acquire(blocking=False)
    if not acquired:
        raise AppError(
            "MIGRATION_IN_PROGRESS",
            "A migration is already running. Try again shortly.",
            http_status=409,
        )
    try:
        return migration_service.run_migration(db, settings, v3_dir, dry_run=body.dry_run)
    finally:
        _migration_lock.release()
