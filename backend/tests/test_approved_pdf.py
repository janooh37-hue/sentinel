from __future__ import annotations

import io
import math

import fitz
import pytest
from PIL import Image

from app.core.approved_pdf import ApprovedPdfError, normalize_upload_to_pdf, stamp_approved_pdf
from app.core.extraction.ocr import _MAX_PIXELS, qr_refs_from_bytes
from app.core.qr import qr_decode_available


def _sample_pdf() -> bytes:
    doc = fitz.open()
    first = doc.new_page(width=595, height=842)
    first.insert_text((72, 100), "Approved inmate report")
    second = doc.new_page(width=595, height=842)
    second.insert_text((72, 100), "Second page")
    data = doc.tobytes()
    doc.close()
    return data


def _image_bytes(fmt: str) -> bytes:
    image = Image.new("RGB", (320, 240), "white")
    output = io.BytesIO()
    image.save(output, format=fmt)
    return output.getvalue()


def test_normalize_pdf_preserves_pages_and_dimensions() -> None:
    normalized = normalize_upload_to_pdf(_sample_pdf())

    with fitz.open(stream=normalized, filetype="pdf") as doc:
        assert doc.page_count == 2
        assert [page.rect for page in doc] == [fitz.Rect(0, 0, 595, 842)] * 2
        assert "Approved inmate report" in doc[0].get_text()


@pytest.mark.parametrize("fmt", ["PNG", "JPEG"])
def test_normalize_image_to_real_pdf(fmt: str) -> None:
    normalized = normalize_upload_to_pdf(_image_bytes(fmt))

    assert normalized.startswith(b"%PDF")
    with fitz.open(stream=normalized, filetype="pdf") as doc:
        assert doc.page_count == 1


def test_normalize_exif_rotated_jpeg_before_rasterization() -> None:
    image = Image.new("RGB", (40, 20), "white")
    exif = image.getexif()
    exif[274] = 6  # Rotate 90° clockwise for display.
    output = io.BytesIO()
    image.save(output, format="JPEG", exif=exif)

    normalized = normalize_upload_to_pdf(output.getvalue())

    with fitz.open(stream=normalized, filetype="pdf") as doc:
        assert doc.page_count == 1
        assert doc[0].rect.width == pytest.approx(20 * 72 / 150)
        assert doc[0].rect.height == pytest.approx(40 * 72 / 150)


def test_normalize_image_uses_declared_xy_dpi_for_page_size() -> None:
    image = Image.new("RGB", (300, 150), "white")
    output = io.BytesIO()
    image.save(output, format="PNG", dpi=(300, 150))

    normalized = normalize_upload_to_pdf(output.getvalue())

    with fitz.open(stream=normalized, filetype="pdf") as doc:
        assert doc[0].rect.width == pytest.approx(300 * 72 / 300, abs=0.01)
        assert doc[0].rect.height == pytest.approx(150 * 72 / 150, abs=0.01)


def test_normalize_image_bounds_low_dpi_page_for_ocr_rasterization() -> None:
    image = Image.new("RGB", (4000, 10), "white")
    output = io.BytesIO()
    image.save(output, format="PNG", dpi=(1, 1))

    normalized = normalize_upload_to_pdf(output.getvalue())

    with fitz.open(stream=normalized, filetype="pdf") as doc:
        raster_width = math.ceil(doc[0].rect.width * 200 / 72)
        raster_height = math.ceil(doc[0].rect.height * 200 / 72)
        assert max(raster_width, raster_height) <= math.isqrt(_MAX_PIXELS)
        assert raster_width * raster_height <= _MAX_PIXELS


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_stamp_rotated_page_keeps_visual_stamp_placement(rotation: int) -> None:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Approved inmate report")
    page.set_rotation(rotation)
    mediabox = page.mediabox
    cropbox = page.cropbox
    source = doc.tobytes()
    doc.close()
    stamped = stamp_approved_pdf(source, "NAT-0042")

    with fitz.open(stream=stamped, filetype="pdf") as stamped_doc:
        page = stamped_doc[0]
        ref_rect = page.search_for("Ref: NAT-0042").pop()
        visual_ref_rect = ref_rect * page.rotation_matrix
        assert visual_ref_rect.x0 < page.rect.width * 0.12
        assert visual_ref_rect.y0 < page.rect.height * 0.12
        image_info = page.get_image_info()
        assert len(image_info) == 1
        visual_code_rect = fitz.Rect(image_info[0]["bbox"]) * page.rotation_matrix
        assert visual_code_rect.x1 > page.rect.width * 0.8
        assert visual_code_rect.y1 < page.rect.height * 0.2
        assert page.rotation == rotation
        assert page.mediabox == mediabox
        assert page.cropbox == cropbox


@pytest.mark.skipif(not qr_decode_available(), reason="zxing-cpp is unavailable")
def test_stamp_rotated_page_keeps_aztec_decodable() -> None:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.set_rotation(90)
    source = doc.tobytes()
    doc.close()

    assert qr_refs_from_bytes(stamp_approved_pdf(source, "NAT-0042")) == ["NAT-0042"]


@pytest.mark.parametrize("fmt", ["PNG", "JPEG"])
def test_normalize_image_uses_conservative_fallback_dpi(fmt: str) -> None:
    normalized = normalize_upload_to_pdf(_image_bytes(fmt))

    with fitz.open(stream=normalized, filetype="pdf") as doc:
        assert doc[0].rect.width == pytest.approx(320 * 72 / 150)
        assert doc[0].rect.height == pytest.approx(240 * 72 / 150)


def test_stamp_writes_reference_on_first_page_only() -> None:
    stamped = stamp_approved_pdf(_sample_pdf(), "NAT-0042")

    with fitz.open(stream=stamped, filetype="pdf") as doc:
        assert "Ref: NAT-0042" in doc[0].get_text()
        assert "Ref: NAT-0042" not in doc[1].get_text()
        ref_rect = doc[0].search_for("Ref: NAT-0042").pop()
        assert ref_rect.y1 < doc[0].rect.height * 0.12
        assert [page.rect for page in doc] == [fitz.Rect(0, 0, 595, 842)] * 2


@pytest.mark.skipif(not qr_decode_available(), reason="zxing-cpp is unavailable")
def test_stamp_writes_decodable_aztec_reference() -> None:
    stamped = stamp_approved_pdf(_sample_pdf(), "NAT-0042")

    assert qr_refs_from_bytes(stamped) == ["NAT-0042"]


@pytest.mark.parametrize("data", [b"", b"not a document", b"%PDF-corrupt"])
def test_normalize_rejects_unreadable_uploads(data: bytes) -> None:
    with pytest.raises(ApprovedPdfError):
        normalize_upload_to_pdf(data)
