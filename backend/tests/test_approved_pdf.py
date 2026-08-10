from __future__ import annotations

import io

import fitz
import pytest
from PIL import Image

from app.core.approved_pdf import ApprovedPdfError, normalize_upload_to_pdf, stamp_approved_pdf
from app.core.extraction.ocr import qr_refs_from_bytes
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
