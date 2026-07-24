"""Layout contract for the generated Report template.

The template is a build artifact of backend/scripts/build_report_template.py;
its body must mirror the operator's reference letter (تقارير شاملة.docx,
2026-07-24): letter top block, bold 16pt justified body anchor, centered
closing, 18pt kashida signature block, no CC block.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt

TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "GSSG-GS_300-004_Report.docx"

NAME_LABEL = "الإس" + "ـ" * 75 + "م : "
SIGN_LABEL = "التوقي" + "ـ" * 69 + "ع:"


@pytest.fixture(scope="module")
def paras():
    return list(Document(str(TEMPLATE)).paragraphs)


def _index(paras, needle: str) -> int:
    for i, p in enumerate(paras):
        if needle in p.text:
            return i
    raise AssertionError(f"paragraph containing {needle!r} not found")


def test_top_block(paras):
    i_date = _index(paras, "التاريخ: {{ date }}")
    i_addr = _index(paras, "المحترم")
    i_greet = _index(paras, "تحية طيبة وبعد ,,")
    i_subj = _index(paras, "الموضوع : ")
    assert i_date < i_addr < i_greet < i_subj
    # المحترم reaches the line end via a tab, not literal spaces
    assert "السيد {{ recipient_name }}\tالمحترم" in paras[i_addr].text  # noqa: RUF001
    assert paras[i_subj].alignment == WD_ALIGN_PARAGRAPH.CENTER


def test_body_anchor_bold_16pt_justified(paras):
    p = paras[_index(paras, "{{ body }}")]
    assert p.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY
    (run,) = [r for r in p.runs if "{{ body }}" in r.text]
    assert run.bold is True
    assert run.font.size == Pt(16)


def test_closing_block(paras):
    i_action = _index(paras, "للتفضل بالعلم وإجراءاتكم لطفاً،،،")
    i_close = _index(paras, "وتفضلوا بقبول فائق الإحترام والتقدير ,,,")
    i_name = _index(paras, "{{ manager_name }}")
    assert paras[i_action].alignment == WD_ALIGN_PARAGRAPH.JUSTIFY
    assert paras[i_close].alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert all(not paras[j].text.strip() for j in range(i_action + 1, i_close))
    assert i_close - i_action - 1 == 7  # blanks pushing the closing down
    assert i_name - i_close - 1 == 9  # blanks above the signature block


def test_signature_block(paras):
    i_name = _index(paras, "{{ manager_name }}")
    i_title = _index(paras, "{{ manager_title }}")
    i_sig = _index(paras, "{{ manager_sig }}")
    assert i_name + 1 == i_title
    assert i_title + 1 == i_sig
    assert NAME_LABEL + "{{ manager_name }}" in paras[i_name].text
    assert "المسمى الوظيفي : {{ manager_title }}" in paras[i_title].text
    assert SIGN_LABEL in paras[i_sig].text
    assert paras[i_sig].paragraph_format.left_indent.twips == 4680
    label_run = next(r for r in paras[i_name].runs if "الإس" in r.text)
    assert label_run.font.size == Pt(18)


def test_no_cc_block(paras):
    text = "\n".join(p.text for p in paras)
    assert "نسخة إلى" not in text
    assert "{%p" not in text
    assert "cc" not in text
