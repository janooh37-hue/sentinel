# backend/tests/test_report_render.py
import re
import zipfile
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

from app.core.docx_engine import DocxEngine, _postprocess_general_book_footer
from app.services.document_service import GENERAL_BOOK_BODY_SENTINEL

TEMPLATE = Path("backend/templates/GSSG-GS_300-004_Report.docx")

ADVERSARIAL_BODY = """
<h2 style="color:#1F4E79;">أولاً: ملخص / Summary</h2>
<p>نص عربي مع English mid-sentence لاختبار الـ bidi. </p>
<ol><li>البند الأول</li><li>البند الثاني</li></ol>
<table><thead><tr><th>الرقم</th><th>الوصف</th></tr></thead>
<tbody><tr><td>1</td><td>الليوان A3</td></tr></tbody></table>
<div class="mce-pagebreak"></div>
<p style="text-align:center;">— نهاية / End —</p>
"""

DATA = {
    "date": "23-07-2026",
    "subject": "اختبار",
    "recipient_name": "مدير المركز",
    "body": GENERAL_BOOK_BODY_SENTINEL,
    "body_html": "",
    "manager_name": "مهند أل علي",
    "manager_title": "مسؤول وحدة الإرساليات",
    "cc": "",
    "submitter_g": "G-2001",
}


def _all_text(part) -> str:
    """Every w:t in a story, text boxes and table cells included."""
    return "".join(t.text or "" for t in part._element.iter(qn("w:t")))


def _fill(tmp_path, **overrides) -> Path:
    out = tmp_path / "report.docx"
    DocxEngine(TEMPLATE.parent).fill("Report", {**DATA, **overrides}, out)
    return out


def test_word_flow_render_fills_every_field(tmp_path):
    """The Word-authoring create path (empty body_html) leaves no token behind."""
    doc = Document(str(_fill(tmp_path)))
    section = doc.sections[0]
    body = "\n".join(p.text for p in doc.paragraphs)
    everything = body + _all_text(section.first_page_header) + _all_text(section.first_page_footer)
    assert "{{" not in everything and "{%" not in everything
    assert GENERAL_BOOK_BODY_SENTINEL not in body
    assert "الرقم" not in everything  # no-ref paper
    assert "23/07/2026" in _all_text(section.first_page_header)
    for value in ("مدير المركز", "اختبار", "مهند أل علي", "مسؤول وحدة الإرساليات"):
        assert value in body
    assert "G-2001" in _all_text(section.first_page_footer)


def test_word_flow_keeps_the_opening_line(tmp_path):
    """Clearing the empty body sentinel must not wipe template text sharing its paragraph."""
    doc = Document(str(_fill(tmp_path)))
    opening = next(p for p in doc.paragraphs if "يطيب لنا" in p.text)
    assert GENERAL_BOOK_BODY_SENTINEL not in opening.text


def test_signature_label_keeps_a_slot_below_it():
    """Finish floats the signature (and the date under it) on the paragraph
    after «التوقيع:»; without it they land on the label itself."""
    paras = Document(str(TEMPLATE)).paragraphs
    i_sig = next(i for i, p in enumerate(paras) if "manager_sig" in p.text)
    assert i_sig + 1 < len(paras)
    assert not paras[i_sig + 1].text.strip()


def test_footer_sync_carries_footer_relationships(tmp_path):
    """Pages 2+ reuse the page-1 footer; its images/links must resolve there too."""
    out = _fill(tmp_path)
    _postprocess_general_book_footer(out)
    with zipfile.ZipFile(out) as z:
        footer2 = z.read("word/footer2.xml").decode()
        rels = z.read("word/_rels/footer2.xml.rels").decode()
    used = set(re.findall(r'r:(?:embed|id|link)="(\w+)"', footer2))
    defined = set(re.findall(r'Id="(\w+)"', rels))
    assert used
    assert used <= defined


def test_report_render_html_body_end_to_end(tmp_path):
    doc = Document(str(_fill(tmp_path, body_html=ADVERSARIAL_BODY)))
    text = "\n".join(p.text for p in doc.paragraphs)
    assert GENERAL_BOOK_BODY_SENTINEL not in text
    assert "نهاية" in text
    assert any("الوصف" in c.text for t in doc.tables for r in t.rows for c in r.cells)
