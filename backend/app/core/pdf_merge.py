"""Merge attachment files (PDF or image) onto the end of a base PDF (spec §6)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF

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


def build_pdf_package(
    fixed_base: Path,
    sources: Sequence[tuple[Path, str]],
) -> PdfPackageResult:
    """Return a fixed-base-first PDF package without modifying any input."""
    if not fixed_base.is_file():
        raise FileNotFoundError(fixed_base)
    output = fitz.open()
    page_counts: list[int] = []
    try:
        with fitz.open(fixed_base) as base:
            output.insert_pdf(base)
            fixed_pages = base.page_count
        for source, display_name in sources:
            if not source.is_file():
                raise FileNotFoundError(display_name)
            try:
                if source.suffix.lower() in _IMAGE_EXTS:
                    with fitz.open(source) as image:
                        converted = image.convert_to_pdf()
                    with fitz.open("pdf", converted) as source_pdf:
                        output.insert_pdf(source_pdf)
                        page_counts.append(source_pdf.page_count)
                else:
                    with fitz.open(source) as source_pdf:
                        if source_pdf.page_count < 1:
                            raise ValueError("PDF has no pages")
                        output.insert_pdf(source_pdf)
                        page_counts.append(source_pdf.page_count)
            except Exception as exc:
                raise PdfPackageSourceError(display_name) from exc
        return PdfPackageResult(
            pdf_bytes=bytes(output.tobytes()),
            fixed_page_count=fixed_pages,
            total_page_count=output.page_count,
            item_page_counts=tuple(page_counts),
        )
    finally:
        output.close()


def merge_pdfs_to_bytes(base_pdf: Path, sources: Sequence[Path]) -> bytes:
    """Return ``base_pdf`` with each source appended, as PDF bytes.

    Like :func:`merge_attachments_into_pdf` but non-destructive — ``base_pdf`` on
    disk is never modified. Used to serve a primary document's PDF with its
    companion pages (Leave Undertaking, etc.) appended, without mutating the
    stored original. Missing sources are skipped (serve-time must not 500).
    """
    out = fitz.open(base_pdf)
    try:
        for src in sources:
            if not src.is_file():
                continue
            if src.suffix.lower() in _IMAGE_EXTS:
                with fitz.open(src) as img:
                    pdf_bytes = img.convert_to_pdf()
                with fitz.open("pdf", pdf_bytes) as img_pdf:
                    out.insert_pdf(img_pdf)
            else:
                with fitz.open(src) as src_doc:
                    out.insert_pdf(src_doc)
        return bytes(out.tobytes())
    finally:
        out.close()


def merge_attachments_into_pdf(base_pdf: Path, sources: Sequence[Path]) -> None:
    """Append each source (in order) to base_pdf, writing atomically via a temp file.

    PDFs are inserted page-for-page; images become one full PDF page each.
    Raises FileNotFoundError for a missing source; base_pdf is untouched on error.
    """
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
