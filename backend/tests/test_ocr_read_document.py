from __future__ import annotations

from pathlib import Path

import pytest

from app.core.extraction import ocr
from app.services.document_reader import DocumentRead, read_document

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "scan_triage"


def test_searchable_pdf_returns_literal_evidence_without_ocr(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject_ocr(*_args, **_kwargs):
        raise AssertionError("searchable PDF unexpectedly invoked Tesseract")

    monkeypatch.setattr(ocr, "extract_text", reject_ocr)
    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", reject_ocr)

    result = read_document((FIXTURE_DIR / "returned-form-text.pdf").read_bytes())

    assert result == DocumentRead(
        text="Synthetic returned form\nRef: GS-0042\n",
        text_source="pdf_text",
        qr_refs=(),
        ocr_pages=(),
        unavailable_reason=None,
    )
