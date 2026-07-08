import pytest

from app.core.extraction import passport_scan as ps
from app.core.extraction.ocr import OcrUnavailableError


class _FakeImg:
    """Stand-in for a PIL image; identity is all the tests need."""

    def __init__(self, tag: str) -> None:
        self.tag = tag


def test_pages_from_bytes_pdf_rasterises_and_caps(monkeypatch):
    monkeypatch.setattr(
        ps, "pdf_to_images", lambda raw, *, dpi: [_FakeImg(f"p{i}") for i in range(12)]
    )
    pages = ps.pages_from_bytes(b"%PDF-1.7 ...")
    assert len(pages) == ps.MAX_PAGES  # 12 pages capped to 8


def test_pages_from_bytes_image_returns_single(monkeypatch):
    sentinel = _FakeImg("img")
    monkeypatch.setattr(ps, "load_image", lambda raw: sentinel)
    pages = ps.pages_from_bytes(b"\xff\xd8\xff jpeg bytes")
    assert pages == [sentinel]


def test_ocr_mrz_pass_raises_when_tesseract_missing(monkeypatch):
    monkeypatch.setattr(ps, "_resolve_tesseract_cmd", lambda: None)
    with pytest.raises(OcrUnavailableError):
        ps.ocr_mrz_pass(_FakeImg("x"))
