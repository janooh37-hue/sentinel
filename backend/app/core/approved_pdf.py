"""Normalize and stamp already-approved inmate reports."""

from __future__ import annotations

import io
import math

import fitz
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.extraction.ocr import _MAX_PIXELS, _MAX_RASTER_AXIS, InvalidImageError
from app.core.qr import make_aztec_png

_FALLBACK_DPI = 150.0
_OCR_RASTER_DPI = 200.0


def _bounded_page_size(
    pixel_width: int,
    pixel_height: int,
    x_dpi: float,
    y_dpi: float,
) -> tuple[float, float]:
    width = pixel_width * 72.0 / x_dpi
    height = pixel_height * 72.0 / y_dpi
    raster_axis = max(width, height) * _OCR_RASTER_DPI / 72.0
    if raster_axis <= _MAX_RASTER_AXIS:
        return width, height
    scale = _MAX_RASTER_AXIS / raster_axis
    return width * scale, height * scale


def _declared_dpi(value: object) -> tuple[float, float]:
    if not isinstance(value, (tuple, list)) or len(value) != 2:
        return _FALLBACK_DPI, _FALLBACK_DPI
    try:
        x_dpi, y_dpi = (float(value[0]), float(value[1]))
    except (TypeError, ValueError):
        return _FALLBACK_DPI, _FALLBACK_DPI
    if not (math.isfinite(x_dpi) and math.isfinite(y_dpi) and x_dpi > 0 and y_dpi > 0):
        return _FALLBACK_DPI, _FALLBACK_DPI
    return x_dpi, y_dpi


def _load_oriented_rgb(data: bytes) -> tuple[Image.Image, float, float]:
    source: Image.Image | None = None
    oriented: Image.Image | None = None
    try:
        source = Image.open(io.BytesIO(data))
        width, height = source.size
        if width * height > _MAX_PIXELS:
            raise InvalidImageError(f"Image is too large to process ({width}x{height} pixels).")
        orientation = source.getexif().get(274, 1)
        dpi = source.info.get("dpi")
        if source.format == "JPEG" and source.info.get("jfif_unit") == 0:
            dpi = None
        x_dpi, y_dpi = _declared_dpi(dpi)
        if orientation in (5, 6, 7, 8):
            x_dpi, y_dpi = y_dpi, x_dpi
        oriented = ImageOps.exif_transpose(source)
        image = oriented.convert("RGB")
        return image, x_dpi, y_dpi
    except InvalidImageError:
        raise
    except (
        Image.DecompressionBombError,
        UnidentifiedImageError,
        OSError,
        ValueError,
    ) as exc:
        raise InvalidImageError("The uploaded file is not a readable image.") from exc
    finally:
        if oriented is not None and oriented is not source:
            oriented.close()
        if source is not None:
            source.close()


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
        image, x_dpi, y_dpi = _load_oriented_rgb(data)
    except InvalidImageError as exc:
        raise ApprovedPdfError("Upload a valid PDF, PNG or JPEG") from exc

    try:
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        png_bytes = buffer.getvalue()
        width, height = _bounded_page_size(image.width, image.height, x_dpi, y_dpi)
    finally:
        image.close()

    try:
        with fitz.open() as doc:
            page = doc.new_page(width=width, height=height)
            page.insert_image(page.rect, stream=png_bytes, overlay=True)
            pdf_bytes: bytes = doc.tobytes()
        with _open_pdf(pdf_bytes):
            return pdf_bytes
    except (fitz.EmptyFileError, fitz.FileDataError, RuntimeError, ValueError) as exc:
        raise ApprovedPdfError("Upload a valid PDF, PNG or JPEG") from exc


def _derotated_point(page: fitz.Page, point: fitz.Point) -> fitz.Point:
    return point * page.derotation_matrix


def _derotated_rect(page: fitz.Page, rect: fitz.Rect) -> fitz.Rect:
    matrix = page.derotation_matrix
    points = (
        fitz.Point(rect.x0, rect.y0) * matrix,
        fitz.Point(rect.x1, rect.y0) * matrix,
        fitz.Point(rect.x1, rect.y1) * matrix,
        fitz.Point(rect.x0, rect.y1) * matrix,
    )
    return fitz.Rect(
        min(point.x for point in points),
        min(point.y for point in points),
        max(point.x for point in points),
        max(point.y for point in points),
    )


def stamp_approved_pdf(pdf_bytes: bytes, ref_number: str) -> bytes:
    """Stamp ``Ref: <ref>`` and its Aztec payload onto page one of a PDF copy."""
    ref_number = ref_number.strip()
    if not ref_number:
        raise ApprovedPdfError("Reference number is required")

    try:
        with _open_pdf(pdf_bytes) as doc:
            page = doc[0]
            ref_text = f"Ref: {ref_number}"
            ref_width = fitz.get_text_length(ref_text, fontname="helv", fontsize=10)
            page.insert_textbox(
                _derotated_rect(page, fitz.Rect(18, 9, 20 + ref_width, 30)),
                ref_text,
                fontsize=10,
                fontname="helv",
                color=(0, 0, 0),
                overlay=True,
                rotate=(-page.rotation) % 360,
            )
            code_size = min(48.0, page.rect.width * 0.2, page.rect.height * 0.2)
            code_rect = _derotated_rect(
                page,
                fitz.Rect(
                    page.rect.width - code_size - 9,
                    9,
                    page.rect.width - 9,
                    9 + code_size,
                ),
            )
            page.insert_image(
                code_rect,
                stream=make_aztec_png(ref_number),
                overlay=True,
            )
            stamped: bytes = doc.tobytes(garbage=4, deflate=True)
            return stamped
    except ApprovedPdfError:
        raise
    except (fitz.EmptyFileError, fitz.FileDataError, RuntimeError, ValueError) as exc:
        raise ApprovedPdfError("Could not stamp the approved PDF") from exc
