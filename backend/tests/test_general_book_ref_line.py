"""The canonical General Book template renders an Arabic ref line above the
date when ``ref`` is provided, and omits it (three guard paragraphs collapse)
when it is not. Asserts the ARABIC string per the i18n lesson."""

from pathlib import Path

from app.core.book_text import docx_to_text
from app.core.docx_engine import DocxEngine
from app.services.document_service import GENERAL_BOOK_BODY_SENTINEL

TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"

_BASE_DATA = {
    "subject": "اختبار",
    "body": GENERAL_BOOK_BODY_SENTINEL,
    "body_html": "<p>نص تجريبي</p>",
    "recipient_name": "السيد المدير",
    "cc": [],
    "submitter_g": "G-1234",
}


def test_ref_line_renders_above_date(tmp_path):
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/5/GSSG/141"}, out)
    text = docx_to_text(out)
    assert "الرقم: 1/5/GSSG/141" in text
    # above the date: الرقم line appears before التاريخ in document order
    assert text.index("الرقم:") < text.index("التاريخ:")


def test_ref_line_absent_without_ref(tmp_path):
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", dict(_BASE_DATA), out)
    text = docx_to_text(out)
    assert "الرقم" not in text  # preview/serial-free renders show no ref line


def test_ref_run_is_explicit_ltr(tmp_path):
    """The {{ ref }} value run must carry <w:rtl w:val="0"/> or Word's bidi
    algorithm reorders 1/5/GSSG/141 inside the RTL paragraph."""
    from docx import Document

    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/5/GSSG/141"}, out)
    doc = Document(str(out))
    ref_para = next(p for p in doc.paragraphs if "1/5/GSSG/141" in p.text)
    ref_runs = [r for r in ref_para.runs if "GSSG" in r.text]
    assert ref_runs, "ref value must be in its own run"
    assert all(r.font.rtl is False for r in ref_runs)
