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
