from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from app.core import pdf_merge


def _pdf(path: Path, labels: list[str]) -> Path:
    doc = fitz.open()
    try:
        for label in labels:
            page = doc.new_page(width=300, height=400)
            page.insert_text((40, 80), label)
        doc.save(path)
    finally:
        doc.close()
    return path


def _png(path: Path) -> Path:
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 30), 0)
    try:
        pix.clear_with(0x4A90E2)
        pix.save(path)
    finally:
        pix = None
    return path


def _page_texts(data: bytes) -> list[str]:
    with fitz.open("pdf", data) as doc:
        return [page.get_text().strip() for page in doc]


def test_build_pdf_package_keeps_fixed_base_first_and_source_order(tmp_path: Path) -> None:
    base = _pdf(tmp_path / "base.pdf", ["FORM-1", "FORM-2"])
    first = _pdf(tmp_path / "first.pdf", ["FIRST-1", "FIRST-2", "FIRST-3"])
    image = _png(tmp_path / "last.png")
    result = pdf_merge.build_pdf_package(
        base,
        [(first, "First paper.pdf"), (image, "Last image.png")],
    )

    assert result.fixed_page_count == 2
    assert result.item_page_counts == (3, 1)
    assert result.total_page_count == 6
    assert _page_texts(result.pdf_bytes)[:5] == [
        "FORM-1",
        "FORM-2",
        "FIRST-1",
        "FIRST-2",
        "FIRST-3",
    ]
    assert base.read_bytes() != result.pdf_bytes
    assert _page_texts(base.read_bytes()) == ["FORM-1", "FORM-2"]


def test_build_pdf_package_rejects_missing_requested_source(tmp_path: Path) -> None:
    base = _pdf(tmp_path / "base.pdf", ["FORM"])
    with pytest.raises(FileNotFoundError, match=r"Missing paper\.pdf"):
        pdf_merge.build_pdf_package(base, [(tmp_path / "gone.pdf", "Missing paper.pdf")])


def test_build_pdf_package_identifies_corrupt_source(tmp_path: Path) -> None:
    base = _pdf(tmp_path / "base.pdf", ["FORM"])
    corrupt = tmp_path / "bad.pdf"
    corrupt.write_bytes(b"not a pdf")
    with pytest.raises(ValueError) as error:
        pdf_merge.build_pdf_package(base, [(corrupt, "Unreadable certificate.pdf")])

    assert error.value.filename == "Unreadable certificate.pdf"
