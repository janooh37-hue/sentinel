"""Merge attachment files (PDF or image) onto the end of a base PDF (spec §6)."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fitz  # PyMuPDF

_IMAGE_EXTS = {".png", ".jpg", ".jpeg"}


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
