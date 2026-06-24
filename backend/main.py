"""Entry point: probe a free port, start uvicorn in a thread, open pywebview.

Run with the project venv:

    .\\venv\\Scripts\\python.exe backend\\main.py
"""

from __future__ import annotations

import logging
import socket
import sys
import threading
import time
from pathlib import Path


def _bundle_root() -> Path:
    """Return the root of the bundled assets tree.

    * PyInstaller frozen build → ``sys._MEIPASS`` (the extraction dir).
    * Source layout → two levels up from this file (i.e. the project root).
    """
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent.parent


# Make `import app...` resolve when running this file directly.
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import uvicorn  # noqa: E402
import webview  # noqa: E402

from app.config import get_settings  # noqa: E402

log = logging.getLogger("gssg.bootstrap")


def _probe_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _wait_for_server(port: int, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def main() -> int:
    settings = get_settings()
    port = settings.port or _probe_free_port()

    log.info("Starting uvicorn on 127.0.0.1:%d", port)

    config = uvicorn.Config(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        log_level=settings.log_level.lower(),
        access_log=False,
        lifespan="on",
    )
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, name="uvicorn", daemon=True)
    thread.start()

    if not _wait_for_server(port):
        log.error("Backend failed to come up on port %d", port)
        server.should_exit = True
        return 1

    url = f"http://127.0.0.1:{port}/"
    log.info("Opening pywebview at %s", url)
    webview.create_window(
        title="GSSG Manager",
        url=url,
        width=1440,
        height=900,
        min_size=(1100, 720),
        background_color="#0a0a0c",
        confirm_close=False,
    )
    try:
        webview.start(debug=settings.dev_mode)
    finally:
        log.info("Window closed — shutting down uvicorn")
        server.should_exit = True
        thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
