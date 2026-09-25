"""Single-worker process for vehicle certificate image/PDF optimization.

Set GSSG_INLINE_PDF=1 to run in the calling thread for pytest and CI.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from concurrent.futures.process import BrokenProcessPool

from app.core.vehicle_certificates import Profile, optimize_certificate

log = logging.getLogger(__name__)

_executor: ProcessPoolExecutor | None = None
_lock = threading.Lock()


def get_executor() -> ProcessPoolExecutor:
    global _executor
    with _lock:
        if _executor is None:
            _executor = ProcessPoolExecutor(max_workers=1)
        return _executor


def _reap_wedged_pool(executor: ProcessPoolExecutor) -> None:
    """Kill a timed-out or broken worker so the next call gets a fresh pool."""
    global _executor
    with _lock:
        if _executor is executor:
            _executor = None
    for pid, process in list(executor._processes.items()):
        log.warning("Reaping wedged certificate worker pid=%s", pid)
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/T", "/F", "/PID", str(pid)],
                    check=False,
                    capture_output=True,
                )
            else:
                process.kill()
        except Exception:
            log.exception("Failed to kill wedged certificate worker pid=%s", pid)
    executor.shutdown(wait=False, cancel_futures=True)


def _optimize_in_subprocess(data: bytes, media_type: str, profile: Profile) -> bytes:
    return optimize_certificate(data, media_type, profile=profile)


def optimize(data: bytes, media_type: str, profile: Profile, *, timeout: float) -> bytes:
    if os.environ.get("GSSG_INLINE_PDF") == "1":
        return _optimize_in_subprocess(data, media_type, profile)

    executor = get_executor()
    try:
        future = executor.submit(_optimize_in_subprocess, data, media_type, profile)
        return future.result(timeout=timeout)
    except (FutureTimeoutError, BrokenProcessPool):
        _reap_wedged_pool(executor)
        raise


def shutdown() -> None:
    """Drain and release the certificate worker during application shutdown."""
    global _executor
    with _lock:
        executor = _executor
        _executor = None
    if executor is not None:
        executor.shutdown(wait=True, cancel_futures=True)
