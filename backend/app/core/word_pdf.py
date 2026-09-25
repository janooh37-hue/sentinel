"""DOCX -> PDF through Microsoft Word COM.

Word is the only engine that renders the Word-authored Arabic/English
templates faithfully, so it is the only method. (The old PowerShell fallback
drove the same Word and died the same way on a hang.)

Speed: one hidden Word per process stays warm between conversions. A
``DispatchEx`` cold start costs 2-5 s; a warm conversion costs ~0.5 s.
``quit_word`` releases it; ``_pdf_executor`` calls it after an idle period
because a running Word also receives documents a person opens on the host.

Hang safety: DCOM launches WINWORD.EXE under svchost, not under this
process, so killing this process would leave Word behind. Every Word is put
in a Job Object this process owns with KILL_ON_JOB_CLOSE, so when the
executor kills a wedged worker, its Word dies with it.

Not thread-safe: the warm instance belongs to the thread that created it.
Production runs it on the single executor worker's main thread; the inline
(test) path calls ``quit_word`` after each operation.
"""

from __future__ import annotations

import logging
import sys
import time
import uuid
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_WD_EXPORT_FORMAT_PDF = 17
_MSO_AUTOMATION_SECURITY_FORCE_DISABLE = 3

# (Word.Application, process handle or None) — see module docstring.
_warm: tuple[Any, Any] | None = None
_job: Any = None
# Per-conversion phase timings since the last ``take_timings`` — the worker
# drains them after each operation and hands them back to the API process,
# which owns the log file.
_timings: list[dict[str, Any]] = []


def take_timings() -> list[dict[str, Any]]:
    """Return and clear the timings of conversions since the last call."""
    global _timings
    taken, _timings = _timings, []
    return taken


def convert(docx_path: Path) -> Path | None:
    """Write ``docx_path`` as a sibling ``.pdf``; ``None`` if Word fails."""
    src = docx_path.resolve()
    if not src.exists():
        raise FileNotFoundError(src)
    if sys.platform != "win32":
        log.warning("PDF conversion needs Microsoft Word on Windows")
        return None
    dst = src.with_suffix(".pdf")
    timing: dict[str, Any] = {"bytes": src.stat().st_size, "ok": False}
    _timings.append(timing)
    try:
        t0 = time.perf_counter()
        before = _warm
        word = _word()
        t1 = time.perf_counter()
        timing["cold"] = before is None or before[0] is not word
        timing["word_ms"] = round((t1 - t0) * 1000, 1)
        doc = word.Documents.Open(
            str(src),
            ReadOnly=True,
            AddToRecentFiles=False,
            ConfirmConversions=False,
            NoEncodingDialog=True,
            Visible=False,
        )
        t2 = time.perf_counter()
        timing["open_ms"] = round((t2 - t1) * 1000, 1)
        try:
            doc.ExportAsFixedFormat(str(dst), ExportFormat=_WD_EXPORT_FORMAT_PDF)
            timing["export_ms"] = round((time.perf_counter() - t2) * 1000, 1)
        finally:
            t3 = time.perf_counter()
            doc.Close(False)
            timing["close_ms"] = round((time.perf_counter() - t3) * 1000, 1)
    except Exception:
        log.exception("Word PDF conversion failed for %s", src)
        _discard()  # unknown state: the next call starts a fresh Word
        return None
    if dst.is_file() and dst.stat().st_size > 0:
        timing["ok"] = True
        return dst
    log.warning("Word produced no PDF for %s", src)
    return None


def quit_word() -> None:
    """Release the warm Word, if any."""
    global _warm
    if _warm is None:
        return
    word, handle = _warm
    _warm = None
    try:
        if word.Documents.Count:
            _hand_over(word)
            return
        word.Quit()
    except Exception:
        _terminate(handle)


def _word() -> Any:
    global _warm
    if _warm is not None:
        word = _warm[0]
        try:
            foreign = word.Documents.Count  # we close ours, so any are a person's
        except Exception:
            _discard()  # Word died or was closed by hand
        else:
            if not foreign:
                return word
            _warm = None
            _hand_over(word)

    import win32com.client

    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    word.AutomationSecurity = _MSO_AUTOMATION_SECURITY_FORCE_DISABLE
    try:
        handle = _tie_to_this_process(word)
    except Exception:
        # Conversion still works; only kill-with-worker is lost for this Word.
        log.warning("Could not bind Word to the worker job", exc_info=True)
        handle = None
    _warm = (word, handle)
    return word


def _tie_to_this_process(word: Any) -> Any:
    """Put ``word``'s process in this process's kill-on-close job and return
    a handle that can terminate it."""
    global _job
    import win32api
    import win32con
    import win32gui
    import win32job
    import win32process

    caption = f"gssg-pdf-{uuid.uuid4().hex}"
    word.Caption = caption
    hwnd = win32gui.FindWindow("OpusApp", caption)
    if not hwnd:
        raise RuntimeError("Word window not found")
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    if _job is None:
        _job = win32job.CreateJobObject(None, "")
        info = win32job.QueryInformationJobObject(_job, win32job.JobObjectExtendedLimitInformation)
        info["BasicLimitInformation"]["LimitFlags"] |= win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        win32job.SetInformationJobObject(_job, win32job.JobObjectExtendedLimitInformation, info)
    handle = win32api.OpenProcess(
        win32con.PROCESS_SET_QUOTA | win32con.PROCESS_TERMINATE | win32con.SYNCHRONIZE, False, pid
    )
    win32job.AssignProcessToJobObject(_job, handle)
    return handle


def _hand_over(word: Any) -> None:
    # ponytail: the handed-over Word stays in the worker's job, so it is killed
    # if the worker is reaped or the service stops; a per-Word job fixes that.
    log.warning("Hidden conversion Word received a user's document; showing it")
    try:
        word.Visible = True
    except Exception:
        log.debug("Could not show handed-over Word", exc_info=True)


def _discard() -> None:
    global _warm
    if _warm is None:
        return
    word, handle = _warm
    _warm = None
    try:
        word.Quit(False)
    except Exception:
        _terminate(handle)


def _terminate(handle: Any) -> None:
    if handle is None:
        return
    import win32api

    try:
        win32api.TerminateProcess(handle, 1)
    except Exception:
        log.debug("TerminateProcess on Word failed", exc_info=True)
