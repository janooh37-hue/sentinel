"""Sandboxed Jinja for untrusted library templates: attribute-walk payloads
must raise SecurityError instead of executing."""

from pathlib import Path

import pytest
from docx import Document
from jinja2.exceptions import SecurityError

from app.core.book_text import docx_to_text
from app.core.docx_engine import DocxEngine
from app.core.docx_render import render

TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"


def _make_docx(tmp_path: Path, text: str) -> Path:
    p = tmp_path / "tpl.docx"
    doc = Document()
    doc.add_paragraph(text)
    doc.save(str(p))
    return p


def test_sandbox_blocks_attribute_walk(tmp_path):
    tpl = _make_docx(tmp_path, "{{ ''.__class__.__mro__ }}")
    with pytest.raises(SecurityError):
        render(tpl, {}, tmp_path / "out.docx", sandboxed=True, strict=False)


def test_sandbox_renders_normal_tokens(tmp_path):
    tpl = _make_docx(tmp_path, "الرقم: {{ ref }}")
    out = render(tpl, {"ref": "1/5/GSSG/9"}, tmp_path / "out.docx", sandboxed=True)
    assert "الرقم: 1/5/GSSG/9" in docx_to_text(out)


def test_fill_general_book_path_uses_adapter(tmp_path):
    """fill_general_book_path routes through _adapt_general_book — the date
    token resolves even when data has no 'date' key."""
    tpl = _make_docx(tmp_path, "التاريخ: {{ date }}")
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill_general_book_path(tpl, {"body_html": ""}, out, sandboxed=True)
    text = docx_to_text(out)
    assert "التاريخ: " in text
    assert "{{ date }}" not in text
