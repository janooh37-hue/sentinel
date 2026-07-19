"""stamp_signature_above_name — anchor the approval signature in an authored docx."""

import zipfile
from pathlib import Path

from docx import Document

from app.core.docx_engine import stamp_signature_above_name


def _make_letter(tmp_path: Path, closing_name: str) -> Path:
    doc = Document()
    doc.add_paragraph("نص الكتاب التجريبي")
    doc.add_paragraph("")  # signature gap
    doc.add_paragraph(closing_name)
    doc.add_paragraph("مدير مشروع")
    p = tmp_path / "letter.docx"
    doc.save(str(p))
    return p


def _make_sig(tmp_path: Path) -> Path:
    from PIL import Image

    sig = tmp_path / "sig.png"
    Image.new("RGBA", (60, 30), (0, 0, 200, 255)).save(sig)
    return sig


def _document_xml(docx: Path) -> bytes:
    with zipfile.ZipFile(docx) as z:
        return z.read("word/document.xml")


def test_stamps_on_exact_name(tmp_path: Path) -> None:
    docx = _make_letter(tmp_path, "سعيد راشد اليحيائي")
    ok = stamp_signature_above_name(
        docx, str(_make_sig(tmp_path)), ["سعيد راشد اليحيائي"], size_mm=32.0, boldness=2
    )
    assert ok
    # The float is an anchored drawing in the paragraph above the name.
    assert b"<wp:anchor" in _document_xml(docx)


def test_stamps_despite_tatweel_stretching(tmp_path: Path) -> None:
    # Hand-made templates stretch names with tatweel: سعيــــد راشــــد
    docx = _make_letter(tmp_path, "سعيــــــــــد راشــــــــــد اليحيائــــــــــي")
    ok = stamp_signature_above_name(
        docx, str(_make_sig(tmp_path)), ["سعيد راشد اليحيائي"], size_mm=32.0, boldness=2
    )
    assert ok
    assert b"<wp:anchor" in _document_xml(docx)


def test_falls_back_to_last_paragraph_when_name_missing(tmp_path: Path) -> None:
    docx = _make_letter(tmp_path, "اسم آخر تماماً")
    ok = stamp_signature_above_name(
        docx, str(_make_sig(tmp_path)), ["سعيد راشد اليحيائي"], size_mm=32.0, boldness=2
    )
    assert ok  # fallback anchor, still stamped
    assert b"<wp:anchor" in _document_xml(docx)


def test_noop_without_signature_file(tmp_path: Path) -> None:
    docx = _make_letter(tmp_path, "سعيد راشد اليحيائي")
    ok = stamp_signature_above_name(
        docx, str(tmp_path / "missing.png"), ["سعيد راشد اليحيائي"], size_mm=32.0, boldness=2
    )
    assert not ok


def test_cc_line_does_not_steal_the_anchor(tmp_path: Path) -> None:
    """A CC line AFTER the closing block can mention the manager's name — the
    exact-equality pass must win so the float lands above the NAME, not above
    the CC line (review M/S1)."""
    doc = Document()
    doc.add_paragraph("نص الكتاب")  # 0
    doc.add_paragraph("")  # 1 — signature gap (expected anchor)
    doc.add_paragraph("سعيد راشد اليحيائي")  # 2
    doc.add_paragraph("مدير مشروع")  # 3
    doc.add_paragraph("نسخة إلى: مكتب سعيد راشد اليحيائي")  # 4 — decoy
    p = tmp_path / "cc.docx"
    doc.save(str(p))
    ok = stamp_signature_above_name(
        p, str(_make_sig(tmp_path)), ["سعيد راشد اليحيائي"], size_mm=32.0, boldness=2
    )
    assert ok
    reloaded = Document(str(p))
    with_drawing = [
        i
        for i, para in enumerate(reloaded.paragraphs)
        if para._p.findall(
            ".//{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}anchor"
        )
    ]
    assert with_drawing == [1]  # the gap above the name — not the title (2/3) or CC (4)


def test_stamps_inside_tables(tmp_path: Path) -> None:
    """Word-paste-into-tables letters keep every paragraph inside table cells —
    doc.paragraphs alone finds nothing; the stamp must search cells too."""
    doc = Document()
    table = doc.add_table(rows=3, cols=1)
    table.rows[0].cells[0].paragraphs[0].add_run("نص داخل جدول")
    table.rows[1].cells[0].paragraphs[0].add_run("سعيد راشد اليحيائي")
    table.rows[2].cells[0].paragraphs[0].add_run("مدير مشروع")
    p = tmp_path / "table.docx"
    doc.save(str(p))
    ok = stamp_signature_above_name(
        p, str(_make_sig(tmp_path)), ["سعيد راشد اليحيائي"], size_mm=32.0, boldness=2
    )
    assert ok
    assert b"<wp:anchor" in _document_xml(p)
