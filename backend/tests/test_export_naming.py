from datetime import datetime

from app.core.export_naming import book_download_filename


def test_book_download_filename_basic():
    name = book_download_filename(
        ref="1/5/141", subject="التصاريح الأمنية", when=datetime(2026, 7, 20), ext=".pdf"
    )
    assert name.startswith("1-5-141")
    assert "2026-07-20" in name
    assert "التصاريح الأمنية" in name
    assert name.endswith(".pdf")


def test_book_download_filename_blank_subject():
    name = book_download_filename(ref="1/3/7", subject="", when=datetime(2026, 7, 20), ext=".docx")
    assert name.startswith("1-3-7")
    assert "2026-07-20" in name
    assert name.endswith(".docx")


def test_book_download_filename_injection_chars_stripped():
    name = book_download_filename(
        ref="1/5/1", subject='subject"with\r\nnewline', when=datetime(2026, 7, 20), ext=".pdf"
    )
    assert '"' not in name
    assert "\r" not in name
    assert "\n" not in name


def test_book_download_filename_long_subject_capped():
    name = book_download_filename(
        ref="1/1/1", subject="أ" * 200, when=datetime(2026, 7, 20), ext=".pdf"
    )
    assert len(name) <= 100
