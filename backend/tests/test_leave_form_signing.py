# backend/tests/test_leave_form_signing.py
"""Regression tests for the Leave Permit (301-004) and Administrative Leave
(301-005) signing layout:

  1. The manager signature is placed in the project-manager notes box
     (the last table), floated *behind text* (zero layout height) and
     *horizontally centred* — the old placement was jammed on the box's
     bottom border and off-centre / (Admin Leave) dumped in the wrong,
     narrow branch-manager التوقيع cell where it overflowed left.
  2. On Admin Leave the branch-manager التوقيع cell is left blank (no image,
     no literal "x" placeholder) for a separate manual signature.
  3. The manager name + title block below the box is LEFT-aligned and
     consistent across both forms (was right-aligned / bidi-split).
"""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from PIL import Image

from app.core.docx_engine import DocxEngine
from app.services.document_service import _TEMPLATES_DIR

_MANAGER = "خالد سعيد"
_TITLE = "مدير الموارد البشرية"


def _make_sig_png(path: Path) -> Path:
    # Diagonal stroke → the ink bbox has real width AND height.
    img = Image.new("RGBA", (400, 168), (255, 255, 255, 0))
    for x in range(40, 360):
        y = 20 + int((x - 40) * 120 / 320)
        for dy in (-1, 0, 1):
            img.putpixel((x, y + dy), (0, 0, 0, 255))
    img.save(path)
    return path


def _data(sig: Path) -> dict:
    return {
        "employee_id": "G3082",
        "employee_name_ar": "محمد أحمد",
        "date": "08/07/2026",
        "unit_branch": "مركز الوثبة",
        "leave_reason": "ظرف عائلي",
        "duration_hours": "4",
        "duration": "3 أيام",
        "leave_date_range": "08/07 - 10/07",
        "admin_leaves_this_month": "2",
        "manager_name": _MANAGER,
        "manager_title": _TITLE,
        "manager_sig_path": str(sig),
        "_sig_size_mm": 45,
    }


def _manager_block_paragraphs(doc):
    """The body-level name + title paragraphs beneath the last table."""
    return [p for p in doc.paragraphs if p.text.strip() in (_MANAGER, _TITLE)]


def _is_left_aligned(paragraph) -> bool:
    if paragraph.alignment != WD_ALIGN_PARAGRAPH.LEFT:
        return False
    pPr = paragraph._p.find(qn("w:pPr"))
    # A leftover <w:bidi/> flips the start edge to the right, so it must be gone.
    return pPr is None or pPr.find(qn("w:bidi")) is None


# --- Leave Permit (301-004) ------------------------------------------------


def _render(form: str, tmp_path: Path):
    sig = _make_sig_png(tmp_path / "sig.png")
    out = tmp_path / "form.docx"
    DocxEngine(_TEMPLATES_DIR).fill(form, _data(sig), out)
    return Document(str(out))


def test_leave_permit_sig_centered_behind_text_in_box(tmp_path):
    doc = _render("Leave Permit Form", tmp_path)
    box_xml = doc.tables[3].rows[0].cells[0]._tc.xml
    assert "w:drawing" in box_xml, "signature missing from project-manager box"
    assert 'behindDoc="1"' in box_xml, "signature not floated behind text"
    assert "wp:inline" not in box_xml, "signature still inline (grows the box)"
    assert "<wp:align>center</wp:align>" in box_xml, "signature not horizontally centred"


def test_leave_permit_manager_block_left_aligned(tmp_path):
    doc = _render("Leave Permit Form", tmp_path)
    paras = _manager_block_paragraphs(doc)
    assert len(paras) == 2, f"expected name + title paragraphs, got {len(paras)}"
    assert all(_is_left_aligned(p) for p in paras), "manager name/title not left-aligned"


# --- Administrative Leave (301-005) ----------------------------------------


def test_admin_leave_branch_signature_cell_is_blank(tmp_path):
    doc = _render("Administrative Leave Form", tmp_path)
    cell = doc.tables[2].rows[3].cells[1]  # branch-manager التوقيع value cell
    assert "w:drawing" not in cell._tc.xml, "signature must not sit in the branch التوقيع cell"
    assert "x" not in cell.text.lower(), "literal 'x' placeholder not cleared"


def test_admin_leave_sig_centered_behind_text_in_box(tmp_path):
    doc = _render("Administrative Leave Form", tmp_path)
    box_xml = doc.tables[3]._tbl.xml  # project-manager notes box (whole table)
    assert "w:drawing" in box_xml, "signature missing from project-manager box"
    assert 'behindDoc="1"' in box_xml, "signature not floated behind text"
    assert "wp:inline" not in box_xml, "signature still inline (grows the box)"
    assert "<wp:align>center</wp:align>" in box_xml, "signature not horizontally centred"


def test_admin_leave_manager_block_left_aligned(tmp_path):
    doc = _render("Administrative Leave Form", tmp_path)
    paras = _manager_block_paragraphs(doc)
    assert len(paras) == 2, f"expected name + title paragraphs, got {len(paras)}"
    assert all(_is_left_aligned(p) for p in paras), "manager name/title not left-aligned"
