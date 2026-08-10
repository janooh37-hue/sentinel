"""Normalize and stamp already-approved inmate reports."""

from __future__ import annotations

import io

import fitz

from app.core.extraction.ocr import InvalidImageError, load_image
from app.core.qr import make_aztec_png


class ApprovedPdfError(ValueError):
    """The uploaded artifact cannot be filed as an approved PDF."""


def _open_pdf(data: bytes) -> fitz.Document:
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except (fitz.EmptyFileError, fitz.FileDataError, RuntimeError) as exc:
        raise ApprovedPdfError("Upload a valid PDF, PNG or JPEG") from exc
    if doc.needs_pass or doc.page_count < 1:
        doc.close()
        raise ApprovedPdfError("Upload a readable PDF with at least one page")
    return doc


def normalize_upload_to_pdf(data: bytes) -> bytes:
    """Validate PDF bytes or convert a decoded PNG/JPEG into a one-page PDF."""
    if not data:
        raise ApprovedPdfError("The uploaded file is empty")
    if data.startswith(b"%PDF"):
        with _open_pdf(data):
            return data
    if not (data.startswith(b"\x89PNG\r\n\x1a\n") or data.startswith(b"\xff\xd8\xff")):
        raise ApprovedPdfError("Upload a valid PDF, PNG or JPEG")

    try:
        image = load_image(data)
    except InvalidImageError as exc:
        raise ApprovedPdfError("Upload a valid PDF, PNG or JPEG") from exc
    buffer = io.BytesIO()
    try:
        image.save(buffer, format="PNG")
    finally:
        image.close()

    try:
        with fitz.open(stream=buffer.getvalue(), filetype="png") as image_doc:
            pdf_bytes = image_doc.convert_to_pdf()
        with _open_pdf(pdf_bytes):
            return pdf_bytes
    except (fitz.EmptyFileError, fitz.FileDataError, RuntimeError) as exc:
        raise ApprovedPdfError("Upload a valid PDF, PNG or JPEG") from exc


def stamp_approved_pdf(pdf_bytes: bytes, ref_number: str) -> bytes:
    """Stamp ``Ref: <ref>`` and its Aztec payload onto page one of a PDF copy."""
    ref_number = ref_number.strip()
    if not ref_number:
        raise ApprovedPdfError("Reference number is required")

    try:
        with _open_pdf(pdf_bytes) as doc:
            page = doc[0]
            page.insert_text(
                fitz.Point(18, 20),
                f"Ref: {ref_number}",
                fontsize=10,
                fontname="helv",
                color=(0, 0, 0),
                overlay=True,
            )
            code_size = min(48.0, page.rect.width * 0.2, page.rect.height * 0.2)
            code_rect = fitz.Rect(
                page.rect.width - code_size - 9,
                9,
                page.rect.width - 9,
                9 + code_size,
            )
            page.insert_image(
                code_rect,
                stream=make_aztec_png(ref_number),
                overlay=True,
            )
            return doc.tobytes(garbage=4, deflate=True)
    except ApprovedPdfError:
        raise
    except (fitz.EmptyFileError, fitz.FileDataError, RuntimeError, ValueError) as exc:
        raise ApprovedPdfError("Could not stamp the approved PDF") from exc
