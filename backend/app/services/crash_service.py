"""Crash report service — bundles payload + log tail + system info into a zip.

The zip is written to ``data/crash-reports/<UTC-ISO-timestamp>.zip``.  The
folder is created on first use.  The caller gets back the path so it can return
a ``report_id`` (the stem of the filename) to the client.
"""

from __future__ import annotations

import io
import json
import platform
import sys
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from app import __version__
from app.config import Settings
from app.schemas.crash import CrashReportPayload

_LOG_TAIL_LINES = 2000


def _read_log_tail(log_path: Path) -> bytes | None:
    """Return up to the last ``_LOG_TAIL_LINES`` lines of *log_path* as UTF-8 bytes."""
    if not log_path.is_file():
        return None
    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    tail = lines[-_LOG_TAIL_LINES:]
    return "".join(tail).encode("utf-8")


def _system_info_bytes(settings: Settings) -> bytes:
    """Tiny JSON snapshot of version + python + platform."""
    payload = {
        "version": __version__,
        "python": sys.version,
        "platform": platform.platform(),
        "data_dir_exists": settings.data_dir.exists(),
        "frozen": getattr(sys, "frozen", False),
    }
    return json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")


def record_crash(payload: CrashReportPayload, settings: Settings) -> Path:
    """Bundle the payload, log tail, and system info into a zip.

    Returns the path to the written zip file.
    """
    crash_dir = settings.data_dir / "crash-reports"
    crash_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    zip_path = crash_dir / f"{ts}.zip"

    log_path = settings.logs_dir / "gssg.log"
    log_tail = _read_log_tail(log_path)
    system_info = _system_info_bytes(settings)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        payload_bytes = payload.model_dump_json(indent=2).encode("utf-8")
        zf.writestr("payload.json", payload_bytes)
        zf.writestr("system-info.json", system_info)
        if log_tail is not None:
            zf.writestr("gssg.log.tail", log_tail)

    zip_path.write_bytes(buf.getvalue())
    return zip_path
