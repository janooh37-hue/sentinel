"""Tests for M2-2: General Book download filename + Content-Disposition hardening."""

import inspect

from app.api.v1 import documents as docs_module


def test_companion_merge_uses_inline_pdf_response():
    src = inspect.getsource(docs_module.download_document)
    assert 'inline; filename="' not in src, "raw Content-Disposition f-string must be gone"


def test_inline_pdf_response_strips_crlf():
    from app.api.v1.documents import _inline_pdf_response

    resp = _inline_pdf_response(b"%PDF-1.4", "name\r\nX-Injected: value.pdf")
    d = resp.headers["Content-Disposition"]
    assert "\r" not in d and "\n" not in d and "filename*=UTF-8''" in d
