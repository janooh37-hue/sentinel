# backend/tests/test_material_request_signing.py
"""Regression tests for SC-0425-class bugs in the Material Request Form
signing path:

  1. The manager signature must NOT grow the signature row (which pushed the
     form onto a second page). It is floated *behind text* (zero layout
     height), the same technique the Leave Permit / Admin Leave forms use.
  2. Re-rendering a version at sign-time must reproduce the manager NAME that
     was chosen at generation (stored on ``Book.doc_manager_id``); the signed
     copy used to render it blank.
"""
from __future__ import annotations

from pathlib import Path

from docx import Document
from PIL import Image

from app.core.docx_engine import DocxEngine
from app.services.document_service import _TEMPLATES_DIR


def _make_sig_png(path: Path) -> Path:
    # A diagonal stroke so the ink bounding box has real width AND height
    # (a flat 1px line crops to ~zero height and can't be bottom-aligned).
    img = Image.new("RGBA", (400, 168), (255, 255, 255, 0))
    for x in range(40, 360):
        y = 20 + int((x - 40) * 120 / 320)
        for dy in (-1, 0, 1):
            img.putpixel((x, y + dy), (0, 0, 0, 255))
    img.save(path)
    return path


def _mrf_sig_cell(doc):
    """Table 4 / row 5 / cell 3 holds {{ manager_sig }} (the verifier
    Signature cell)."""
    return doc.tables[4].rows[5].cells[3]


def test_manager_signature_is_floated_behind_text(tmp_path):
    sig = _make_sig_png(tmp_path / "sig.png")
    out = tmp_path / "mrf.docx"
    data = {
        "manager_name": "SAEED RASHED SANAD KHALFAN ALYAHYAEE",
        "manager_sig_path": str(sig),
        "items": [{"sno": "1", "description": "Widget", "qty": "2"}],
        "_sig_size_mm": 45,
    }
    DocxEngine(_TEMPLATES_DIR).fill("Material Request Form", data, out)

    doc = Document(str(out))
    cell_xml = _mrf_sig_cell(doc)._tc.xml
    # Manager name still renders in its own cell.
    assert "SAEED RASHED" in doc.tables[4].rows[4].cells[1].text
    # The signature image must be present...
    assert "w:drawing" in cell_xml, "signature image missing from signature cell"
    # ...and FLOATING (behind text), not inline — inline would add row height
    # and bump the table onto a second page.
    assert 'behindDoc="1"' in cell_xml, "manager signature is not floated behind text"
    assert "wp:inline" not in cell_xml, "manager signature is still inline (adds height)"
    # ...and lifted UP (negative vertical offset) so it rests on the signature
    # line and rises into the empty Contact cell above, instead of hanging down
    # across the "Supply Chain" divider below.
    import re

    voffsets = re.findall(r"<wp:positionV[^>]*>\s*<wp:posOffset>(-?\d+)</wp:posOffset>", cell_xml)
    assert voffsets and int(voffsets[0]) < 0, f"signature not lifted up (vOffset={voffsets})"


def test_arabic_material_request_renders_three_items_and_center_manager_signature(tmp_path):
    """Only the selected manager fills the center-manager approval slot."""
    from zipfile import ZipFile

    sig = _make_sig_png(tmp_path / "arabic-sig.png")
    out = tmp_path / "arabic-mrf.docx"
    data = {
        "department": "قسم الأمن",
        "project_site": "الوثبة",
        "request_date": "15/10/2026",
        "delivery_date": "20/10/2026",
        "name": "طالب المواد",
        "manager_name": "مدير العقد",
        "employee_sig_path": str(sig),
        "manager_sig_path": str(sig),
        "items": [
            {
                "sno": str(i),
                "code": f"AR-{i}",
                "description": f"مادة {i}",
                "unit": "قطعة",
                "qty": str(i + 2),
                "remarks": f"ملاحظة {i}",
            }
            for i in range(1, 4)
        ],
    }
    DocxEngine(_TEMPLATES_DIR).fill("Material Request Form (Arabic)", data, out)
    with ZipFile(out) as archive:
        xml = "".join(
            archive.read(name).decode("utf-8")
            for name in archive.namelist()
            if name.startswith("word/") and name.endswith(".xml")
        )
    assert "{{" not in xml and "{%" not in xml
    for key in ("department", "project_site", "request_date", "delivery_date", "manager_name"):
        assert data[key] in xml
    assert data["name"] not in xml
    for item in data["items"]:
        for value in item.values():
            assert value in xml
    doc = Document(str(out))
    assert len(doc.tables[0].rows) == 21
    approval = doc.tables[1]
    assert approval.rows[1].cells[1].text == data["manager_name"]
    cell_xml = approval.rows[1].cells[3]._tc.xml
    assert 'behindDoc="1"' in cell_xml
    assert "wp:inline" not in cell_xml
    assert approval.rows[3].cells[1].text == ""
    assert "w:drawing" not in approval.rows[3].cells[3]._tc.xml
    final = doc.tables[2].rows[2]
    assert final.cells[1].text == ""
    assert "w:drawing" not in final.cells[3]._tc.xml


def test_arabic_material_request_tokens_keep_design_font_and_direction():
    from zipfile import ZipFile

    from lxml import etree

    from app.core.constants import TEMPLATE_FILES

    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    w = f"{{{ns['w']}}}"
    token_count = 0
    template = _TEMPLATES_DIR / TEMPLATE_FILES["Material Request Form (Arabic)"]
    with ZipFile(template) as archive:
        for part in ("word/document.xml", "word/header2.xml"):
            tree = etree.fromstring(archive.read(part))
            for text in tree.findall(".//w:t", ns):
                token = text.text or ""
                if "{{" not in token or "manager_sig" in token:
                    continue
                token_count += 1
                props = text.getparent().find("w:rPr", ns)
                assert props is not None, token
                assert props.find("w:rFonts", ns).get(w + "ascii") == "Univers Next Arabic"
                assert props.find("w:sz", ns).get(w + "val") == "19"
                assert props.find("w:szCs", ns).get(w + "val") == "19"
                rtl = props.find("w:rtl", ns)
                assert rtl is not None, token
                ltr = any(f"'{key}'" in token for key in ("sno", "code", "qty")) or (
                    token in ("{{ request_date }}", "{{ delivery_date }}")
                )
                assert rtl.get(w + "val") == ("0" if ltr else None), token
    assert token_count == 125
