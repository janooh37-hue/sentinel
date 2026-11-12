# backend/tests/test_render_signed_pdf_manager.py
"""Regression: signing a Material Request Form must reproduce the manager that
was chosen at generation time.

The chosen manager is stored on ``Book.doc_manager_id`` (not in
``BookVersion.fields``). ``render_signed_artifact`` used to re-render with
``manager_id=None``, which blanked the ``{{ manager_name }}`` cell in the
signed copy (SC-0425). It must resolve the book's ``doc_manager_id`` instead.
"""

from __future__ import annotations

import hashlib
import zipfile
from io import BytesIO
from pathlib import Path

import pymupdf
import pytest
from docx import Document as DocxDocument
from docx.oxml.ns import qn
from PIL import Image

from app.api.errors import AppError
from app.api.v1.documents import GenerateAttachmentSpec
from app.config import Settings, get_settings
from app.core import signature as signature_core
from app.core.signature_layout import inspect_signature_drawings
from app.core.vault_manager import Vault
from app.db.models import Book, BookCategory, BookVersion, Employee, Manager, User
from app.services import book_service, document_service, staging_service, user_signature_service
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


def _body_image_blobs(path: Path) -> set[bytes]:
    document = DocxDocument(path)
    return {
        document.part.related_parts[
            blip.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
        ].blob
        for blip in document.element.body.xpath(".//a:blip")
    }


@pytest.mark.parametrize("embed_employee", [True, False])
@pytest.mark.parametrize(
    "template_id,legacy",
    [
        ("Salary Transfer Request", False),
        ("Salary Transfer Request", True),
        ("Material Request Form", False),
    ],
)
def test_approval_preserves_employee_signature_choice(
    db_session, tmp_path, monkeypatch, embed_employee, template_id, legacy
):
    """Approval retains employee opt-in/out, including pending pre-snapshot papers."""
    settings = Settings(
        data_dir=tmp_path / "data",
        templates_dir=_TEMPLATES_DIR,
        sms_enabled=False,
        openwa_enabled=False,
        disable_scheduler=True,
    )
    monkeypatch.setenv("GSSG_DATA_DIR", str(settings.data_dir))
    get_settings.cache_clear()
    for module in (document_service, book_service, user_signature_service):
        monkeypatch.setattr(module, "get_settings", lambda: settings)

    # Word COM is an external boundary; retain image bytes in a valid test PDF.
    def convert(path):
        with pymupdf.open() as pdf:
            page = pdf.new_page()
            for blob in _body_image_blobs(path):
                page.insert_image(pymupdf.Rect(30, 30, 167, 81), stream=blob)
            target = path.with_suffix(".pdf")
            pdf.save(target)
        return target

    monkeypatch.setattr(document_service, "convert_docx_to_pdf", convert)
    employee = Employee(id="G9001", name_en="Signature Employee", status="Active")
    signer = User(
        email="signature-approver@example.test",
        password_hash="x",
        role="admin",
        status="active",
        display_name="Signature Approver",
    )
    db_session.add_all(
        [
            employee,
            signer,
            BookCategory(id="HR", prefix="HR"),
            BookCategory(id="SC", prefix="SC"),
        ]
    )
    db_session.commit()
    manager = Manager(name_en="Signature Approver", user_id=signer.id)
    db_session.add(manager)
    db_session.commit()
    employee_png = BytesIO()
    Image.new("RGBA", (137, 51), (0, 0, 0, 255)).save(employee_png, format="PNG")
    signature_core.save(employee_png.getvalue(), employee.id, Vault(settings.vault_dir))
    manager_png = BytesIO()
    Image.new("RGBA", (181, 63), (0, 0, 0, 255)).save(manager_png, format="PNG")
    user_signature_service.save_signature(db_session, signer, "manager.png", manager_png.getvalue())
    with pymupdf.open() as paper:
        paper.new_page().insert_text((30, 30), "Synthetic IBAN evidence")
        attachment = staging_service.stage(paper.tobytes(), "iban.pdf")
    try:
        generated = document_service.generate_document(
            db_session,
            employee_id=employee.id,
            template_id=template_id,
            fields={
                "bank_name": "Synthetic Bank",
                "iban": "SYNTHETIC-IBAN",
                "items": [{"sno": "1", "description": "Synthetic Widget", "qty": "2"}],
            },
            manager_id=manager.id if template_id == "Material Request Form" else None,
            embed_signature={"employee": embed_employee},
            current_user=signer,
            attachments=(
                [
                    GenerateAttachmentSpec(
                        slot_key="iban_letter", source="staged", staged_token=attachment.token
                    )
                ]
                if template_id == "Salary Transfer Request"
                else None
            ),
            notify_employee=False,
        )
        book = db_session.get_one(Book, generated.book_id)
        version = book.versions[-1]
        original = settings.data_dir / book.doc_path
        original_images = _body_image_blobs(original)
        assert bool(inspect_signature_drawings(original)) is embed_employee
        if legacy:
            # Already-pending papers can predate both snapshots and role markers.
            version.fields = {k: v for k, v in version.fields.items() if k != "_signing"}
            source = DocxDocument(original)
            for docpr in source.element.body.iter(qn("wp:docPr")):
                docpr.attrib.pop("descr", None)
                docpr.set("name", "Picture")
            source.save(original)
            db_session.commit()
        original_bytes = original.read_bytes()
        if template_id == "Salary Transfer Request":
            # The paper, not today's profile image, is the signature authority.
            signature_core.employee_signature_path(settings.vault_dir, employee.id).unlink()
        book_service.submit_for_approval(
            db_session,
            book.id,
            submitted_by_user_id=signer.id,
            approver_user_id=signer.id,
            urgency="Normal",
            reviewer_user_ids=[],
        )
        signed = book_service.sign_book(
            db_session, book.id, user_id=signer.id, version_id=version.id
        )
        assert signed.approval_state == "approved"
        signed_path = next(
            (settings.data_dir / "output" / template_id.replace(" ", "_")).glob("*_signed.docx")
        )
        original_hashes = {hashlib.sha256(blob).hexdigest() for blob in original_images}
        signed_hashes = {
            hashlib.sha256(blob).hexdigest() for blob in _body_image_blobs(signed_path)
        }
        assert original_hashes <= signed_hashes, (
            "Manager approval lost original employee image bytes"
        )
        if template_id == "Salary Transfer Request":
            assert signed_path.read_bytes() == original_bytes
        else:
            drawings = inspect_signature_drawings(signed_path)
            assert any(d.role == "manager" for d in drawings)
            assert any(d.role == "employee" for d in drawings) is embed_employee
    finally:
        get_settings.cache_clear()


def test_approval_without_manager_slot_requires_original_document(
    db_session, tmp_path, monkeypatch
):
    """Missing source must not silently regenerate an employee-signature-free paper."""
    settings = Settings(data_dir=tmp_path, templates_dir=_TEMPLATES_DIR)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    db_session.add(BookCategory(id="HR", prefix="HR"))
    book = Book(category_id="HR", ref_number="HR-MISSING", subject="Synthetic salary transfer")
    version = BookVersion(
        book=book,
        version_no=1,
        template_id="Salary Transfer Request",
        fields={"bank_name": "Synthetic Bank"},
    )
    db_session.add(book)
    db_session.flush()
    with pytest.raises(AppError) as error:
        document_service.render_signed_artifact(
            db_session,
            version=version,
            signer_signature_path=str(tmp_path / "unused-manager.png"),
        )
    assert error.value.code == "SOURCE_DOCX_MISSING"
