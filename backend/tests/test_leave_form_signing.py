# backend/tests/test_leave_form_signing.py
"""Regression tests for the Leave Permit (301-004) and Administrative Leave
(301-005) redesigned papers: field placement and signer block:

  1. The manager signature floats *behind text* (zero layout height) on the
     signature line just ABOVE the manager name: below Leave Permit's notes
     box, inside Admin Leave's notes box, never in the branch التوقيع cell.
  2. On Admin Leave the branch-manager التوقيع cell is left blank (no image, no
     literal "x" placeholder) for a separate manual signature.
  3. The manager name + title block is LEFT-aligned and consistent.
  4. With NO manager selected, the standalone designation (DEFAULT_MANAGER_TITLE)
     is not left stranded at the foot of the form, and no signature is placed.
"""

from __future__ import annotations

from pathlib import Path
from zipfile import ZipFile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from PIL import Image

from app.core.constants import DEFAULT_MANAGER_TITLE
from app.core.docx_engine import DocxEngine
from app.services.document_service import _TEMPLATES_DIR

_MANAGER = "سعيد راشد اليحيائي"
_TITLE = "مدير مشروع مركز الإصلاح والتأهيل – الوثبة 2"  # noqa: RUF001


def _make_sig_png(path: Path) -> Path:
    img = Image.new("RGBA", (400, 168), (255, 255, 255, 0))
    for x in range(40, 360):
        y = 20 + int((x - 40) * 120 / 320)
        for dy in (-1, 0, 1):
            img.putpixel((x, y + dy), (0, 0, 0, 255))
    img.save(path)
    return path


def _base() -> dict:
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
    }


def _with_manager(sig: Path) -> dict:
    return {
        **_base(),
        "manager_name": _MANAGER,
        "manager_title": _TITLE,
        "manager_sig_path": str(sig),
        "_sig_size_mm": 45,
    }


def _render(form: str, data: dict, tmp_path: Path):
    out = tmp_path / "form.docx"
    DocxEngine(_TEMPLATES_DIR).fill(form, data, out)
    return Document(str(out))


def _signer_paragraphs(doc):
    return list(doc.paragraphs) + doc.tables[-1].rows[-1].cells[0].paragraphs


def _manager_block_paragraphs(doc):
    return [p for p in _signer_paragraphs(doc) if p.text.strip() in (_MANAGER, _TITLE)]


def _is_left_aligned(paragraph) -> bool:
    if paragraph.alignment != WD_ALIGN_PARAGRAPH.LEFT:
        return False
    pPr = paragraph._p.find(qn("w:pPr"))
    return pPr is None or pPr.find(qn("w:bidi")) is None


def _para_above_name(doc):
    """The paragraph above the manager name, either body-level or in its cell."""
    body = _signer_paragraphs(doc)
    for i, p in enumerate(body):
        if p.text.strip() == _MANAGER and i > 0:
            return body[i - 1]
    return None


FORMS = ("Leave Permit Form", "Administrative Leave Form")


# --- signature lands above the name, floated behind text -------------------


def test_signature_floats_above_name_in_its_signer_block(tmp_path):
    for form in FORMS:
        doc = _render(form, _with_manager(_make_sig_png(tmp_path / "s.png")), tmp_path)
        anchor = _para_above_name(doc)
        assert anchor is not None, f"{form}: name paragraph not found"
        axml = anchor._p.xml
        assert "w:drawing" in axml, f"{form}: signature not on the line above the name"
        assert 'behindDoc="1"' in axml, f"{form}: signature not floated behind text"
        assert "wp:inline" not in axml, f"{form}: signature still inline"
        notes_has_signature = "w:drawing" in doc.tables[-1]._tbl.xml
        assert notes_has_signature == (form == "Administrative Leave Form")


def test_manager_block_left_aligned(tmp_path):
    for form in FORMS:
        doc = _render(form, _with_manager(_make_sig_png(tmp_path / "s.png")), tmp_path)
        paras = _manager_block_paragraphs(doc)
        assert len(paras) == 2, f"{form}: expected name + title, got {len(paras)}"
        assert all(_is_left_aligned(p) for p in paras), f"{form}: block not left-aligned"


def test_admin_leave_branch_signature_cell_is_blank(tmp_path):
    doc = _render(
        "Administrative Leave Form", _with_manager(_make_sig_png(tmp_path / "s.png")), tmp_path
    )
    cell = doc.tables[2].rows[3].cells[1]
    assert "w:drawing" not in cell._tc.xml, "signature must not sit in the branch التوقيع cell"
    assert "x" not in cell.text.lower(), "literal 'x' placeholder not cleared"


def test_redesigned_leave_forms_render_values_in_their_cells(tmp_path):
    data = {
        **_base(),
        "today": "09/07/2026",
        "manager_name": _MANAGER,
        "manager_title": _TITLE,
        "start_date": "08/07/2026",
        "end_date": "10/07/2026",
    }
    data.pop("leave_date_range")
    expected = {
        "Leave Permit Form": {
            (0, 1, 1): data["employee_id"],
            (0, 1, 3): data["employee_name_ar"],
            (0, 2, 1): data["date"],
            (0, 2, 3): data["unit_branch"],
            (1, 1, 1): data["leave_reason"],
            (1, 2, 1): data["duration_hours"],
        },
        "Administrative Leave Form": {
            (0, 1, 1): data["date"],
            (0, 1, 3): data["employee_id"],
            (0, 2, 1): data["employee_name_ar"],
            (0, 3, 1): "إدارية",
            (0, 3, 3): data["unit_branch"],
            (1, 1, 1): data["leave_reason"],
            (1, 2, 1): data["duration"],
            (1, 3, 1): "08/07/2026  -  10/07/2026",
            (2, 2, 1): data["today"],
            (2, 3, 1): "",
            (2, 6, 1): data["admin_leaves_this_month"],
        },
    }
    for form, cells in expected.items():
        doc = _render(form, data, tmp_path)
        for (table, row, cell), value in cells.items():
            target = doc.tables[table].rows[row].cells[cell]
            assert target.text.strip() == value
            if value and (value[0].isdigit() or value.startswith("G")):
                for run in target.paragraphs[0].runs:
                    rtl = run._r.find(f"{qn('w:rPr')}/{qn('w:rtl')}")
                    assert rtl is None or rtl.get(qn("w:val")) == "0", (form, value)
        assert len(_manager_block_paragraphs(doc)) == 2
        with ZipFile(tmp_path / "form.docx") as archive:
            for part in archive.namelist():
                if part.startswith("word/") and part.endswith(".xml"):
                    xml = archive.read(part)
                    assert b"{{" not in xml and b"{%" not in xml, part


# --- no manager selected → no stranded designation, no signature -----------


def test_no_manager_hides_designation_and_signature(tmp_path):
    for form in FORMS:
        doc = _render(form, _base(), tmp_path)  # no manager_* fields at all
        body_text = "\n".join(p.text for p in _signer_paragraphs(doc))
        assert DEFAULT_MANAGER_TITLE not in body_text, f"{form}: designation shown with no manager"
        assert "w:drawing" not in doc.element.body.xml, f"{form}: stray signature with no manager"


# --- manager name renders in Arabic (prefer_arabic wiring) -----------------


def test_leave_forms_use_arabic_manager_name(db_session, tmp_path, monkeypatch):
    """Leave Permit / Admin Leave must resolve the manager's Arabic name, while a
    non-leave form keeps the English-first default (scoping proof)."""
    from app.config import Settings
    from app.db.models import Manager
    from app.services import document_service
    from app.services.document_service import _build_template_data

    settings = Settings(data_dir=tmp_path, templates_dir=_TEMPLATES_DIR)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)

    mgr = Manager(name_en="Saeed Rashed", name_ar="سعيد راشد اليحيائي", title=None)
    db_session.add(mgr)
    db_session.flush()

    def _name(template_id: str) -> str:
        data = _build_template_data(
            db_session,
            template_id=template_id,
            employee=None,
            employee_id=None,
            fields={},
            manager_id=mgr.id,
            submitter_id=None,
            embed_signature=None,
            current_user=None,
        )
        return data["manager_name"]

    assert _name("Leave Permit Form") == "سعيد راشد اليحيائي"
    assert _name("Administrative Leave Form") == "سعيد راشد اليحيائي"
    assert _name("Material Request Form (Arabic)") == "سعيد راشد اليحيائي"
    # A form outside the Arabic-preferring set keeps English-first behaviour.
    assert _name("Material Request Form") == "Saeed Rashed"
