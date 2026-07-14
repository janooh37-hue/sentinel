# backend/tests/test_announce_book_pdf.py
"""TDD: announce_service.resolve_book_pdf returns (filename, bytes) for a book's
served PDF, and raises BookPdfError when the book / document / PDF is missing.
"""

from __future__ import annotations

import pytest

from app.services import announce_service


def test_resolve_book_pdf_missing_raises(db_session):
    """A non-existent book_id must raise BookPdfError."""
    with pytest.raises(announce_service.BookPdfError):
        announce_service.resolve_book_pdf(db_session, 999999)
