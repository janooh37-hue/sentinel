from __future__ import annotations

import io
from typing import Any

import pymupdf
import pytest
from PIL import Image

from app.core.extraction import ocr
from app.core.extraction.ocr import OcrPage, OcrWord, word_boxes_from_bytes


def _png(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, format="PNG")
    return buffer.getvalue()


def _pdf(pages: int) -> bytes:
    doc = pymupdf.open()
    for _ in range(pages):
        doc.new_page(width=200, height=100)
    try:
        return doc.tobytes()
    finally:
        doc.close()


_DATA: dict[str, list[Any]] = {
    "text": ["", "Gloves", "  ", "12", "noise"],
    "conf": ["-1", "96.5", "95", 88, "-1"],
    "left": [0, 10, 0, 300, 5],
    "top": [0, 20, 0, 22, 5],
    "width": [2000, 80, 0, 30, 4],
    "height": [900, 18, 0, 18, 4],
    "block_num": [0, 1, 1, 1, 2],
    "par_num": [0, 1, 1, 1, 1],
    "line_num": [0, 1, 1, 1, 1],
}


@pytest.fixture
def tesseract(monkeypatch: pytest.MonkeyPatch) -> list[tuple[tuple[int, int], dict[str, Any]]]:
    import pytesseract

    calls: list[tuple[tuple[int, int], dict[str, Any]]] = []

    def image_to_data(image: Image.Image, **kwargs: Any) -> dict[str, list[Any]]:
        calls.append((image.size, kwargs))
        return _DATA

    monkeypatch.setattr(pytesseract.pytesseract, "tesseract_cmd", "tesseract")
    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", lambda: "synthetic-tesseract")
    monkeypatch.setattr(pytesseract, "image_to_data", image_to_data)
    return calls


def test_image_words_keep_boxes_and_drop_blank_or_layout_rows(tesseract) -> None:
    pages = word_boxes_from_bytes(_png(2000, 900))

    assert pages == [
        OcrPage(
            width=2000,
            height=900,
            words=(
                OcrWord("Gloves", 96.5, 10, 20, 80, 18, block=1, paragraph=1, line=1),
                OcrWord("12", 88.0, 300, 22, 30, 18, block=1, paragraph=1, line=1),
            ),
        )
    ]
    assert tesseract[0][1]["lang"] == "eng"


def test_small_image_reports_the_upscaled_raster_its_boxes_refer_to(tesseract) -> None:
    (page,) = word_boxes_from_bytes(_png(800, 400))

    assert (page.width, page.height) == (1600, 800)
    assert tesseract[0][0] == (1600, 800)


def test_pdf_returns_one_page_per_rasterised_page(tesseract) -> None:
    pages = word_boxes_from_bytes(_pdf(2), lang="ara+eng")

    assert len(pages) == 2
    assert all(len(page.words) == 2 for page in pages)
    assert [call[1]["lang"] for call in tesseract] == ["ara+eng", "ara+eng"]


def test_missing_tesseract_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", lambda: None)

    with pytest.raises(ocr.OcrUnavailableError):
        word_boxes_from_bytes(_png(2000, 900))


def test_unreadable_upload_is_invalid_image() -> None:
    with pytest.raises(ocr.InvalidImageError):
        word_boxes_from_bytes(b"not an image")


def test_timeout_is_passed_to_tesseract_and_a_timeout_is_raised_as_ocr_timeout(
    tesseract, monkeypatch: pytest.MonkeyPatch
) -> None:
    word_boxes_from_bytes(_png(2000, 900), timeout=30)
    assert tesseract[0][1]["timeout"] == 30
    import pytesseract

    def timed_out(image: Image.Image, **kwargs: Any) -> dict[str, list[Any]]:
        raise RuntimeError("Tesseract process timeout")

    monkeypatch.setattr(pytesseract, "image_to_data", timed_out)
    with pytest.raises(ocr.OcrTimeoutError):
        word_boxes_from_bytes(_png(2000, 900), timeout=30)


def test_default_has_no_tesseract_timeout(tesseract) -> None:
    word_boxes_from_bytes(_png(2000, 900))
    assert tesseract[0][1].get("timeout", 0) == 0
