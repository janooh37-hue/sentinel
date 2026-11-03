# backend/tests/test_leave_form_signing.py
"""Regression tests for the Leave Permit (301-004) and Administrative Leave
(301-005) redesigned papers: field placement and signer block:

  1. The project-manager signature sits inline and centred on the signature
     line just ABOVE the manager name in the final notes cell.
  2. On Admin Leave the branch-manager signature sits inline and centred in
     the separate التوقيع cell, with notes in the branch notes row. Without
     a branch signature the cell stays blank (including no "x" placeholder).
  3. Both approvers have distinct tracked signature roles and identities.
  4. With NO project manager selected, the standalone designation
     (DEFAULT_MANAGER_TITLE) and project-manager signature are hidden.
"""

from __future__ import annotations

from pathlib import Path
from zipfile import ZipFile

import pytest
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from PIL import Image

from app.core.constants import DEFAULT_MANAGER_TITLE
from app.core.docx_engine import DocxEngine
from app.core.signature_layout import (
    inspect_signature_drawings,
    parse_marker_descr,
    role_for_sig_key,
)
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


def _signer_cell_paragraphs(doc):
    return doc.tables[-1].rows[-1].cells[0].paragraphs


def _manager_block_paragraphs(doc):
    return [p for p in _signer_cell_paragraphs(doc) if p.text.strip() in (_MANAGER, _TITLE)]


def _para_above_name(doc):
    """The paragraph above the manager name in the final notes cell."""
    cell = _signer_cell_paragraphs(doc)
    for i, p in enumerate(cell):
        if p.text.strip() == _MANAGER and i > 0:
            return cell[i - 1]
    return None


FORMS = ("Leave Permit Form", "Administrative Leave Form")


# --- project signature lands centred above the name ------------------------


def test_signature_sits_centred_above_name_in_the_notes_cell(tmp_path):
    for form in FORMS:
        doc = _render(form, _with_manager(_make_sig_png(tmp_path / "s.png")), tmp_path)
        assert _MANAGER not in [p.text.strip() for p in doc.paragraphs], (
            f"{form}: signer block escaped the notes cell"
        )
        anchor = _para_above_name(doc)
        assert anchor is not None, f"{form}: name not in the notes cell"
        assert "w:drawing" in anchor._p.xml, f"{form}: signature not on the line above the name"
        assert anchor.alignment == WD_ALIGN_PARAGRAPH.CENTER, f"{form}: signature not centred"


def test_manager_block_centred(tmp_path):
    for form in FORMS:
        doc = _render(form, _with_manager(_make_sig_png(tmp_path / "s.png")), tmp_path)
        paras = _manager_block_paragraphs(doc)
        assert len(paras) == 2, f"{form}: expected name + title, got {len(paras)}"
        assert all(p.alignment == WD_ALIGN_PARAGRAPH.CENTER for p in paras), (
            f"{form}: block not centred"
        )


def test_admin_leave_branch_signature_cell_is_blank_without_branch_signature(tmp_path):
    doc = _render(
        "Administrative Leave Form", _with_manager(_make_sig_png(tmp_path / "s.png")), tmp_path
    )
    cell = doc.tables[2].rows[3].cells[1]
    assert "w:drawing" not in cell._tc.xml, "project signature must not occupy the branch cell"
    assert "x" not in cell.text.lower(), "literal 'x' placeholder not cleared"


@pytest.mark.parametrize("size_mm", [None, 26.5, 45])
def test_admin_leave_branch_signature_is_centred_inline_and_tracked(tmp_path, size_mm):
    sig = _make_sig_png(tmp_path / "branch.png")
    notes = "موافق على الإجازة\nبشرط تسليم المهام"
    data = {**_base(), "branch_manager_sig_path": str(sig), "branch_manager_notes": notes}
    if size_mm is not None:
        data["_sig_size_mm"] = size_mm
    doc = _render("Administrative Leave Form", data, tmp_path)

    cell = doc.tables[2].rows[3].cells[1]
    inlines = cell._tc.xpath(".//wp:inline")
    assert len(inlines) == 1
    assert not cell._tc.xpath(".//wp:anchor"), "branch signature must never float"
    assert cell.paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert "x" not in cell.text.lower()
    assert doc.tables[2].rows[1].cells[0].text == notes
    assert "w:drawing" not in doc.tables[3]._tbl.xml, "branch stage must not sign the final box"
    assert DEFAULT_MANAGER_TITLE not in doc.tables[3]._tbl.xml

    drawings = inspect_signature_drawings(tmp_path / "form.docx")
    assert len(drawings) == 1
    drawing = drawings[0]
    assert drawing.role == "branch_manager"
    expected_size_mm = min(int(size_mm if size_mm is not None else 32), 32)
    assert drawing.width_emu == pytest.approx(expected_size_mm * 36000, abs=1)
    docpr = inlines[0].find(qn("wp:docPr"))
    assert parse_marker_descr(docpr.get("descr")) == ("branch_manager", drawing.signature_id)
    assert role_for_sig_key("branch_manager_sig_path") == "branch_manager"


def test_admin_leave_branch_and_project_signatures_have_separate_roles_and_identities(tmp_path):
    # Reuse identical image bytes: the occurrence markers, not the media part,
    # must distinguish branch and project-manager approval signatures.
    sig = _make_sig_png(tmp_path / "shared.png")
    notes = "موافق"
    doc = _render(
        "Administrative Leave Form",
        {
            **_with_manager(sig),
            "branch_manager_sig_path": str(sig),
            "branch_manager_notes": notes,
        },
        tmp_path,
    )
    branch_cell = doc.tables[2].rows[3].cells[1]
    project_anchor = _para_above_name(doc)
    assert project_anchor is not None
    branch_inlines = branch_cell._tc.xpath(".//wp:inline")
    project_inlines = project_anchor._p.xpath(".//wp:inline")
    assert len(branch_inlines) == len(project_inlines) == 1
    assert not branch_cell._tc.xpath(".//wp:anchor")
    assert (
        branch_cell.paragraphs[0].alignment == project_anchor.alignment == WD_ALIGN_PARAGRAPH.CENTER
    )
    assert doc.tables[2].rows[1].cells[0].text == notes

    drawings = inspect_signature_drawings(tmp_path / "form.docx")
    assert len(drawings) == 2
    by_role = {drawing.role: drawing for drawing in drawings}
    assert set(by_role) == {"branch_manager", "manager"}
    branch = by_role["branch_manager"]
    project = by_role["manager"]
    assert branch.signature_id != project.signature_id
    assert branch.image_sha256 == project.image_sha256
    assert branch.width_emu == project.width_emu
    assert branch.height_emu == project.height_emu
    assert parse_marker_descr(branch_inlines[0].find(qn("wp:docPr")).get("descr")) == (
        "branch_manager",
        branch.signature_id,
    )
    assert parse_marker_descr(project_inlines[0].find(qn("wp:docPr")).get("descr")) == (
        "manager",
        project.signature_id,
    )


def test_admin_leave_branch_only_signature_activates_placement_tracking(
    db_session, tmp_path, monkeypatch
):
    from app.config import Settings
    from app.db.models import BookVersion
    from app.schemas.signature_placement import SignatureRead
    from app.services import signature_placement_service

    settings = Settings(data_dir=tmp_path, templates_dir=_TEMPLATES_DIR)
    monkeypatch.setattr(signature_placement_service, "get_settings", lambda: settings)
    _render(
        "Administrative Leave Form",
        {**_base(), "branch_manager_sig_path": str(_make_sig_png(tmp_path / "branch.png"))},
        tmp_path,
    )
    version = BookVersion(id=1, book_id=1, version_no=1, signature_revision=0)
    row = signature_placement_service.capture_initial_revision(
        db_session,
        version=version,
        source_kind=signature_placement_service.SOURCE_KIND_APPROVAL,
        signer_user_id=5,
        docx_path=tmp_path / "form.docx",
        primary_pdf_path=None,
        published_pdf_path=None,
    )
    assert row is not None
    assert row.revision == version.signature_revision == 1
    assert row.signer_user_id == 5
    retained = settings.data_dir / row.docx_path
    assert retained != tmp_path / "form.docx"
    assert retained.read_bytes() == (tmp_path / "form.docx").read_bytes()
    (drawing,) = inspect_signature_drawings(retained)
    response = SignatureRead(
        id=drawing.signature_id,
        role=drawing.role,
        page=None,
        x=None,
        y=None,
        width_pt=None,
        height_pt=None,
        image_url=f"/api/v1/documents/1/signatures/{drawing.signature_id}/image",
    )
    assert response.role == "branch_manager"


def test_admin_leave_branch_manager_notes_fill_the_branch_row(tmp_path):
    notes = "موافق على الإجازة\nبشرط تسليم المهام"
    doc = _render("Administrative Leave Form", {**_base(), "branch_manager_notes": notes}, tmp_path)
    branch = doc.tables[2]
    assert branch.rows[0].cells[0].text.strip() == "إجراءات مدير الفرع"
    assert branch.rows[1].cells[0].text == notes
    assert notes.splitlines()[0] not in branch.rows[3].cells[1].text


def test_admin_leave_without_notes_keeps_branch_row_blank(tmp_path):
    doc = _render("Administrative Leave Form", _base(), tmp_path)
    assert doc.tables[2].rows[1].cells[0].text.strip() == ""


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
        body_text = "\n".join(p.text for p in _signer_cell_paragraphs(doc))
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
