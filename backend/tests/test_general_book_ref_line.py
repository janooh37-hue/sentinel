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


def test_ref_run_not_forced_ltr(tmp_path):
    """The {{ ref }} run must NOT force LTR: the office convention (matching
    the hand-typed legacy books) is natural bidi flow in the RTL paragraph,
    which places the bumping serial visually LAST on the line. An explicit
    <w:rtl w:val="0"/> renders the serial right next to الرقم: (operator-
    reported defect)."""
    from docx import Document

    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/5/GSSG/141"}, out)
    doc = Document(str(out))
    ref_para = next(p for p in doc.paragraphs if "1/5/GSSG/141" in p.text)
    ref_runs = [r for r in ref_para.runs if "GSSG" in r.text]
    assert ref_runs, "ref value must be in its own run"
    assert all(r.font.rtl is None for r in ref_runs)


def _header_text(docx_path) -> str:
    from docx import Document

    doc = Document(str(docx_path))
    parts = []
    for section in doc.sections:
        for hdr in (section.header, section.first_page_header):
            parts.extend(p.text for p in hdr.paragraphs)
    return "\n".join(parts)


def test_word_book_has_ref_line_and_no_header_stamp(db_session, admin_user):
    """Word-path create: body الرقم line present, English Ref: stamp gone."""
    from app.services import word_book_service

    info = word_book_service.create_word_book(
        db_session,
        user=admin_user,
        classification_code="5/1",
        recipient_id=None,
        subject="اختبار القالب",
        cc=[],
        manager_id=None,
    )
    from app.db.models import BookEditSession

    session = db_session.query(BookEditSession).filter_by(book_id=info.book_id).one()
    text = docx_to_text(Path(session.working_path))
    assert f"الرقم: {info.ref_number}" in text
    assert "Ref:" not in _header_text(session.working_path)
