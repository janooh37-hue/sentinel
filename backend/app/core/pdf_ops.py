"""Native PDF operations. They run ONLY inside a confined worker process (``pdf_child``).

Everything here is the original PyMuPDF code of the nine lane-reachable entrypoints
(``ocr.pdf_text_layer`` / ``pdf_to_images``, ``pdf_merge.build_pdf_package`` /
``merge_pdfs_to_bytes``, ``book_service._image_to_pdf_bytes``, ``included_papers_service``
``inspect_paper`` / ``describe_package`` / ``publish_signed_package`` and
``artifact_service._convert``'s page validation), moved so the API process never executes
MuPDF itself. The public facades keep their signatures and map results/exceptions back.

Contract of an op: primitives in (``str`` absolute paths, ``bytes``, ``int``, ``bool``),
primitives out (``str``, ``bytes``, ``int``, tuples). No ``Session``, no ``Path``, no
generator crosses the process boundary; a streaming op is a generator yielding
``(meta, blob)`` pairs that the parent pulls one at a time.
"""

from __future__ import annotations

import math
import os
import threading
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path
from typing import Any

import fitz

from app.core.extraction.ocr import _MAX_PIXELS, _MAX_RASTER_AXIS, InvalidImageError
from app.core.pdf_merge import _IMAGE_EXTS, PdfPackageSourceError


def ping() -> tuple[int, int, str]:
    """Who am I: ``(pid, parent pid, thread name)``. Used by health checks and tests."""
    return os.getpid(), os.getppid(), threading.current_thread().name


def text_layer(pdf_bytes: bytes) -> str:
    """Embedded text layer of *pdf_bytes* (``""`` if none/unreadable)."""
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            return "\n".join(page.get_text() for page in doc)
    except (fitz.FileDataError, fitz.EmptyFileError, RuntimeError):
        return ""


def rasters(pdf_bytes: bytes, dpi: int) -> Iterator[tuple[tuple[int, int], bytes]]:
    """Yield ``((width, height), RGB samples)`` per page, one page per pull.

    Same bounds as the original in-process generator: per-axis, per-page and cumulative
    pixel caps are checked BEFORE a page is rasterised, so an oversized page never renders.
    """
    if dpi <= 0:
        raise InvalidImageError("PDF raster DPI must be positive.")

    total_pixels = 0
    scale = dpi / 72.0
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            for page in doc:
                width = math.ceil(page.rect.width * scale)
                height = math.ceil(page.rect.height * scale)
                pixels = width * height
                if (
                    width <= 0
                    or height <= 0
                    or width > _MAX_RASTER_AXIS
                    or height > _MAX_RASTER_AXIS
                    or pixels > _MAX_PIXELS
                    or total_pixels > _MAX_PIXELS - pixels
                ):
                    raise InvalidImageError("The uploaded PDF is too large to rasterize safely.")
                total_pixels += pixels
                pix = page.get_pixmap(dpi=dpi, alpha=False)
                yield (pix.width, pix.height), pix.samples
    except InvalidImageError:
        raise
    except (fitz.FileDataError, fitz.EmptyFileError, RuntimeError) as exc:
        raise InvalidImageError("The uploaded PDF is not readable.") from exc


def build_package(
    fixed_base: str, sources: Sequence[tuple[str, str]]
) -> tuple[bytes, int, int, tuple[int, ...]]:
    """Fixed-base-first package: ``(pdf_bytes, fixed pages, total pages, per-source pages)``."""
    base_path = Path(fixed_base)
    if not base_path.is_file():
        raise FileNotFoundError(base_path)
    output = fitz.open()
    page_counts: list[int] = []
    try:
        with fitz.open(base_path) as base:
            output.insert_pdf(base)
            fixed_pages = base.page_count
        for raw_source, display_name in sources:
            source = Path(raw_source)
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
        return bytes(output.tobytes()), fixed_pages, output.page_count, tuple(page_counts)
    finally:
        output.close()


def merge_to_bytes(base_pdf: str, sources: Sequence[str]) -> bytes:
    """``base_pdf`` with each existing source appended; missing sources are skipped."""
    out = fitz.open(Path(base_pdf))
    try:
        for raw_source in sources:
            src = Path(raw_source)
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


def image_to_pdf(data: bytes, ext: str) -> bytes:
    """One-page PDF for an uploaded image scan (raises whatever MuPDF raises)."""
    with fitz.open(stream=data, filetype=ext.lstrip(".")) as img:
        pdf_bytes: bytes = img.convert_to_pdf()
    return pdf_bytes


def inspect_source(path: str, is_image: bool) -> int:
    """Page count of one package source; raises when it is unreadable."""
    if is_image:
        with fitz.open(path) as image:
            image.convert_to_pdf()
        return 1
    with fitz.open(path) as pdf:
        if pdf.page_count < 1:
            raise ValueError("PDF has no pages")
        return int(pdf.page_count)


def page_count(path: str) -> int:
    """Page count of the document at *path*; raises when it cannot be opened."""
    with fitz.open(path) as pdf:
        return int(pdf.page_count)


OPS: dict[str, Callable[..., Any]] = {
    "ping": ping,
    "text_layer": text_layer,
    "rasters": rasters,
    "build_package": build_package,
    "merge_to_bytes": merge_to_bytes,
    "image_to_pdf": image_to_pdf,
    "inspect_source": inspect_source,
    "page_count": page_count,
}
