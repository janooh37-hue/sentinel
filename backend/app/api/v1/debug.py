"""Admin debug console: health checks, log tails, grouped silent issues, AI diagnosis.

Everything here is read-only except ``POST /debug/client-error`` (any signed-in
browser reports its own JS errors into the app log) and ``POST /debug/diagnose``
(runs the server's already-logged-in ``claude``/``codex`` CLI in read-only mode).
"""

from __future__ import annotations

import collections
import functools
import hashlib
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.responses import Response

from app import __version__
from app.api.deps import get_current_user, require_capability
from app.api.errors import AppError
from app.config import PROJECT_ROOT, get_settings
from app.db.models import User
from app.db.session import get_db
from app.services import scheduler_service

log = logging.getLogger(__name__)
client_log = logging.getLogger("client")

router = APIRouter(prefix="/debug", tags=["debug"])
Admin = Annotated[User, Depends(require_capability("system.admin"))]

_STARTED_AT = time.time()
_TAIL_BYTES = 4 * 1024 * 1024
_AI_TIMEOUT_S = 600

# ── Recent API requests (ring buffer fed by middleware) ──────────────────────
# ponytail: in-memory, per-process, lost on restart; persist if history matters.
_requests: collections.deque[dict[str, Any]] = collections.deque(maxlen=500)


async def record_request(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Middleware: remember method/path/status/duration of /api calls.

    DAV paths carry bearer tokens, so only ``/api/`` paths are kept, query
    strings dropped.
    """
    path = request.url.path
    if not path.startswith("/api/") or path.startswith("/api/v1/debug/"):
        return await call_next(request)
    start = time.perf_counter()
    status = 500
    try:
        response: Response = await call_next(request)
        status = response.status_code
        return response
    finally:
        _requests.append(
            {
                "ts": datetime.now(UTC).isoformat(timespec="seconds"),
                "method": request.method,
                "path": path,
                "status": status,
                "ms": round((time.perf_counter() - start) * 1000, 1),
            }
        )


# ── Log reading ──────────────────────────────────────────────────────────────
LogSource = Literal["app", "stdout", "stderr"]
_LEVEL_RE = re.compile(r"\b(DEBUG|INFO|WARNING|ERROR|CRITICAL)\b")


def _log_path(source: LogSource) -> Path:
    logs = get_settings().logs_dir
    return (
        logs
        / {"app": "gssg.log", "stdout": "service-stdout.log", "stderr": "service-stderr.log"}[
            source
        ]
    )


def _tail_lines(path: Path, max_bytes: int = _TAIL_BYTES) -> list[str]:
    if not path.is_file():
        return []
    with path.open("rb") as fh:
        size = fh.seek(0, os.SEEK_END)
        fh.seek(max(0, size - max_bytes))
        data = fh.read()
    lines = data.decode("utf-8", errors="replace").splitlines()
    return lines[1:] if size > max_bytes else lines  # first line is likely partial


def _parse(line: str) -> dict[str, Any]:
    if line.startswith("{"):
        try:
            rec = json.loads(line)
            if isinstance(rec, dict):
                return rec
        except ValueError:
            pass
    m = _LEVEL_RE.search(line[:80])
    level = (
        m.group(1) if m else ("ERROR" if "Traceback" in line or "Error" in line[:40] else "INFO")
    )
    return {"ts": None, "level": level, "logger": "raw", "msg": line}


def _entries(source: LogSource) -> list[dict[str, Any]]:
    """Parsed entries; bare traceback lines are folded into the previous entry."""
    out: list[dict[str, Any]] = []
    for line in _tail_lines(_log_path(source)):
        if not line.strip():
            continue
        rec = _parse(line)
        if (
            rec.get("logger") == "raw"
            and out
            and out[-1].get("logger") == "raw"
            and (line.startswith((" ", "\t", "Traceback")) or not _LEVEL_RE.search(line[:80]))
        ):
            out[-1]["msg"] += "\n" + line
            continue
        out.append(rec)
    return out


_LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}


@router.get("/logs")
def logs(
    _user: Admin,
    source: LogSource = "app",
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "DEBUG",
    q: str = "",
    limit: Annotated[int, Query(ge=1, le=5000)] = 500,
) -> dict[str, Any]:
    floor = _LEVELS[level]
    needle = q.lower()
    rows = [
        r
        for r in _entries(source)
        if _LEVELS.get(str(r.get("level")), 20) >= floor
        and (not needle or needle in json.dumps(r, default=str, ensure_ascii=False).lower())
    ]
    path = _log_path(source)
    return {
        "source": source,
        "path": str(path),
        "size_bytes": path.stat().st_size if path.is_file() else 0,
        "entries": rows[-limit:],
    }


# ── Issue grouping ("silent" warnings/errors) ────────────────────────────────
_NOISE = [
    (re.compile(r"[0-9a-f]{8}-[0-9a-f-]{27,}", re.I), "<uuid>"),
    (re.compile(r"\b[0-9a-f]{16,}\b", re.I), "<hex>"),
    (re.compile(r"'[^']*'|\"[^\"]*\""), "<str>"),
    (re.compile(r"\d+(\.\d+)?"), "N"),
]


def _fingerprint(rec: dict[str, Any]) -> tuple[str, str]:
    msg = str(rec.get("msg", "")).splitlines()[0][:300] if rec.get("msg") else ""
    exc_tail = str(rec.get("exc", "")).strip().splitlines()[-1:] or [""]
    shape = msg + "|" + exc_tail[0]
    for pat, repl in _NOISE:
        shape = pat.sub(repl, shape)
    key = f"{rec.get('logger')}|{shape}"
    return hashlib.sha1(key.encode()).hexdigest()[:12], shape


def _issues() -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    sources: tuple[LogSource, ...] = ("app", "stderr")
    for source in sources:
        entries = _entries(source)
        for rec in entries:
            if _LEVELS.get(str(rec.get("level")), 20) < 30:
                continue
            if source == "stderr" and rec.get("logger") != "raw":
                continue  # JSON stderr lines duplicate the app log
            fp, shape = _fingerprint(rec)
            g = groups.get(fp)
            if g is None:
                g = groups[fp] = {
                    "id": fp,
                    "source": source,
                    "level": rec.get("level"),
                    "logger": rec.get("logger"),
                    "title": str(rec.get("msg", "")).splitlines()[0][:200]
                    if rec.get("msg")
                    else shape,
                    "count": 0,
                    "first_seen": rec.get("ts"),
                    "last_seen": rec.get("ts"),
                    "sample": rec,
                }
            g["count"] += 1
            g["last_seen"] = rec.get("ts") or g["last_seen"]
            g["sample"] = rec
            if rec.get("level") in ("ERROR", "CRITICAL"):
                g["level"] = rec["level"]
    return sorted(
        groups.values(),
        key=lambda g: (g["level"] not in ("ERROR", "CRITICAL"), -g["count"]),
    )


@router.get("/issues")
def issues(_user: Admin) -> list[dict[str, Any]]:
    return _issues()


# ── Health / nerd stats ──────────────────────────────────────────────────────
def _check(cid: str, label: str, status: str, detail: str, hint: str = "") -> dict[str, str]:
    return {"id": cid, "label": label, "status": status, "detail": detail, "hint": hint}


def _process_rss() -> int | None:
    if sys.platform != "win32":
        try:
            import resource

            return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) * 1024
        except Exception:
            return None
    import ctypes
    from ctypes import wintypes

    class _PMC(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    pmc = _PMC()
    pmc.cb = ctypes.sizeof(pmc)
    kernel32 = ctypes.windll.kernel32
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.K32GetProcessMemoryInfo.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(_PMC),
        wintypes.DWORD,
    ]
    ok = kernel32.K32GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
    return int(pmc.WorkingSetSize) if ok else None


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", *args], cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=5, check=False
        )
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


@functools.cache
def _alembic_head() -> str | None:
    from alembic.script import ScriptDirectory

    migrations = Path(__file__).resolve().parents[2] / "db" / "migrations"
    return ScriptDirectory(str(migrations)).get_current_head()


def _alembic(db: Session) -> tuple[str | None, str | None]:
    # Plain SQL, not MigrationContext: that logs INFO lines on every health poll.
    current = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    return current, _alembic_head()


def _scheduler() -> dict[str, Any]:
    sched = scheduler_service._scheduler
    jobs = []
    if sched is not None and sched.running:
        for job in sched.get_jobs():
            nrt = job.next_run_time
            jobs.append(
                {"id": job.id, "name": job.name, "next_run": nrt.isoformat() if nrt else None}
            )
    return {
        "running": bool(sched is not None and sched.running),
        "disabled_by_env": os.environ.get("GSSG_DISABLE_SCHEDULER") == "1",
        "jobs": sorted(jobs, key=lambda j: j["next_run"] or "~"),
    }


def _word() -> tuple[str, str]:
    if sys.platform != "win32":
        return "warn", "Not Windows — Word COM unavailable"
    try:
        import winreg

        import win32com.client  # noqa: F401

        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"Word.Application\CurVer") as key:
            return "ok", str(winreg.QueryValue(key, None))
    except ImportError:
        return "fail", "pywin32 not installed"
    except OSError:
        return "fail", "Word.Application is not registered on this machine"


# ── Machine metrics (stdlib only; Windows via ctypes) ──────────────────────
_SERVICES = ("GSSGManager", "Caddy", "Cloudflared")


def _cpu_percent(interval: float = 0.25) -> float | None:
    if sys.platform != "win32":
        try:
            return round(os.getloadavg()[0] / (os.cpu_count() or 1) * 100, 1)
        except OSError:
            return None
    import ctypes
    from ctypes import wintypes

    def times() -> tuple[int, int, int]:
        idle, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
        ctypes.windll.kernel32.GetSystemTimes(
            ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)
        )

        def as_int(ft: wintypes.FILETIME) -> int:
            return (int(ft.dwHighDateTime) << 32) | int(ft.dwLowDateTime)

        return as_int(idle), as_int(kernel), as_int(user)

    i1, k1, u1 = times()
    time.sleep(interval)
    i2, k2, u2 = times()
    total = (k2 - k1) + (u2 - u1)  # kernel time includes idle
    return round((1 - (i2 - i1) / total) * 100, 1) if total else None


def _memory() -> tuple[int, int] | None:
    """(total, available) bytes of physical RAM."""
    if sys.platform != "win32":
        try:
            info = dict(
                line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines()
            )

            def kb(k: str) -> int:
                return int(info[k].split()[0]) * 1024

            return kb("MemTotal"), kb("MemAvailable")
        except (OSError, KeyError, ValueError):
            return None
    import ctypes
    from ctypes import wintypes

    class _MS(ctypes.Structure):
        _fields_ = [
            ("dwLength", wintypes.DWORD),
            ("dwMemoryLoad", wintypes.DWORD),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    ms = _MS()
    ms.dwLength = ctypes.sizeof(ms)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms)):
        return None
    return int(ms.ullTotalPhys), int(ms.ullAvailPhys)


def _boot_uptime() -> int | None:
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.kernel32.GetTickCount64.restype = ctypes.c_ulonglong
        return int(ctypes.windll.kernel32.GetTickCount64() // 1000)
    try:
        return int(float(Path("/proc/uptime").read_text().split()[0]))
    except (OSError, ValueError):
        return None


def _run(*args: str) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=5, check=False).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _network() -> tuple[int, int] | None:
    """Cumulative (received, sent) bytes on all interfaces since boot."""
    if sys.platform != "win32":
        return None
    for line in _run("netstat", "-e").splitlines():
        parts = line.split()
        if parts[:1] == ["Bytes"] and len(parts) == 3:
            return int(parts[1]), int(parts[2])
    return None


def _service_state(name: str) -> str:
    """RUNNING / STOPPED / ... or 'not installed'."""
    if sys.platform != "win32":
        return "n/a"
    m = re.search(r"STATE\s+:\s+\d+\s+(\w+)", _run("sc.exe", "query", name))
    return m.group(1) if m else "not installed"


def _machine() -> dict[str, Any]:
    mem = _memory()
    net = _network()
    return {
        "cpu_percent": _cpu_percent(),
        "cpu_count": os.cpu_count(),
        "ram_total_bytes": mem[0] if mem else None,
        "ram_available_bytes": mem[1] if mem else None,
        "boot_uptime_seconds": _boot_uptime(),
        "net_received_bytes": net[0] if net else None,
        "net_sent_bytes": net[1] if net else None,
        "services": {name: _service_state(name) for name in _SERVICES},
    }


def _file_info(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"path": str(path), "exists": False, "size_bytes": 0, "modified": None}
    st = path.stat()
    return {
        "path": str(path),
        "exists": True,
        "size_bytes": st.st_size,
        "modified": datetime.fromtimestamp(st.st_mtime, UTC).isoformat(timespec="seconds"),
    }


@router.get("/overview")
def overview(_user: Admin, db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    settings = get_settings()
    checks: list[dict[str, str]] = []

    # Database
    try:
        t0 = time.perf_counter()
        db.execute(text("SELECT 1"))
        ping_ms = round((time.perf_counter() - t0) * 1000, 2)
        journal = db.execute(text("PRAGMA journal_mode")).scalar()
        checks.append(
            _check("db", "Database", "ok", f"SQLite answers in {ping_ms} ms (journal={journal})")
        )
    except Exception as exc:
        checks.append(
            _check("db", "Database", "fail", repr(exc), "The app cannot read its database.")
        )

    # Migrations
    current = head = None
    try:
        current, head = _alembic(db)
        if current == head:
            checks.append(_check("migrations", "Database schema", "ok", f"At head {head}"))
        else:
            checks.append(
                _check(
                    "migrations",
                    "Database schema",
                    "fail",
                    f"Database at {current}, code expects {head}",
                    "Run 'alembic upgrade head' (or scripts\\mng.ps1 update). Features touching new columns will break.",
                )
            )
    except Exception as exc:
        checks.append(_check("migrations", "Database schema", "warn", repr(exc)))

    # Scheduler
    sched = _scheduler()
    if sched["running"]:
        checks.append(
            _check("scheduler", "Background jobs", "ok", f"{len(sched['jobs'])} jobs scheduled")
        )
    elif sched["disabled_by_env"]:
        checks.append(
            _check(
                "scheduler",
                "Background jobs",
                "warn",
                "Disabled by GSSG_DISABLE_SCHEDULER=1",
                "Expected on the dev laptop. On production, reminders/emails/sync will not run.",
            )
        )
    else:
        checks.append(
            _check(
                "scheduler",
                "Background jobs",
                "fail",
                "Scheduler is not running",
                "Emails, reminders and syncs silently stop. Restart the service.",
            )
        )

    # Word
    wstatus, wdetail = _word()
    checks.append(
        _check(
            "word",
            "Microsoft Word (PDF export)",
            wstatus,
            wdetail,
            "" if wstatus == "ok" else "Document/PDF generation will fail.",
        )
    )

    # Disk
    usage = shutil.disk_usage(settings.data_dir)
    free_pct = usage.free / usage.total * 100
    checks.append(
        _check(
            "disk",
            "Disk space",
            "ok" if free_pct > 10 else ("warn" if free_pct > 3 else "fail"),
            f"{usage.free / 1024**3:.1f} GB free of {usage.total / 1024**3:.1f} GB ({free_pct:.0f}%)",
            "" if free_pct > 10 else "Low disk: backups, uploads and logs may start failing.",
        )
    )

    # Machine
    machine = _machine()
    cpu = machine["cpu_percent"]
    if cpu is not None:
        checks.append(
            _check(
                "cpu",
                "CPU",
                "ok" if cpu < 85 else "warn",
                f"{cpu:.0f}% busy across {machine['cpu_count']} cores",
                "" if cpu < 85 else "The server is very busy; pages and PDFs will feel slow.",
            )
        )
    if machine["ram_total_bytes"]:
        used_pct = (1 - machine["ram_available_bytes"] / machine["ram_total_bytes"]) * 100
        checks.append(
            _check(
                "ram",
                "Memory (RAM)",
                "ok" if used_pct < 85 else ("warn" if used_pct < 95 else "fail"),
                f"{used_pct:.0f}% used, {machine['ram_available_bytes'] / 1024**3:.1f} GB free of "
                f"{machine['ram_total_bytes'] / 1024**3:.1f} GB",
                ""
                if used_pct < 85
                else "Memory is nearly full; Word and the app may crash or stall.",
            )
        )
    for name, state in machine["services"].items():
        if state == "n/a":
            continue
        ok = state == "RUNNING"
        checks.append(
            _check(
                f"svc_{name.lower()}",
                f"Service: {name}",
                "ok" if ok else ("warn" if state == "not installed" else "fail"),
                state,
                ""
                if ok
                else (
                    "Not installed on this machine (normal on the dev laptop)."
                    if state == "not installed"
                    else f"The {name} Windows service is not running."
                ),
            )
        )

    # Recent errors
    grouped = _issues()
    errs = [g for g in grouped if g["level"] in ("ERROR", "CRITICAL")]
    checks.append(
        _check(
            "errors",
            "Logged errors",
            "ok" if not errs else "warn",
            f"{len(errs)} distinct errors, {len(grouped) - len(errs)} distinct warnings in recent logs",
            "" if not errs else "Open the Issues tab — these fail silently for users.",
        )
    )

    # Failing requests
    failing = [r for r in _requests if r["status"] >= 500]
    slow = [r for r in _requests if r["ms"] > 3000]
    checks.append(
        _check(
            "requests",
            "API requests",
            "ok" if not failing else "warn",
            f"{len(_requests)} recent, {len(failing)} server errors, {len(slow)} slower than 3 s",
            "" if not failing else "Open the Requests tab to see which endpoints fail.",
        )
    )

    db_file = settings.db_path
    crash_dir = settings.data_dir / "crash-reports"
    crashes = sorted(crash_dir.glob("*.zip")) if crash_dir.is_dir() else []

    return {
        "checks": checks,
        "stats": {
            "version": __version__,
            "git_commit": _git("rev-parse", "--short", "HEAD"),
            "git_branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
            "git_dirty": bool(_git("status", "--porcelain", "--untracked-files=no")),
            "started_at": datetime.fromtimestamp(_STARTED_AT, UTC).isoformat(timespec="seconds"),
            "uptime_seconds": round(time.time() - _STARTED_AT),
            "pid": os.getpid(),
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "hostname": platform.node(),
            "user": os.environ.get("USERNAME") or os.environ.get("USER"),
            "memory_bytes": _process_rss(),
            "threads": threading.active_count(),
            "dev_mode": settings.dev_mode,
            "log_level": settings.log_level,
            "data_dir": str(settings.data_dir),
            "alembic_current": current,
            "alembic_head": head,
            "disk_free_bytes": usage.free,
            "disk_total_bytes": usage.total,
        },
        "files": {
            "database": _file_info(db_file),
            "database_wal": _file_info(db_file.with_name(db_file.name + "-wal")),
            "app_log": _file_info(_log_path("app")),
            "stdout_log": _file_info(_log_path("stdout")),
            "stderr_log": _file_info(_log_path("stderr")),
        },
        "crash_reports": {"count": len(crashes), "latest": crashes[-1].stem if crashes else None},
        "scheduler": sched,
        "machine": machine,
    }


@router.get("/requests")
def recent_requests(_user: Admin) -> list[dict[str, Any]]:
    return list(reversed(_requests))


# ── Browser errors ───────────────────────────────────────────────────────────
class ClientError(BaseModel):
    message: str = Field(max_length=2000)
    stack: str = Field("", max_length=16000)
    url: str = Field("", max_length=1000)
    kind: str = Field("error", max_length=40)


@router.post("/client-error", status_code=204)
def client_error(
    payload: ClientError, user: Annotated[User, Depends(get_current_user)]
) -> Response:
    # ponytail: no rate limit; the frontend dedupes per page load. Add one if a user floods logs.
    client_log.warning(
        "browser %s: %s",
        payload.kind,
        payload.message,
        extra={"page": payload.url, "stack": payload.stack, "user_id": user.id},
    )
    return Response(status_code=204)


# ── AI diagnosis ─────────────────────────────────────────────────────────────
def _find_cli(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    home = Path.home()
    appdata = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
    for cand in (
        home / ".local" / "bin" / f"{name}.exe",
        home / ".local" / "bin" / name,
        appdata / "npm" / f"{name}.cmd",
        home / ".claude" / "local" / f"{name}.exe",
    ):
        if cand.is_file():
            return str(cand)
    return None


def _engines() -> dict[str, str]:
    return {name: path for name in ("claude", "codex") if (path := _find_cli(name))}


class DiagnoseRequest(BaseModel):
    issue_id: str | None = Field(None, max_length=40)
    note: str = Field("", max_length=4000)
    engine: Literal["claude", "codex"] | None = None


def _build_prompt(issue_id: str | None, note: str) -> str:
    settings = get_settings()
    parts = [
        "You are debugging GSSG Manager (FastAPI/Python 3.12 backend in backend/, "
        "React/Vite/TypeScript frontend in frontend/, SQLite, Microsoft Word COM for PDFs). "
        "The person reading your answer is the app owner: he works with AI coding agents "
        "but is NOT a programmer. Answer in this exact structure:\n"
        "1. **What is happening** — plain language, 2-3 sentences, no jargon.\n"
        "2. **Does it hurt users?** — who is affected and how badly (none / annoying / data at risk).\n"
        "3. **Root cause** — the technical reason, with exact file paths and line numbers.\n"
        "4. **Fix** — the concrete change.\n"
        "5. **Prompt to paste into a coding agent** — a self-contained instruction block he can "
        "copy into Claude Code / Codex to apply the fix, including how to verify it.\n",
        f"App version {__version__}, commit {_git('rev-parse', '--short', 'HEAD')}, "
        f"Python {sys.version.split()[0]}, {platform.platform()}, dev_mode={settings.dev_mode}.",
    ]
    if issue_id:
        match = next((g for g in _issues() if g["id"] == issue_id), None)
        if match is None:
            raise AppError("NOT_FOUND", "Issue not found in recent logs", http_status=404)
        sample = match["sample"]
        parts.append(
            f"\n## Issue\nLevel: {match['level']}  Logger: {match['logger']}\n"
            f"Seen {match['count']} times, first {match['first_seen']}, last {match['last_seen']}.\n"
            f"Message: {sample.get('msg')}\n"
        )
        if sample.get("exc"):
            parts.append(f"Traceback:\n```\n{sample['exc']}\n```")
        extras = {
            k: v for k, v in sample.items() if k not in ("msg", "exc", "ts", "level", "logger")
        }
        if extras:
            parts.append(
                f"Extra fields: {json.dumps(extras, default=str, ensure_ascii=False)[:4000]}"
            )
        nearby = [
            f"{r.get('ts')} {r.get('level')} {r.get('logger')}: {str(r.get('msg'))[:300]}"
            for r in _entries(match["source"])[-4000:]
            if r.get("logger") == match["logger"]
        ][-30:]
        parts.append(
            "\n## Recent log lines from the same logger\n```\n" + "\n".join(nearby) + "\n```"
        )
    else:
        top = _issues()[:15]
        parts.append(
            "\n## Task\nReview the app's current health and rank the issues below by user impact.\n"
            "## Distinct warnings/errors in recent logs\n"
            + "\n".join(f"- [{g['level']} x{g['count']}] {g['logger']}: {g['title']}" for g in top)
        )
        failing = [r for r in _requests if r["status"] >= 500][-20:]
        if failing:
            parts.append(
                "\n## Recent failing API requests\n"
                + "\n".join(
                    f"- {r['ts']} {r['method']} {r['path']} -> {r['status']} ({r['ms']} ms)"
                    for r in failing
                )
            )
    if note.strip():
        parts.append(f"\n## Owner's note\n{note.strip()}")
    parts.append(
        "\nYou may read the source code in the current directory. Do NOT modify any files."
    )
    return "\n".join(parts)


@router.get("/ai")
def ai_engines(_user: Admin) -> dict[str, Any]:
    engines = _engines()
    return {
        "engines": list(engines),
        "runs_as": os.environ.get("USERNAME") or os.environ.get("USER"),
    }


@router.post("/prompt")
def prompt(body: DiagnoseRequest, _user: Admin) -> dict[str, str]:
    return {"prompt": _build_prompt(body.issue_id, body.note)}


# ponytail: in-memory job table, lost on restart; fine for an interactive admin tool.
_jobs: dict[str, dict[str, Any]] = {}


def _run_ai(job: dict[str, Any], args: list[str], prompt_text: str) -> None:
    engine = job["engine"]
    started = time.perf_counter()
    try:
        proc = subprocess.run(
            args,
            input=prompt_text,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_AI_TIMEOUT_S,
            check=False,
        )
        output = proc.stdout.strip()
        if proc.returncode != 0 or not output:
            log.warning(
                "debug: %s exited %s: %s", engine, proc.returncode, (proc.stderr or output)[-2000:]
            )
            job["error"] = (
                f"{engine} exited with code {proc.returncode}: {(proc.stderr or output)[-500:]}"
            )
        else:
            job["output"] = output
    except subprocess.TimeoutExpired:
        job["error"] = f"{engine} took longer than {_AI_TIMEOUT_S}s"
    except OSError as exc:
        job["error"] = f"{engine} could not start: {exc}"
    job["seconds"] = round(time.perf_counter() - started, 1)
    job["status"] = "failed" if "error" in job else "done"


@router.post("/diagnose")
def diagnose(body: DiagnoseRequest, _user: Admin) -> dict[str, Any]:
    """Start an AI run in the background; poll ``GET /debug/diagnose/{id}``.

    Runs take minutes, longer than the Cloudflare proxy's 100 s request limit.
    """
    engines = _engines()
    engine: str | None = body.engine or next(iter(engines), None)
    if engine is None or engine not in engines:
        raise AppError(
            "AI_UNAVAILABLE",
            "No logged-in claude or codex CLI found for the server user. Use 'Copy for AI' instead.",
            http_status=409,
        )
    exe = engines[engine]
    args = (
        [exe, "-p", "--output-format", "text"]
        if engine == "claude"
        else [exe, "exec", "--sandbox", "read-only", "--skip-git-repo-check", "-"]
    )
    prompt_text = _build_prompt(body.issue_id, body.note)
    job_id = uuid.uuid4().hex[:12]
    job: dict[str, Any] = {
        "id": job_id,
        "engine": engine,
        "issue_id": body.issue_id,
        "status": "running",
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    for old in [k for k, j in _jobs.items() if j["status"] != "running"][:-20]:
        del _jobs[old]
    _jobs[job_id] = job
    threading.Thread(target=_run_ai, args=(job, args, prompt_text), daemon=True).start()
    return job


@router.get("/diagnose/{job_id}")
def diagnose_status(job_id: str, _user: Admin) -> dict[str, Any]:
    job = _jobs.get(job_id)
    if job is None:
        raise AppError("NOT_FOUND", "AI run not found (server restarted?)", http_status=404)
    return job
