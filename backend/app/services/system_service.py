"""System info service — version, paths, uptime, stub update check."""

from __future__ import annotations

import platform
import sys
import time
from datetime import UTC, datetime

from app import __version__
from app.config import Settings
from app.schemas.system import SystemInfo, UpdateCheckResult

# Process start time — set once at module import.
_STARTED: float = time.time()


def get_system_info(settings: Settings) -> SystemInfo:
    """Assemble system info from runtime environment and config."""
    log_path = str(settings.logs_dir / "gssg.log")
    return SystemInfo(
        version=__version__,
        db_path=str(settings.db_path),
        log_path=log_path,
        data_dir=str(settings.data_dir),
        python_version=sys.version,
        platform=platform.platform(),
        uptime_seconds=int(time.time() - _STARTED),
    )


def check_for_updates(
    settings: Settings,
    *,
    network_share_url: str | None = None,
) -> UpdateCheckResult:
    """Stub update check — real implementation deferred to Phase 09."""
    if network_share_url is None:
        return UpdateCheckResult(
            current=__version__,
            latest=None,
            update_available=False,
            checked_at=datetime.now(UTC).replace(tzinfo=None),
            error=None,
        )
    # Phase 09 will fill this in.
    return UpdateCheckResult(
        current=__version__,
        latest=None,
        update_available=False,
        checked_at=datetime.now(UTC).replace(tzinfo=None),
        error="Update check not yet implemented",
    )
