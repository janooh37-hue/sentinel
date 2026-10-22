# backend/tests/test_render_signed_pdf_manager.py
"""Regression: signing a Material Request Form must reproduce the manager that
was chosen at generation time.

The chosen manager is stored on ``Book.doc_manager_id`` (not in
``BookVersion.fields``). ``render_signed_artifact`` used to re-render with
``manager_id=None``, which blanked the ``{{ manager_name }}`` cell in the
signed copy (SC-0425). It must resolve the book's ``doc_manager_id`` instead.
"""

from __future__ import annotations

import zipfile

from PIL import Image

from app.config import Settings
from app.db.models import Book, BookCategory, BookVersion, Employee, Manager, User
from app.services import document_service
from app.services.document_service import _TEMPLATES_DIR


def _docx_text(path) -> str:
    import re

    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8", "ignore")
    return re.sub(r"<[^>]+>", "", xml)


def test_signed_copy_keeps_doc_manager_name(db_session, tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path, templates_dir=_TEMPLATES_DIR)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)

    sig = tmp_path / "signer.png"
    img = Image.new("RGBA", (400, 168), (255, 255, 255, 0))
    for x in range(40, 360):
        img.putpixel((x, 84), (0, 0, 0, 255))
    img.save(sig)

    db_session.add(BookCategory(id="SC", name_en="Supply Chain", name_ar="سلسلة", prefix="SC"))
    mgr = Manager(name_en="SAEED RASHED SANAD KHALFAN ALYAHYAEE", name_ar="سعيد", title="مدير")
    db_session.add(mgr)
    db_session.flush()

    book = Book(
        category_id="SC",
        ref_number="SC-9999",
        subject="Material Request Form",
        direction="outgoing",
        employee_id=None,
        approval_state="approved",
        doc_manager_id=mgr.id,
        merged_attachment_paths=[],
    )
    db_session.add(book)
    db_session.flush()

    version = BookVersion(
        book_id=book.id,
        version_no=1,
        template_id="Material Request Form",
        fields={"items": [{"sno": "1", "description": "Widget", "qty": "2"}]},
        status="approved",
    )
    db_session.add(version)
    db_session.flush()
    private_output = tmp_path / "private-signed-base"

    artifact = document_service.render_signed_artifact(
        db_session,
        version=version,
        signer_signature_path=str(sig),
        output_dir=private_output,
    )

    docx = next(private_output.glob("*_signed.docx"))
    text = _docx_text(docx)
    assert "SAEED RASHED" in text, "signed copy dropped the manager name"
    assert artifact.docx_path == docx


def test_signed_general_book_keeps_submitter_g_on_every_footer(db_session, tmp_path, monkeypatch):
    """The signed re-render has no current_user; the footer still prints the
    book submitter's G-number on page 1 and pages 2+."""
    settings = Settings(data_dir=tmp_path, templates_dir=_TEMPLATES_DIR)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    sig = tmp_path / "signer.png"
    Image.new("RGBA", (400, 168), (0, 0, 0, 255)).save(sig)

    if db_session.get(BookCategory, "GS") is None:
        db_session.add(BookCategory(id="GS", prefix="GS"))
    db_session.add(Employee(id="G4321", name_en="Submitter", name_ar="مقدم"))
    submitter = User(email="gb-submitter@x.ae", password_hash="x", employee_id="G4321")
    db_session.add(submitter)
    db_session.flush()
    book = Book(
        category_id="GS",
        ref_number="1/5/GSSG/77",
        subject="كتاب",
        classification_code="5/1",
        approval_state="approved",
        submitted_by_user_id=submitter.id,
    )
    db_session.add(book)
    db_session.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        template_id="General Book",
        fields={"subject": "كتاب", "body_html": "<p>نص</p>", "date": "13-10-2026"},
        status="approved",
    )
    db_session.add(version)
    db_session.flush()

    artifact = document_service.render_signed_artifact(
        db_session, version=version, signer_signature_path=str(sig), output_dir=tmp_path / "out"
    )

    with zipfile.ZipFile(artifact.docx_path) as z:
        for part in ("word/footer1.xml", "word/footer2.xml"):
            assert z.read(part).decode().count("G4321") == 1, part
