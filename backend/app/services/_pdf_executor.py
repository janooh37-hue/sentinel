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
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.signature_layout import SignatureLayout

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


def _measure_in_subprocess(docx_path_str: str) -> SignatureLayout:
    """Top-level function so ProcessPoolExecutor can pickle it. Calls
    ``PdfChain`` directly — never resubmits to this same executor from
    inside a worker process (approval-signature-placement plan §6.1)."""
    from app.core import signature_layout
    from app.core.pdf_chain import PdfChain

    def _convert(path: Path) -> Path | None:
        return PdfChain().convert_or_none(path).path

    return signature_layout.measure_signature_layout(Path(docx_path_str), converter=_convert)


def measure_signature_position(docx_path: Path) -> SignatureLayout:
    """Measure every marked signature's physical page/position in
    *docx_path* — see ``signature_layout.measure_signature_layout``. Runs
    in the isolated one-worker process (or in-thread under
    ``GSSG_INLINE_PDF=1``), serialized with ordinary PDF conversion so two
    Word instances never race."""
    if os.environ.get("GSSG_INLINE_PDF") == "1":
        return _measure_in_subprocess(str(docx_path))
    fut = get_executor().submit(_measure_in_subprocess, str(docx_path))
    return fut.result(timeout=180)


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
    """Top-level function so ProcessPoolExecutor can pickle it. Performs the
    move, converts the result, remeasures it, and validates the remeasured
    result against the request — entirely inside the one worker process, so
    the whole operation is one serialized unit against ordinary PDF
    conversion. Raises the ``signature_layout`` error taxonomy directly;
    ``ProcessPoolExecutor`` re-raises it (with its original message) in the
    calling process. Returns ``(after_layout, after_pdf_path_str)`` — the
    CLEAN converted PDF (never a probe-marked measurement artifact) a
    caller may publish."""
    from app.core import signature_layout
    from app.core.pdf_chain import PdfChain

    def _convert(path: Path) -> Path | None:
        return PdfChain().convert_or_none(path).path

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
    after_pdf = _convert(destination)
    if after_pdf is None:
        raise signature_layout.SignatureRenderFailedError(
            f"Word conversion failed while publishing {destination}"
        )
    after_layout = signature_layout.measure_signature_layout(destination, converter=_convert)
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
    isolated-worker unit — see ``signature_layout.write_signature_position``/
    ``validate_move``. Returns ``(after_layout, after_pdf_path)``. Raises
    the ``signature_layout`` error taxonomy on any failure; *destination* is
    left on disk for the caller to clean up on a raised error (this
    function performs no cleanup — plan §7.9 assigns that to the caller,
    which knows which files it newly owns)."""
    if os.environ.get("GSSG_INLINE_PDF") == "1":
        after_layout, after_pdf_str = _move_in_subprocess(
            str(source),
            str(destination),
            signature_id=signature_id,
            page=page,
            x=x,
            y=y,
            layout=layout,
            before_pdf_str=str(before_pdf),
        )
    else:
        fut = get_executor().submit(
            _move_in_subprocess,
            str(source),
            str(destination),
            signature_id=signature_id,
            page=page,
            x=x,
            y=y,
            layout=layout,
            before_pdf_str=str(before_pdf),
        )
        after_layout, after_pdf_str = fut.result(timeout=240)
    return after_layout, Path(after_pdf_str)


def _background_in_subprocess(docx_path_str: str, signature_id: str) -> str:
    """Top-level function so ProcessPoolExecutor can pickle it."""
    from app.core import signature_layout
    from app.core.pdf_chain import PdfChain

    def _convert(path: Path) -> Path | None:
        return PdfChain().convert_or_none(path).path

    pdf_path = signature_layout.render_signature_free_background(
        Path(docx_path_str), signature_id=signature_id, converter=_convert
    )
    return str(pdf_path)


def render_signature_free_background(docx_path: Path, *, signature_id: str) -> Path:
    """Render *docx_path* with *signature_id*'s image hidden behind a
    same-extent transparent placeholder — see
    ``signature_layout.render_signature_free_background``. The returned PDF
    lives in a fresh temporary directory the CALLER owns and must clean up."""
    if os.environ.get("GSSG_INLINE_PDF") == "1":
        return Path(_background_in_subprocess(str(docx_path), signature_id))
    fut = get_executor().submit(_background_in_subprocess, str(docx_path), signature_id)
    return Path(fut.result(timeout=180))
