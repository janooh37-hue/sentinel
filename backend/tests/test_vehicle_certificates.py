"""Vehicle certificate compression: readability, size, and preservation contracts.

Exercises the real ``app.core.vehicle_certificates.optimize_certificate`` —
never a fake/mocked compressor — against synthetic, non-PII fixtures. Each
test asserts a consumer-visible invariant (decoded content, QR payload, page
count/text, or exact byte-preservation), not which encoder arguments were
passed.
"""

from __future__ import annotations

import io

import pymupdf
import pytest
import zxingcpp
from PIL import Image

from app.core.vehicle_certificates import optimize_certificate

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")


def _qr_image(payload: str, *, scale: int = 10) -> Image.Image:
    barcode = zxingcpp.create_barcode(payload, zxingcpp.BarcodeFormat.QRCode)
    return Image.fromarray(barcode.to_image(scale=scale)).convert("L")


def _decode_qr(image: Image.Image) -> str | None:
    results = zxingcpp.read_barcodes(image)
    return results[0].text if results else None


def _oversized_certificate_jpeg(payload: str = "GSSG-CERT-0001") -> bytes:
    """A 4500x3200 scan-like JPEG with an embedded, decodable QR code."""
    canvas = Image.new("RGB", (4500, 3200), (250, 248, 240))
    qr = _qr_image(payload, scale=6).convert("RGB")
    canvas.paste(qr, (200, 200))
    buffer = io.BytesIO()
    canvas.save(buffer, format="JPEG", quality=98)
    return buffer.getvalue()


def _pdf_with_qr_and_text(payload: str = "GSSG-CERT-PDF-0001") -> bytes:
    """A single-page A4 PDF: an oversized embedded scan image plus real text."""
    canvas = Image.new("RGB", (4000, 3000), (245, 243, 235))
    qr = _qr_image(payload, scale=6).convert("RGB")
    canvas.paste(qr, (150, 150))
    image_buffer = io.BytesIO()
    canvas.save(image_buffer, format="PNG")

    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(0, 0, 595, 842), stream=image_buffer.getvalue())
    page.insert_text((50, 780), "Vehicle certificate sample — GSSG Manager", fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


def _render_first_page(pdf_bytes: bytes, *, dpi: int = 150) -> Image.Image:
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        pix = doc[0].get_pixmap(dpi=dpi)
        return Image.open(io.BytesIO(pix.tobytes("png"))).convert("L")


# ── Images ───────────────────────────────────────────────────────────────


def test_image_current_profile_shrinks_oversized_jpeg_and_preserves_qr_payload() -> None:
    original = _oversized_certificate_jpeg()
    current = optimize_certificate(original, "image/jpeg", profile="current")

    assert len(current) < len(original)
    decoded = Image.open(io.BytesIO(current))
    assert decoded.format == "JPEG"
    assert _decode_qr(decoded) == "GSSG-CERT-0001"


def test_image_historical_profile_shrinks_current_output_further_and_preserves_qr() -> None:
    original = _oversized_certificate_jpeg("GSSG-CERT-0002")
    current = optimize_certificate(original, "image/jpeg", profile="current")
    historical = optimize_certificate(current, "image/jpeg", profile="historical")

    assert len(historical) < len(current)
    decoded = Image.open(io.BytesIO(historical))
    assert _decode_qr(decoded) == "GSSG-CERT-0002"


def test_image_preserves_transparency_and_never_grows_an_efficient_png() -> None:
    small = Image.new("RGBA", (300, 200), (12, 34, 56, 128))
    buffer = io.BytesIO()
    small.save(buffer, format="PNG")
    original = buffer.getvalue()

    current = optimize_certificate(original, "image/png", profile="current")
    assert len(current) <= len(original)
    decoded = Image.open(io.BytesIO(current))
    assert decoded.mode == "RGBA"
    assert decoded.size == (300, 200)
    assert decoded.getpixel((10, 10)) == (12, 34, 56, 128)


def test_image_orientation_is_baked_in_not_left_to_rotate_twice() -> None:
    # A wide image tagged "rotate 90 CW" (EXIF orientation 6) should come back
    # tall, with the rotation already applied — never re-rotatable downstream.
    wide = Image.new("RGB", (600, 300), (200, 30, 30))
    wide.putpixel((10, 10), (0, 255, 0))  # marker near the original top-left
    exif = Image.Exif()
    exif[274] = 6
    buffer = io.BytesIO()
    wide.save(buffer, format="JPEG", quality=95, exif=exif)
    original = buffer.getvalue()

    current = optimize_certificate(original, "image/jpeg", profile="current")
    decoded = Image.open(io.BytesIO(current))
    assert decoded.size == (300, 600)
    assert decoded.getexif().get(274, 1) == 1


def test_animated_image_is_rejected_not_silently_flattened() -> None:
    frames = [Image.new("RGB", (80, 80), c) for c in [(255, 0, 0), (0, 255, 0), (0, 0, 255)]]
    buffer = io.BytesIO()
    frames[0].save(buffer, format="WEBP", save_all=True, append_images=frames[1:], duration=120)

    with pytest.raises(ValueError, match="VEHICLE_CERTIFICATE_ANIMATED"):
        optimize_certificate(buffer.getvalue(), "image/webp", profile="current")


def test_oversized_image_is_rejected_before_full_decode() -> None:
    huge = Image.new("RGB", (13000, 50), "white")
    buffer = io.BytesIO()
    huge.save(buffer, format="PNG")

    with pytest.raises(ValueError, match="VEHICLE_CERTIFICATE_DIMENSIONS_TOO_LARGE"):
        optimize_certificate(buffer.getvalue(), "image/png", profile="current")


def test_mismatched_declared_format_is_rejected() -> None:
    png = Image.new("RGB", (100, 100), "white")
    buffer = io.BytesIO()
    png.save(buffer, format="PNG")

    with pytest.raises(ValueError, match="VEHICLE_CERTIFICATE_INVALID"):
        optimize_certificate(buffer.getvalue(), "image/jpeg", profile="current")


def test_malformed_image_bytes_are_rejected() -> None:
    with pytest.raises(ValueError, match="VEHICLE_CERTIFICATE_INVALID"):
        optimize_certificate(b"not an image", "image/png", profile="current")


# ── PDFs ─────────────────────────────────────────────────────────────────


def test_pdf_current_profile_shrinks_and_preserves_text_page_count_and_qr() -> None:
    original = _pdf_with_qr_and_text()
    current = optimize_certificate(original, "application/pdf", profile="current")

    assert len(current) < len(original)
    with pymupdf.open(stream=current, filetype="pdf") as doc:
        assert doc.page_count == 1
        assert "Vehicle certificate sample" in doc[0].get_text()
    assert _decode_qr(_render_first_page(current)) == "GSSG-CERT-PDF-0001"


def test_pdf_historical_profile_shrinks_current_output_further_and_preserves_content() -> None:
    original = _pdf_with_qr_and_text("GSSG-CERT-PDF-0002")
    current = optimize_certificate(original, "application/pdf", profile="current")
    historical = optimize_certificate(current, "application/pdf", profile="historical")

    assert len(historical) < len(current)
    with pymupdf.open(stream=historical, filetype="pdf") as doc:
        assert doc.page_count == 1
        assert "Vehicle certificate sample" in doc[0].get_text()
    assert _decode_qr(_render_first_page(historical)) == "GSSG-CERT-PDF-0002"


def test_pdf_preserves_rotation_and_vector_content_across_both_profiles() -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.set_rotation(90)
    page.draw_rect(pymupdf.Rect(50, 50, 200, 200), color=(0, 0, 0), fill=(0.8, 0.1, 0.1))
    page.insert_text((60, 300), "Rotated certificate page")
    original = doc.tobytes()
    doc.close()

    for profile in ("current", "historical"):
        candidate = optimize_certificate(original, "application/pdf", profile=profile)
        with pymupdf.open(stream=candidate, filetype="pdf") as reopened:
            assert reopened[0].rotation == 90
            assert "Rotated certificate page" in reopened[0].get_text()


def test_invalid_pdf_bytes_are_rejected() -> None:
    with pytest.raises(ValueError, match="VEHICLE_CERTIFICATE_INVALID"):
        optimize_certificate(b"%PDF-not-really", "application/pdf", profile="current")


def test_encrypted_pdf_is_byte_identical_under_both_profiles() -> None:
    doc = pymupdf.open()
    doc.new_page(width=595, height=842)
    buffer = io.BytesIO()
    # Empty user password + a set owner password: PyMuPDF auto-authenticates
    # on open, so a naive `needs_pass`/`is_encrypted` check alone would miss
    # this and destructively rewrite a protected file.
    doc.save(
        buffer,
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        owner_pw="owner-secret",
        user_pw="",
        permissions=int(pymupdf.PDF_PERM_ACCESSIBILITY | pymupdf.PDF_PERM_PRINT),
    )
    doc.close()
    encrypted = buffer.getvalue()

    for profile in ("current", "historical"):
        assert optimize_certificate(encrypted, "application/pdf", profile=profile) == encrypted


def test_signed_pdf_field_lacking_sigflags_is_byte_identical_under_both_profiles() -> None:
    doc = pymupdf.open()
    doc.new_page(width=595, height=842)
    # A bare /FT /Sig annotation with no AcroForm/SigFlags at all — the exact
    # under-inspected case `get_sigflags()` alone would miss.
    xref = doc.get_new_xref()
    doc.update_object(xref, "<< /Type /Annot /Subtype /Widget /FT /Sig /Rect [50 700 250 750] >>")
    doc.xref_set_key(doc[0].xref, "Annots", f"[{xref} 0 R]")
    signed = doc.tobytes()
    doc.close()

    with pymupdf.open(stream=signed, filetype="pdf") as check:
        assert check.get_sigflags() in (-1, 0)  # confirms the fixture has no SigFlags

    for profile in ("current", "historical"):
        assert optimize_certificate(signed, "application/pdf", profile=profile) == signed


def test_pdf_beyond_page_bound_is_returned_unchanged() -> None:
    doc = pymupdf.open()
    for _ in range(3):
        doc.new_page(width=200, height=200).insert_text((10, 10), "page")
    original = doc.tobytes()
    doc.close()

    import app.core.vehicle_certificates as certs_module

    previous = certs_module._PDF_MAX_PAGES
    certs_module._PDF_MAX_PAGES = 2
    try:
        result = optimize_certificate(original, "application/pdf", profile="current")
    finally:
        certs_module._PDF_MAX_PAGES = previous
    assert result == original
