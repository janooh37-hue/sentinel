"""Retokenize surgery: a finished General Book docx becomes a library
template with exactly three live tokens; all foreign Jinja is inert."""

from pathlib import Path

import pytest
from docx import Document

from app.core.book_template_retokenize import (
    retokenize_general_book,
    validate_book_template,
)
from app.core.book_text import docx_to_text
from app.core.docx_render import render

TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"


def _header_copies_of(doc) -> dict[str, list]:
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph

    header = doc.sections[0].first_page_header
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


def _header_copies(docx_path: Path) -> dict[str, list]:
    return _header_copies_of(Document(str(docx_path)))


def _header_text(docx_path: Path) -> str:
    return "\n".join(p.text for copy in _header_copies(docx_path).values() for p in copy)


def test_rendered_general_book_retokenizes_header_block_and_neutralizes_jinja(tmp_path):
    from app.core.docx_engine import DocxEngine
    from app.services.document_service import GENERAL_BOOK_BODY_SENTINEL

    finished = tmp_path / "finished.docx"
    DocxEngine(TEMPLATES_DIR).fill(
        "General Book",
        {
            "ref": "1/5/141",
            "date": "21-09-2026",
            "subject": "اختبار",
            "body": GENERAL_BOOK_BODY_SENTINEL,
            "body_html": "<p>نص الكتاب</p>",
            "recipient_name": "",
            "cc": "",
        },
        finished,
    )
    doc = Document(str(finished))
    office_line = next(
        p
        for p in _header_copies_of(doc)["Fallback"]
        if "مكتب ادارة الوثبة" in p.text
    )
    office_line.add_run(" {{ 7*7 }}")
    doc.save(str(finished))

    retokenize_general_book(finished)

    for paragraphs in _header_copies(finished).values():
        text = "\n".join(p.text for p in paragraphs)
        assert text.count("{{ ref }}") == 1
        assert text.count("{{ date }}") == 1
        assert text.count("{{ barcode }}") == 1
        assert text.count("{%p if ref %}") == 1
        assert text.count("{%p endif %}") == 1
    validate_book_template(finished)
    rendered = tmp_path / "rendered-header.docx"
    render(
        finished,
        {
            "ref": "9/9/9999",
            "date": "31-12-2099",
            "barcode": "9/9/9999+20991231",
            "recipient_name": "",
            "subject": "",
            "cc": "",
            "submitter_g": "",
        },
        rendered,
        sandboxed=True,
    )
    assert "49" not in _header_text(rendered)
    assert "7*7" in _header_text(rendered)


def _add_header_block(
    doc, *, ref_line: bool = True, spacing: str = "", ref: str = "1/5/140"
) -> None:
    header = doc.sections[0].first_page_header
    if ref_line:
        header.add_paragraph(f"الرقم:{spacing}{ref}")
    header.add_paragraph("التاريخ: 13-07-2026")
    if ref_line:
        header.add_paragraph(f"{ref}+20260713")


def _finished_book(tmp_path: Path, *, ref_line: bool = True, spacing: str = "") -> Path:
    """Minimal stand-in for a finished book: header metadata + body."""
    p = tmp_path / "book.docx"
    doc = Document()
    _add_header_block(doc, ref_line=ref_line, spacing=spacing)
    doc.add_paragraph("السيد / مدير الإدارة المحترم")
    doc.add_paragraph("الموضوع: التصاريح الأمنية بتاريخ 01/07/2026")
    doc.add_paragraph("نص الكتاب هنا")
    doc.save(str(p))
    return p


def _rendered_text(tpl: Path, tmp_path: Path, **data) -> str:
    out = tmp_path / "rendered.docx"
    render(tpl, data, out, sandboxed=True)
    return docx_to_text(out) + "\n" + _header_text(out)


def test_ref_and_date_retokenized(tmp_path):
    p = _finished_book(tmp_path)
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/999", date="31-12-2099")
    assert "الرقم: 9/9/999" in text
    assert "التاريخ: 31-12-2099" in text
    assert "140" not in text  # old baked ref gone


def test_legacy_spacing_handled(tmp_path):
    p = _finished_book(tmp_path, spacing=" ")
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/999", date="31-12-2099")
    assert "الرقم: 9/9/999" in text


def test_missing_header_block_is_rejected(tmp_path):
    p = _finished_book(tmp_path, ref_line=False)
    with pytest.raises(ValueError):
        retokenize_general_book(p)


def test_prose_date_untouched(tmp_path):
    """Only the labelled التاريخ line becomes a token — a date written inside
    the body prose is boilerplate and must survive verbatim."""
    p = tmp_path / "prose_date.docx"
    doc = Document()
    _add_header_block(doc)
    doc.add_paragraph("بالإشارة إلى تعميمنا الصادر بتاريخ 01/07/2026 نفيدكم بالآتي")
    doc.save(str(p))
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/999", date="31-12-2099")
    assert "بتاريخ 01/07/2026" in text


def test_foreign_jinja_neutralized(tmp_path):
    p = tmp_path / "book.docx"
    doc = Document()
    _add_header_block(doc)
    doc.add_paragraph("خصم {{ 7*7 }} بالمئة {% if x %}شرط{% endif %}")
    doc.save(str(p))
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/999", date="31-12-2099")
    assert "49" not in text  # never executed
    assert "7*7" in text  # visible text preserved
    assert "شرط" in text  # {% if %} inert, content kept literal


def test_split_delimiter_fails_closed(tmp_path):
    """Known ceiling: per-w:t neutralization misses a Jinja delimiter split
    across two runs (run1 ends '{', run2 starts '{') — docxtpl's patch_xml can
    reassemble it at render time. Save-time validation is the fail-closed
    backstop (verified experimentally in review): the template is either
    rejected or renders without executing. The invariant is "never executes",
    not a specific failure mode."""
    p = tmp_path / "book.docx"
    doc = Document()
    _add_header_block(doc)
    split = doc.add_paragraph()
    split.add_run("خصم {")
    split.add_run("{ 7*7 }} بالمئة")
    doc.save(str(p))
    retokenize_general_book(p)
    try:
        validate_book_template(p)
    except ValueError:
        pass  # rejected at save time — fail-closed holds
    else:
        text = _rendered_text(p, tmp_path, ref="9/9/999", date="31-12-2099")
        assert "49" not in text  # survived validation, but never executed


def test_ref_run_marked_rtl(tmp_path):
    """The {{ ref }} run carries <w:rtl/> — the EXACT encoding of the
    hand-typed legacy books (verified by XML dump: their digit runs are
    RTL-marked). Word then orders the segments right-to-left so the bumping
    serial reads LAST. Both no-mark and a forced <w:rtl w:val="0"/> made
    Word lay the value as one LTR unit with the serial landing right next
    to الرقم: (operator-reported twice)."""
    p = _finished_book(tmp_path)
    retokenize_general_book(p)
    doc = Document(str(p))
    ref_para = next(pp for pp in _header_copies_of(doc)["Fallback"] if "{{ ref }}" in pp.text)
    run = next(r for r in ref_para.runs if "{{ ref }}" in r.text)
    assert run.font.rtl is True


def test_date_token_run_not_forced_ltr(tmp_path):
    p = _finished_book(tmp_path)
    retokenize_general_book(p)
    doc = Document(str(p))
    date_para = next(pp for pp in _header_copies_of(doc)["Fallback"] if "{{ date }}" in pp.text)
    token_run = next(r for r in date_para.runs if "{{ date }}" in r.text)
    assert token_run.font.rtl is None


def test_footer_g_token_is_not_inserted(tmp_path):
    p = _finished_book(tmp_path)
    retokenize_general_book(p)
    doc = Document(str(p))
    footer_text = "\n".join(para.text for s in doc.sections for para in s.footer.paragraphs)
    assert "{{ submitter_g }}" not in footer_text


def test_validate_accepts_good_template(tmp_path):
    p = _finished_book(tmp_path)
    retokenize_general_book(p)
    validate_book_template(p)  # no raise


def test_validate_rejects_unretokenized_doc(tmp_path):
    p = _finished_book(tmp_path)
    with pytest.raises(ValueError):
        validate_book_template(p)  # no tokens → dummy values never render




def test_ref_font_matches_date_font_on_existing_ref_line(tmp_path):
    from docx import Document
    from docx.shared import Pt

    p = tmp_path / "font_book.docx"
    doc = Document()
    header = doc.sections[0].first_page_header
    ref_p = header.add_paragraph()
    rr = ref_p.add_run("الرقم: 1/5/140")
    rr.font.size = Pt(16)
    date_p = header.add_paragraph()
    rd = date_p.add_run("التاريخ: 13-07-2026")
    rd.font.size = Pt(12)
    header.add_paragraph("1/5/140+20260713")
    doc.add_paragraph("نص الكتاب هنا")
    doc.save(str(p))
    retokenize_general_book(p)
    doc2 = Document(str(p))
    ref_para = next(
        pp for pp in _header_copies_of(doc2)["Fallback"] if "{{ ref }}" in pp.text
    )
    ref_run = next(r for r in ref_para.runs if "{{ ref }}" in r.text)
    assert ref_run.font.size == Pt(12)


# ---------------------------------------------------------------------------
# Table-aware validation tests (M4-4)
# ---------------------------------------------------------------------------


def _table_template(tmp_path: Path, n_cols: int = 2) -> Path:
    from docx import Document

    p = tmp_path / f"tbl_tpl_{n_cols}.docx"
    doc = Document()
    _add_header_block(doc, ref="1/5/141")
    doc.add_paragraph("الموضوع: موضوع الكتاب الاختباري في النظام المحترم")
    headers = [f"عمود {i}" for i in range(n_cols)]
    t = doc.add_table(rows=2, cols=n_cols)
    for i, h in enumerate(headers):
        t.cell(0, i).text = h
    for i in range(n_cols):
        t.cell(1, i).text = f"بيانات {i}"
    doc.save(str(p))
    retokenize_general_book(p)
    return p


def test_validate_table_template_passes(tmp_path):
    validate_book_template(_table_template(tmp_path, n_cols=3))  # must not raise


def test_validate_body_preservation_excludes_table_content(tmp_path):
    from docx import Document

    p = tmp_path / "long_header.docx"
    doc = Document()
    _add_header_block(doc, ref="1/5/141")
    doc.add_paragraph("الموضوع: كتاب مع جدول بيانات مفصّلة للاختبار")
    t = doc.add_table(rows=2, cols=1)
    t.cell(0, 0).text = "بيانات الموظف المفصّلة جداً"  # >=15 chars header cell
    t.cell(1, 0).text = "قيمة بيانات مؤقتة للاختبار"
    doc.save(str(p))
    retokenize_general_book(p)
    validate_book_template(p)  # must not raise despite long header cell text


def test_validate_no_double_expand_cell_value(tmp_path):
    # Handled internally: validate injects a dummy cell value "{{ ref }}" and asserts
    # it renders literally. If double-expansion occurred, validate would raise.
    validate_book_template(_table_template(tmp_path, n_cols=1))


# ---------------------------------------------------------------------------
# Recipient / subject / CC must not freeze into the template
# ---------------------------------------------------------------------------


def _book_with_addressee(tmp_path: Path) -> Path:
    """A finished book as the General Book paper renders it: the addressee,
    subject and CC lines already carry the previous book's literal values."""
    p = tmp_path / "addressee.docx"
    doc = Document()
    _add_header_block(doc, ref="1/11/167")
    doc.add_paragraph("السيد \\ مدير العمليات الداخلية المحترم ")
    doc.add_paragraph("الموضوع: أعمال الصيانة في اجهزة التفتيش")
    doc.add_paragraph("نص الكتاب القديم هنا لأغراض الاختبار")
    doc.add_paragraph("• نسخة إلى: مدير فرع الأمن والحراسة")
    doc.save(str(p))
    return p


def test_addressee_subject_cc_become_tokens(tmp_path):
    p = _book_with_addressee(tmp_path)
    retokenize_general_book(p)
    validate_book_template(p)  # must not raise

    text = _rendered_text(
        p,
        tmp_path,
        ref="9/9/999",
        date="31-12-2099",
        recipient_name="مدير الموارد البشرية",
        subject="موضوع جديد",
        cc="إدارة الأفراد",
    )
    # the new book's values land on the paper …
    assert r"السيد \ مدير الموارد البشرية المحترم" in text
    assert "الموضوع: موضوع جديد" in text
    assert "نسخة إلى: إدارة الأفراد" in text
    # … and the source book's values are gone
    assert "مدير العمليات الداخلية" not in text
    assert "أعمال الصيانة" not in text
    assert "مدير فرع الأمن والحراسة" not in text


def test_empty_subject_and_cc_hide_their_labels(tmp_path):
    p = _book_with_addressee(tmp_path)
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/999", date="31-12-2099", subject="", cc="")
    assert "الموضوع" not in text
    assert "نسخة إلى" not in text


def test_empty_recipient_hides_the_addressee_line(tmp_path):
    """The recipient picker is optional, so an unpicked recipient must hide the
    whole line — not print a bare «السيد \\ المحترم» with a hole in the middle."""
    p = _book_with_addressee(tmp_path)
    retokenize_general_book(p)
    text = _rendered_text(p, tmp_path, ref="9/9/999", date="31-12-2099", recipient_name="")
    assert "السيد" not in text
    assert "المحترم" not in text


def test_addressee_retokenize_idempotent(tmp_path):
    p = _book_with_addressee(tmp_path)
    retokenize_general_book(p)
    t1 = docx_to_text(p)
    retokenize_general_book(p)
    assert docx_to_text(p) == t1
