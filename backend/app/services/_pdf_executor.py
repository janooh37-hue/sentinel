"""Process-pool PDF executor.

COM objects (Word.Application) must live on the main thread of their STA
apartment. When uvicorn runs inside pywebview's thread, calling docx2pdf /
win32com from a uvicorn worker thread breaks COM. We work around this by
running each conversion in a fresh subprocess via a ProcessPoolExecutor so
the child process has its own STA thread.

Set GSSG_INLINE_PDF=1 to skip the process pool and run conversion in the
calling thread — useful for pytest (forking inside pytest on Windows is
fragile) and for CI environments without Word installed.
"""

from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

_executor: ProcessPoolExecutor | None = None


def get_executor() -> ProcessPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ProcessPoolExecutor(max_workers=1)
    return _executor


def _convert_in_subprocess(docx_path_str: str) -> str | None:
    """Top-level function so ProcessPoolExecutor can pickle it."""
    from app.core.pdf_chain import PdfChain

    result = PdfChain().convert_or_none(Path(docx_path_str))
    return str(result.path) if result.path else None


def convert_docx_to_pdf(docx_path: Path) -> Path | None:
    """Convert *docx_path* to PDF.

    When ``GSSG_INLINE_PDF=1`` runs the conversion in-thread (test/CI mode).
    Otherwise submits to the process pool so COM stays on a fresh STA thread.

    Returns the PDF path on success, ``None`` if conversion fails.
    """
    if os.environ.get("GSSG_INLINE_PDF") == "1":
        # In-thread path for tests / CI
        from app.core.pdf_chain import PdfChain

        result = PdfChain().convert_or_none(docx_path)
        return result.path

    fut = get_executor().submit(_convert_in_subprocess, str(docx_path))
    raw = fut.result(timeout=120)
    return Path(raw) if raw else None
