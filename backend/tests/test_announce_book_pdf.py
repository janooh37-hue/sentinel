# backend/tests/test_announce_book_pdf.py
"""TDD: announce_service.resolve_book_pdf returns (filename, bytes) for a book's
served PDF, and raises BookPdfError when the book / document / PDF is missing.
"""

from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from app.config import get_settings
from app.db.models import Book, BookCategory, BookVersion, Document
from app.services import announce_service


def test_resolve_book_pdf_missing_raises(db_session):
    """A non-existent book_id must raise BookPdfError."""
    with pytest.raises(announce_service.BookPdfError):
        announce_service.resolve_book_pdf(db_session, 999999)


def _pdf(path: Path, pages: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    document = fitz.open()
    try:
        for _ in range(pages):
            document.new_page()
        document.save(path)
    finally:
        document.close()
    return path


def test_resolve_managed_package_does_not_duplicate_companion(
    db_session, tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    packaged = _pdf(tmp_path / "package.pdf", 3)
    base = _pdf(tmp_path / "base.pdf", 3)
    companion = _pdf(tmp_path / "companion.pdf", 1)
    db_session.add(BookCategory(id="HR", prefix="HR"))
    book = Book(category_id="HR", ref_number="HR-1", approval_state="none")
    db_session.add(book)
    db_session.flush()
    primary = Document(
        template_id="General Book",
        ref_number=book.ref_number,
        docx_path="primary.docx",
        pdf_path=packaged.relative_to(tmp_path).as_posix(),
        base_pdf_path=base.relative_to(tmp_path).as_posix(),
        submission_id="managed-package",
        role="primary",
    )
    db_session.add(primary)
    db_session.flush()
    db_session.add_all(
        [
            Document(
                template_id="Leave Undertaking",
                ref_number=book.ref_number,
                docx_path="companion.docx",
                pdf_path=companion.relative_to(tmp_path).as_posix(),
                submission_id=primary.submission_id,
                role="companion",
            ),
            BookVersion(
                book_id=book.id,
                version_no=1,
                status="none",
                document_id=primary.id,
            ),
        ]
    )
    db_session.commit()

    _filename, pdf_bytes = announce_service.resolve_book_pdf(db_session, book.id)

    with fitz.open("pdf", pdf_bytes) as result:
        assert result.page_count == 3
    get_settings.cache_clear()
