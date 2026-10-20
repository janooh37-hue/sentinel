"""Merge attachment files (PDF or image) onto the end of a base PDF (spec §6).

The PyMuPDF work of ``build_pdf_package`` / ``merge_pdfs_to_bytes`` and the small page-count
and image-conversion helpers below runs in a confined worker process
(``app.core.pdf_worker`` / ``app.core.pdf_ops``), never in the calling API/lane thread. The
functions keep their original signatures, results and exceptions; ``pdf_worker`` is imported
inside them because the worker process itself imports this module and must stay FastAPI-free.
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

_IMAGE_EXTS = {".png", ".jpg", ".jpeg"}


@dataclass(frozen=True)
class PdfPackageResult:
    pdf_bytes: bytes
    fixed_page_count: int
    total_page_count: int
    item_page_counts: tuple[int, ...]


class PdfPackageSourceError(ValueError):
    def __init__(self, filename: str) -> None:
        self.filename = filename
        super().__init__(f"Could not read {filename}")

    def __reduce__(self) -> tuple[type[PdfPackageSourceError], tuple[str]]:
        # The default reduce replays ``args`` (the already formatted message) through
        # ``__init__``, which would wrap it a second time across the worker pipe.
        return (type(self), (self.filename,))


def _wire_path(path: Path | str) -> str:
    """Absolute path for the worker: its cwd is whatever it was when it was spawned."""
    return os.path.abspath(os.fspath(path))


def build_pdf_package(
    fixed_base: Path,
    sources: Sequence[tuple[Path, str]],
) -> PdfPackageResult:
    """Return a fixed-base-first PDF package without modifying any input."""
    from app.core import pdf_worker

    if not fixed_base.is_file():
        raise FileNotFoundError(fixed_base)
    pdf_bytes, fixed_pages, total_pages, item_pages = pdf_worker.call(
        "build_package",
        _wire_path(fixed_base),
        [(_wire_path(source), display_name) for source, display_name in sources],
    )
    return PdfPackageResult(
        pdf_bytes=pdf_bytes,
        fixed_page_count=fixed_pages,
        total_page_count=total_pages,
        item_page_counts=tuple(item_pages),
    )


def merge_pdfs_to_bytes(base_pdf: Path, sources: Sequence[Path]) -> bytes:
    """Return ``base_pdf`` with each source appended, as PDF bytes.

    Like :func:`merge_attachments_into_pdf` but non-destructive — ``base_pdf`` on
    disk is never modified. Used to serve a primary document's PDF with its
    companion pages (Leave Undertaking, etc.) appended, without mutating the
    stored original. Missing sources are skipped (serve-time must not 500).
    """
    from app.core import pdf_worker

    merged: bytes = pdf_worker.call(
        "merge_to_bytes", _wire_path(base_pdf), [_wire_path(source) for source in sources]
    )
    return merged


def pdf_page_count(path: Path) -> int:
    """Page count of the document at *path*, computed in the worker.

    Raises what PyMuPDF raised (``RuntimeError`` family for an unreadable file); a worker
    failure raises ``pdf_worker.NativeWorkerError`` instead, never one of those.
    """
    from app.core import pdf_worker

    pages: int = pdf_worker.call("page_count", _wire_path(path))
    return pages


def inspect_source_pages(path: Path, *, is_image: bool) -> int:
    """Validate one package source in the worker and return its page count.

    Images are fully converted (a corrupt image fails here); a PDF must have a page.
    """
    from app.core import pdf_worker

    pages: int = pdf_worker.call("inspect_source", _wire_path(path), is_image)
    return pages


def image_to_pdf_bytes(data: bytes, ext: str) -> bytes:
    """One-page PDF bytes for an image upload, converted in the worker."""
    from app.core import pdf_worker

    pdf: bytes = pdf_worker.call("image_to_pdf", data, ext)
    return pdf


def merge_attachments_into_pdf(base_pdf: Path, sources: Sequence[Path]) -> None:
    """Append each source (in order) to base_pdf, writing atomically via a temp file.

    PDFs are inserted page-for-page; images become one full PDF page each.
    Raises FileNotFoundError for a missing source; base_pdf is untouched on error.
    """
    import fitz  # PyMuPDF — in-process; no caller (not one of the confined entrypoints)

    if not sources:
        return
    for src in sources:
        if not src.is_file():
            raise FileNotFoundError(src)
    out = fitz.open(base_pdf)
    try:
        for src in sources:
            if src.suffix.lower() in _IMAGE_EXTS:
                with fitz.open(src) as img:
                    pdf_bytes = img.convert_to_pdf()
                with fitz.open("pdf", pdf_bytes) as img_pdf:
                    out.insert_pdf(img_pdf)
            else:
                with fitz.open(src) as src_doc:
                    out.insert_pdf(src_doc)
        tmp = base_pdf.with_suffix(".merge.tmp.pdf")
        out.save(tmp)
    finally:
        out.close()
    tmp.replace(base_pdf)
