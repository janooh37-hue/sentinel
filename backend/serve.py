"""Headless always-on entry point — no pywebview, bound to the network.

Runs the existing FastAPI app (``app.main:app``) under uvicorn on the MAIN
thread, bound to ``settings.host`` (``GSSG_HOST``) on a fixed ``settings.port``
(``GSSG_PORT``). Intended to run as a Windows service (NSSM) so the office app
stays up across reboots and can't be closed by mistake.

Run with the project venv:

    .\\venv\\Scripts\\python.exe backend\\serve.py

Differences from ``backend/main.py`` (the desktop launcher):
  * No webview import and no window — this is a server, not a desktop app.
  * No free-port probe — the port is fixed so firewall rules and bookmarks
    stay stable.
  * Binds ``settings.host`` (set ``GSSG_HOST=0.0.0.0`` for the LAN).
  * uvicorn access logging is ON for diagnosability.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

# Make ``import app...`` resolve when running this file directly.
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import uvicorn  # noqa: E402

from app.config import get_settings  # noqa: E402

log = logging.getLogger("gssg.serve")


def build_config() -> uvicorn.Config:
    """Build the uvicorn config for the headless LAN server.

    Raises ``ValueError`` if ``settings.port`` is 0 (the desktop probe
    sentinel) — a network service needs a stable, explicit port.
    """
    settings = get_settings()
    if not settings.port:
        raise ValueError(
            "GSSG_PORT must be a fixed non-zero port for the LAN service "
            "(0 is the desktop free-port probe sentinel). Set GSSG_PORT=8765."
        )
    return uvicorn.Config(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        access_log=True,
        lifespan="on",
    )


def main() -> int:
    settings = get_settings()
    log.info("Starting GSSG Manager (headless) on %s:%d", settings.host, settings.port)
    server = uvicorn.Server(build_config())
    server.run()  # blocks on the main thread until the service is stopped
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
