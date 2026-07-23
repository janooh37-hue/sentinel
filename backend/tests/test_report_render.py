# backend/tests/test_report_render.py
from pathlib import Path

from docx import Document

TEMPLATE = Path("backend/templates/GSSG-GS_300-004_Report.docx")


def test_report_template_tokens_and_no_ref():
    assert TEMPLATE.exists(), "run scripts/build_report_template.py first"
    doc = Document(str(TEMPLATE))
    text = "\n".join(p.text for p in doc.paragraphs)
    # ref line is gone entirely
    assert "{{ ref }}" not in text
    assert "الرقم" not in text
    # body + author tokens present, author labelled and ordered name→title→sig
    assert "{{ body }}" in text
    assert "{{ date }}" in text
    assert "{{ recipient_name }}" in text
    assert "الموضوع" in text
    assert "الاسم: {{ manager_name }}" in text
    assert "المسمى الوظيفي: {{ manager_title }}" in text
    assert "التوقيع: {{ manager_sig }}" in text
    # closing formula present
    assert "وتفضلوا بقبول فائق الاحترام والتقدير" in text
    # name paragraph appears before the signature paragraph
    names = [p.text for p in doc.paragraphs]
    assert names.index("الاسم: {{ manager_name }}") < names.index("التوقيع: {{ manager_sig }}")
