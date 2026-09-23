"""Single-worker process that owns Word for every PDF operation.

COM objects (Word.Application) must live on the main thread of their STA
apartment, so every conversion runs in one long-lived worker process. One
worker serializes Word work (two Word instances never race over a document)
and lets ``word_pdf`` keep Word warm between calls.

A call that exceeds its timeout kills the worker; ``word_pdf`` binds each
Word to the worker's kill-on-close job, so its Word dies too, and the next
call builds a fresh pool. After ``IDLE_QUIT_SECONDS`` without work the
worker quits its Word.

Set GSSG_INLINE_PDF=1 to skip the process pool and run in the calling
thread — for pytest (forking inside pytest on Windows is fragile) and CI
without Word.
"""

from __future__ import annotations

import contextlib
import logging
import os
import subprocess
import sys
import threading
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path
from typing import TYPE_CHECKING

from app.core import word_pdf

if TYPE_CHECKING:
    from app.core.signature_layout import SignatureLayout

log = logging.getLogger(__name__)

IDLE_QUIT_SECONDS = 120.0

_executor: ProcessPoolExecutor | None = None
_idle_timer: threading.Timer | None = None
_lock = threading.Lock()


def get_executor() -> ProcessPoolExecutor:
    global _executor
    with _lock:
        if _executor is None:
            _executor = ProcessPoolExecutor(max_workers=1)
        return _executor


def _reap_wedged_pool(executor: ProcessPoolExecutor) -> None:
    """Kill the timed-out or broken worker (its Word dies with its job) and
    drop the singleton so the next call builds a fresh pool. Without this
    the single worker slot stays wedged and every later conversion times out."""
    global _executor
    with _lock:
        if _executor is executor:
            _executor = None
    for pid, proc in list(executor._processes.items()):
        log.warning("Reaping wedged PDF worker pid=%s", pid)
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/T", "/F", "/PID", str(pid)], check=False, capture_output=True
                )
            else:
                proc.kill()
        except Exception:
            log.exception("Failed to kill wedged PDF worker pid=%s", pid)
    executor.shutdown(wait=False, cancel_futures=True)


def run_in_worker[T](fn: Callable[..., T], *args: object, timeout: float, **kwargs: object) -> T:
    """Run ``fn`` in the Word worker (or inline under GSSG_INLINE_PDF=1)."""
    if os.environ.get("GSSG_INLINE_PDF") == "1":
        try:
            return fn(*args, **kwargs)
        finally:
            word_pdf.quit_word()
    executor = get_executor()
    fut = executor.submit(fn, *args, **kwargs)
    try:
        result = fut.result(timeout=timeout)
    except (FutureTimeoutError, BrokenProcessPool):
        _reap_wedged_pool(executor)
        raise
    _restart_idle_timer(executor)
    return result


def _restart_idle_timer(executor: ProcessPoolExecutor) -> None:
    global _idle_timer
    with _lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
        _idle_timer = threading.Timer(IDLE_QUIT_SECONDS, _quit_idle_word, (executor,))
        _idle_timer.daemon = True
        _idle_timer.start()


def _quit_idle_word(executor: ProcessPoolExecutor) -> None:
    if _executor is not executor:
        return  # reaped since; its worker and Word are gone
    with contextlib.suppress(RuntimeError):  # pool shut down
        executor.submit(word_pdf.quit_word)


def _convert_in_subprocess(docx_path_str: str) -> str | None:
    path = word_pdf.convert(Path(docx_path_str))
    return str(path) if path else None


def convert_docx_to_pdf(docx_path: Path) -> Path | None:
    """Convert *docx_path* to a sibling PDF. ``None`` if Word fails; raises
    ``TimeoutError`` if Word hangs (the worker is killed and replaced)."""
    raw = run_in_worker(_convert_in_subprocess, str(docx_path), timeout=120)
    return Path(raw) if raw else None


def _measure_in_subprocess(docx_path_str: str) -> SignatureLayout:
    """Converts via ``word_pdf`` directly — never resubmits to this same
    executor from inside the worker (approval-signature-placement plan §6.1)."""
    from app.core import signature_layout

    return signature_layout.measure_signature_layout(
        Path(docx_path_str), converter=word_pdf.convert
    )


def measure_signature_position(docx_path: Path) -> SignatureLayout:
    """Measure every marked signature's physical page/position in
    *docx_path* — see ``signature_layout.measure_signature_layout``."""
    return run_in_worker(_measure_in_subprocess, str(docx_path), timeout=180)


def _move_in_subprocess(
    source_str: str,
    destination_str: str,
    *,
    signature_id: str,
    page: int,
    x: float,
    y: float,
    layout: SignatureLayout,
    before_pdf_str: str,
) -> tuple[SignatureLayout, str]:
    """Performs the move, converts the result, remeasures it, and validates
    the remeasured result against the request — entirely inside the one
    worker, so the whole operation is one serialized unit against ordinary
    PDF conversion. Raises the ``signature_layout`` error taxonomy directly;
    ``ProcessPoolExecutor`` re-raises it in the calling process. Returns
    ``(after_layout, after_pdf_path_str)`` — the CLEAN converted PDF (never a
    probe-marked measurement artifact) a caller may publish."""
    from app.core import signature_layout

    source = Path(source_str)
    destination = Path(destination_str)
    signature_layout.write_signature_position(
        source,
        destination,
        signature_id=signature_id,
        page=page,
        x=x,
        y=y,
        layout=layout,
    )
    after_pdf = word_pdf.convert(destination)
    if after_pdf is None:
        raise signature_layout.SignatureRenderFailedError(
            f"Word conversion failed while publishing {destination}"
        )
    after_layout = signature_layout.measure_signature_layout(
        destination, converter=word_pdf.convert
    )
    signature_layout.validate_move(
        before_docx=source,
        after_docx=destination,
        before_pdf=Path(before_pdf_str),
        after_pdf=after_pdf,
        signature_id=signature_id,
        requested_page=page,
        requested_x=x,
        requested_y=y,
        layout_after=after_layout,
    )
    return after_layout, str(after_pdf)


def move_signature_position(
    source: Path,
    destination: Path,
    *,
    signature_id: str,
    page: int,
    x: float,
    y: float,
    layout: SignatureLayout,
    before_pdf: Path,
) -> tuple[SignatureLayout, Path]:
    """Move, convert, remeasure, and validate *signature_id* in one
    worker unit — see ``signature_layout.write_signature_position``/
    ``validate_move``. Returns ``(after_layout, after_pdf_path)``. Raises
    the ``signature_layout`` error taxonomy on any failure; *destination* is
    left on disk for the caller to clean up on a raised error (plan §7.9
    assigns that to the caller, which knows which files it newly owns)."""
    after_layout, after_pdf_str = run_in_worker(
        _move_in_subprocess,
        str(source),
        str(destination),
        signature_id=signature_id,
        page=page,
        x=x,
        y=y,
        layout=layout,
        before_pdf_str=str(before_pdf),
        timeout=240,
    )
    return after_layout, Path(after_pdf_str)


def _background_in_subprocess(docx_path_str: str, signature_id: str) -> str:
    from app.core import signature_layout

    pdf_path = signature_layout.render_signature_free_background(
        Path(docx_path_str), signature_id=signature_id, converter=word_pdf.convert
    )
    return str(pdf_path)


def render_signature_free_background(docx_path: Path, *, signature_id: str) -> Path:
    """Render *docx_path* with *signature_id*'s image hidden behind a
    same-extent transparent placeholder — see
    ``signature_layout.render_signature_free_background``. The returned PDF
    lives in a fresh temporary directory the CALLER owns and must clean up."""
    return Path(run_in_worker(_background_in_subprocess, str(docx_path), signature_id, timeout=180))
