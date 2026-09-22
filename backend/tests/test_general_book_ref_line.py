"""The canonical General Book template renders an Arabic ref line above the
date when ``ref`` is provided, and omits it (three guard paragraphs collapse)
when it is not. Asserts the ARABIC string per the i18n lesson."""

from pathlib import Path

from app.core.docx_engine import DocxEngine, aztec_corner_for
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

def _header_copies(docx_path):
    from docx import Document
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph

    header = Document(str(docx_path)).sections[0].first_page_header
    copies = {"Choice": [], "Fallback": []}
    for element in header.part.element.findall(".//" + qn("w:p")):
        if not any(t.text for t in element.findall("./" + qn("w:r") + "/" + qn("w:t"))):
            continue
        ancestor = element.getparent()
        branch = "Fallback"
        while ancestor is not None:
            local_name = ancestor.tag.rsplit("}", 1)[-1]
            if local_name in copies:
                branch = local_name
                break
            ancestor = ancestor.getparent()
        copies[branch].append(Paragraph(element, header))
    return copies


def _header_text(docx_path) -> str:
    return "\n".join(p.text for copy in _header_copies(docx_path).values() for p in copy)


def test_ref_line_and_barcode_render_in_both_header_copies(tmp_path):
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill(
        "General Book", {**_BASE_DATA, "ref": "1/5/141", "date": "21-09-2026"}, out
    )
    for paragraphs in _header_copies(out).values():
        text = "\n".join(p.text for p in paragraphs)
        assert "الرقم: 1/5/141" in text
        assert "التاريخ: 21-09-2026" in text
        assert "1/5/141+20260921" in text
        assert text.index("الرقم:") < text.index("التاريخ:")


def test_ref_line_absent_without_ref(tmp_path):
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", dict(_BASE_DATA), out)
    text = _header_text(out)
    assert "الرقم" not in text
    assert "+20" not in text


def test_ref_run_marked_ltr_in_both_header_copies(tmp_path):
    """The dynamic reference stays in stored order in an explicit LTR run."""
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/5/141"}, out)
    for paragraphs in _header_copies(out).values():
        ref_para = next(p for p in paragraphs if "1/5/141" in p.text)
        ref_runs = [r for r in ref_para.runs if r.text.startswith("1/")]
        assert ref_runs, "ref value must be in its own run"
        assert all(r.font.rtl is False for r in ref_runs)




def test_ref_renders_ltr_segment_order_directly_after_label(tmp_path):
    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/15/141"}, out)
    for paragraphs in _header_copies(out).values():
        ref_para = next(p for p in paragraphs if "1/15/141" in p.text)
        non_empty = [r for r in ref_para.runs if r.text.strip()]
        label_idx = next(i for i, r in enumerate(non_empty) if "الرقم" in r.text)
        value_idx = next(i for i, r in enumerate(non_empty) if "1/15/141" in r.text)
        assert value_idx == label_idx + 1
        value_run = non_empty[value_idx]
        assert value_run.text == "1/15/141"
        assert value_run.font.rtl is False


def test_ref_line_preserves_canonical_template_size_with_rtl_label(tmp_path):
    from docx.oxml.ns import qn

    out = tmp_path / "formatted.docx"
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**_BASE_DATA, "ref": "1/5/142"}, out)
    for paragraphs in _header_copies(out).values():
        paragraph = next(p for p in paragraphs if "1/5/142" in p.text)
        date_paragraph = next(p for p in paragraphs if "التاريخ:" in p.text)
        runs = [r for r in paragraph.runs if r.text]
        date_size = next(r.font.size for r in date_paragraph.runs if r.text)

        assert [r.text for r in runs] == ["الرقم: ", "1/5/142"]
        assert paragraph._p.pPr.find(qn("w:bidi")) is not None
        assert runs[0].font.rtl is True
        assert runs[1].font.rtl is False
        assert date_size is not None and date_size.pt == 10
        assert all(r.font.size == date_size for r in runs)
        assert all(not r.font.italic for r in runs)

def test_library_template_preserves_header_ref_run_format(tmp_path):
    from docx import Document
    from docx.shared import Pt

    template = tmp_path / "library.docx"
    doc = Document()
    header = doc.sections[0].first_page_header
    paragraph = header.add_paragraph()
    template_run = paragraph.add_run("الرقم: {{ ref }}")
    template_run.font.name = "Arial"
    template_run.font.size = Pt(9)
    template_run.font.bold = True
    doc.add_paragraph(GENERAL_BOOK_BODY_SENTINEL)
    doc.save(template)

    out = tmp_path / "out.docx"
    DocxEngine(TEMPLATES_DIR).fill_general_book_path(
        template, {**_BASE_DATA, "ref": "1/5/142"}, out
    )
    paragraph = next(p for p in _header_copies(out)["Fallback"] if "1/5/142" in p.text)
    runs = [r for r in paragraph.runs if r.text]

    assert [r.text for r in runs] == ["الرقم: ", "1/5/142"]
    assert runs[1].font.rtl is False
    assert all(r.font.name == "Arial" and r.font.size.pt == 9 and r.font.bold for r in runs)


def test_word_template_keeps_intro_without_large_blank_gap(tmp_path):
    from docx import Document

    out = tmp_path / "word-book.docx"
    data = {**_BASE_DATA, "body_html": ""}
    DocxEngine(TEMPLATES_DIR).fill("General Book", {**data, "ref": "1/5/142"}, out)
    paragraphs = [p.text.strip() for p in Document(out).paragraphs]

    subject_idx = next(i for i, text in enumerate(paragraphs) if text.startswith("الموضوع:"))
    intro_idx = paragraphs.index(
        "يطيب لنا أن نتقدم لكم بأطيب التحيات والتقدير، "
        "ننوه على الموضوع أعلاه انه"
    )
    closing_idx = paragraphs.index("للتفضل بالعلم وإجراءاتكم")

    assert intro_idx - subject_idx <= 2
    assert closing_idx - intro_idx <= 2


def test_word_book_has_header_ref_barcode_and_no_header_stamp(
    db_session, admin_user, tmp_path, monkeypatch
):
    import shutil

    from app.config import Settings
    from app.services import artifact_service, word_book_service

    templates = tmp_path / "templates"
    templates.mkdir()
    shutil.copy2(
        TEMPLATES_DIR / "GSSG-GS_300-003_General_Book.docx",
        templates / "GSSG-GS_300-003_General_Book.docx",
    )
    settings = Settings(data_dir=tmp_path / "data", templates_dir=templates)
    monkeypatch.setattr(word_book_service, "get_settings", lambda: settings)
    monkeypatch.setattr(artifact_service, "get_settings", lambda: settings)
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
    text = _header_text(session.working_path)
    assert f"الرقم: {info.ref_number}" in text
    assert f"{info.ref_number}+" in text
    assert "Ref:" not in text

def test_general_book_does_not_render_submitter_g_number(tmp_path):
    from docx import Document
    from docx.oxml.ns import qn

    template = tmp_path / "footer-token.docx"
    source = Document()
    source.sections[0].footer.add_paragraph("{{ submitter_g }}")
    source.add_paragraph(GENERAL_BOOK_BODY_SENTINEL)
    source.save(template)
    out = tmp_path / "no-submitter-footer.docx"
    DocxEngine(TEMPLATES_DIR).fill_general_book_path(template, _BASE_DATA, out)
    footer = Document(str(out)).sections[0].footer
    footer_text = "\n".join(node.text or "" for node in footer.part.element.iter(qn("w:t")))
    assert "G-1234" not in footer_text



def test_general_book_is_the_only_top_right_form_without_aztec() -> None:
    assert aztec_corner_for("General Book") is None
    assert aztec_corner_for("Security Permit") == "top-right"
