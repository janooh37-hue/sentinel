# backend/tests/test_render_signed_pdf_manager.py
"""Regression: signing a Material Request Form must reproduce the manager that
was chosen at generation time.

The chosen manager is stored on ``Book.doc_manager_id`` (not in
``BookVersion.fields``). ``render_signed_pdf`` used to re-render with
``manager_id=None``, which blanked the ``{{ manager_name }}`` cell in the
signed copy (SC-0425). It must resolve the book's ``doc_manager_id`` instead.
"""
from __future__ import annotations

import zipfile

import pytest
from PIL import Image

from app.config import Settings
from app.db.models import Book, BookCategory, BookVersion, Manager
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

    rel = document_service.render_signed_pdf(
        db_session, version=version, signer_signature_path=str(sig)
    )

    docx = next((tmp_path / "output").rglob("*_signed.docx"))
    text = _docx_text(docx)
    assert "SAEED RASHED" in text, "signed copy dropped the manager name"
    assert rel  # a path was returned
