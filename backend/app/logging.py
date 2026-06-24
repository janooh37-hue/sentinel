"""Structured logging.

Dev mode → pretty console output, single line.
Prod mode → JSON to ``data/logs/gssg.log`` with rotation; pretty console echo too.
"""

from __future__ import annotations

import contextlib
import json
import logging
import logging.handlers
import sys
from typing import Any

from app.config import Settings


class _JsonFormatter(logging.Formatter):
    """Minimal JSON formatter — no external dep on python-json-logger."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if key in _STDLIB_RECORD_KEYS:
                continue
            payload[key] = value
        return json.dumps(payload, default=str, ensure_ascii=False)


_STDLIB_RECORD_KEYS = frozenset(
    {
        "args", "asctime", "created", "exc_info", "exc_text", "filename",
        "funcName", "levelname", "levelno", "lineno", "message", "module",
        "msecs", "msg", "name", "pathname", "process", "processName",
        "relativeCreated", "stack_info", "thread", "threadName", "taskName",
    }
)


def configure_logging(settings: Settings) -> None:
    """Install handlers on the root logger. Idempotent."""
    root = logging.getLogger()
    root.setLevel(settings.log_level)

    # Wipe any prior handlers (uvicorn installs its own; we replace them).
    # ``close()`` first so RotatingFileHandlers release their file descriptors —
    # otherwise the test suite leaks handles between create_app() calls and
    # pytest's ResourceWarning hook fails the run.
    for h in list(root.handlers):
        root.removeHandler(h)
        with contextlib.suppress(Exception):
            h.close()

    console = logging.StreamHandler(stream=sys.stderr)
    if settings.dev_mode:
        console.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-7s %(name)s | %(message)s",
                              datefmt="%H:%M:%S")
        )
    else:
        console.setFormatter(_JsonFormatter())
    root.addHandler(console)

    log_file = settings.logs_dir / "gssg.log"
    file_handler = logging.handlers.RotatingFileHandler(
        log_file, maxBytes=100 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(_JsonFormatter())
    root.addHandler(file_handler)

    # Quiet noisy libs. (uvicorn.access is intentionally NOT silenced — the
    # headless LAN server (serve.py) enables access_log for diagnosability and
    # relies on these lines reaching the rotating file handler.)
    for noisy in ("watchfiles",):
        logging.getLogger(noisy).setLevel(logging.WARNING)
