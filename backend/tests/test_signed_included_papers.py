from __future__ import annotations

import importlib
from pathlib import Path

import fitz
import pytest
from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.config import get_settings
from app.db.models import (
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Document,
    User,
)
from app.services import book_service, document_service


def _service():
    return importlib.import_module("app.services.included_papers_service")


def _pdf(path: Path, labels: list[str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    try:
        for label in labels:
            page = doc.new_page(width=300, height=400)
            page.insert_text((40, 80), label)
        doc.save(path)
    finally:
        doc.close()
    return path


def _texts(path: Path) -> list[str]:
    with fitz.open(path) as doc:
        return [page.get_text().strip() for page in doc]


def _record(db: Session, tmp_path: Path) -> tuple[Book, BookVersion, Document, User, Path]:
    creator = User(
        email="creator@example.ae",
        password_hash="x",
        role="operator",
        status="active",
    )
    db.add_all([creator, BookCategory(id="HR", prefix="HR")])
    db.flush()
    generated = _pdf(tmp_path / "generated.pdf", ["FORM", "PAPER"])
    paper = _pdf(tmp_path / "paper.pdf", ["PAPER"])
    companion = _pdf(tmp_path / "companion.pdf", ["COMPANION"])
    document = Document(
        template_id="General Book",
        ref_number="HR-1",
        docx_path="source.docx",
        pdf_path=generated.relative_to(tmp_path).as_posix(),
        submission_id="submission-1",
        role="primary",
    )
    db.add(document)
    db.flush()
    db.add(
        Document(
            template_id="Leave Undertaking",
            ref_number="HR-1",
            docx_path="companion.docx",
            pdf_path=companion.relative_to(tmp_path).as_posix(),
            submission_id="submission-1",
            role="companion",
        )
    )
    book = Book(
        category_id="HR",
        ref_number="HR-1",
        approval_state="pending",
        merged_attachment_paths=[
            {
                "path": paper.relative_to(tmp_path).as_posix(),
                "slot_key": "medical_certificate",
            }
        ],
    )
    db.add(book)
    db.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        document_id=document.id,
        template_id="General Book",
        fields={"subject": "Signed package"},
        status="pending",
        created_by_user_id=creator.id,
    )
    db.add(version)
    db.commit()
    return book, version, document, creator, paper


def test_in_app_signing_preserves_signed_base_then_appends_current_papers(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book, version, _document, _creator, _paper = _record(db_session, tmp_path)
    signed_form = _pdf(tmp_path / "signed-form.pdf", ["SIGNED-FORM"])

    published = _service().publish_signed_package(
        db_session,
        book,
        version,
        signed_form,
        physical_scan=False,
    )

    assert version.signed_base_pdf_path is not None
    assert version.signed_pdf_path == published
    assert version.signed_embedded_paper_ids == []
    assert _texts(tmp_path / version.signed_base_pdf_path) == ["SIGNED-FORM", "COMPANION"]
    assert _texts(tmp_path / version.signed_pdf_path) == [
        "SIGNED-FORM",
        "COMPANION",
        "PAPER",
    ]
    get_settings.cache_clear()


def test_first_physical_scan_snapshots_current_papers_as_embedded(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book, version, _document, _creator, _paper = _record(db_session, tmp_path)
    scan = _pdf(
        tmp_path / "book_attachments" / str(book.id) / "signed-v1.pdf",
        ["SCAN", "PAPER"],
    )

    published = _service().publish_signed_package(
        db_session,
        book,
        version,
        scan,
        physical_scan=True,
    )

    assert version.signed_base_pdf_path == scan.relative_to(tmp_path).as_posix()
    assert version.signed_pdf_path == published
    assert len(version.signed_embedded_paper_ids) == 1
    assert _texts(tmp_path / version.signed_pdf_path) == ["SCAN", "PAPER"]
    assert book.included_papers_revision == 1
    get_settings.cache_clear()


def test_scan_filing_and_replacement_republish_current_papers(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book, version, _document, creator, _paper = _record(db_session, tmp_path)
    first_scan = _pdf(tmp_path / "first-scan.pdf", ["SCAN-1", "PAPER"])

    book_service.add_attachment(
        db_session,
        book.id,
        first_scan.name,
        first_scan.read_bytes(),
        user=creator,
        as_signed=True,
    )
    db_session.refresh(version)
    first_paths = {
        tmp_path / str(version.signed_base_pdf_path),
        tmp_path / str(version.signed_pdf_path),
    }
    assert _texts(tmp_path / str(version.signed_base_pdf_path)) == ["SCAN-1", "PAPER"]
    assert _texts(tmp_path / str(version.signed_pdf_path)) == ["SCAN-1", "PAPER"]

    replacement = _pdf(tmp_path / "replacement.pdf", ["SCAN-2"])
    book_service.replace_signed_copy(
        db_session,
        book.id,
        replacement.name,
        replacement.read_bytes(),
        user=creator,
    )
    db_session.refresh(version)

    assert _texts(tmp_path / str(version.signed_base_pdf_path)) == ["SCAN-2"]
    assert _texts(tmp_path / str(version.signed_pdf_path)) == ["SCAN-2", "PAPER"]
    assert all(not path.exists() for path in first_paths)
    assert book.included_papers_revision == 2
    get_settings.cache_clear()


def test_in_app_sign_book_publishes_signed_base_and_current_papers(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book, version, _document, _creator, _paper = _record(db_session, tmp_path)
    signature = tmp_path / "signature.png"
    signature.write_bytes(b"signature")
    signer = User(
        email="signer@example.ae",
        password_hash="x",
        role="manager",
        status="active",
        signature_path=str(signature),
    )
    db_session.add(signer)
    db_session.flush()
    db_session.add(
        BookApprovalStep(
            book_id=book.id,
            version_id=version.id,
            step_order=1,
            stage_label="Signature",
            assignee_user_id=signer.id,
            kind="approver",
            state="pending",
        )
    )
    db_session.commit()
    signed_form = _pdf(tmp_path / "signed-form.pdf", ["SIGNED-FORM"])
    monkeypatch.setattr(
        document_service,
        "render_signed_pdf",
        lambda *_args, **_kwargs: str(signed_form),
    )

    signed = book_service.sign_book(db_session, book.id, user_id=signer.id)
    db_session.refresh(version)

    assert signed.approval_state == "approved"
    assert version.status == "approved"
    assert version.signed_base_pdf_path is not None
    assert version.signed_pdf_path is not None
    assert _texts(tmp_path / version.signed_base_pdf_path) == [
        "SIGNED-FORM",
        "COMPANION",
    ]
    assert _texts(tmp_path / version.signed_pdf_path) == [
        "SIGNED-FORM",
        "COMPANION",
        "PAPER",
    ]
    assert signed.included_papers_revision == 1
    get_settings.cache_clear()


def test_in_app_signing_refuses_docx_fallback_when_papers_are_included(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book, version, _document, _creator, _paper = _record(db_session, tmp_path)
    signature = tmp_path / "signature.png"
    signature.write_bytes(b"signature")
    signer = User(
        email="fallback-signer@example.ae",
        password_hash="x",
        role="manager",
        status="active",
        signature_path=str(signature),
    )
    db_session.add(signer)
    db_session.flush()
    step = BookApprovalStep(
        book_id=book.id,
        version_id=version.id,
        step_order=1,
        stage_label="Signature",
        assignee_user_id=signer.id,
        kind="approver",
        state="pending",
    )
    db_session.add(step)
    db_session.commit()
    signed_docx = tmp_path / "signed-fallback.docx"
    signed_docx.write_bytes(b"docx")
    monkeypatch.setattr(
        document_service,
        "render_signed_pdf",
        lambda *_args, **_kwargs: str(signed_docx),
    )

    with pytest.raises(ValidationFailedError) as error:
        book_service.sign_book(db_session, book.id, user_id=signer.id)

    assert error.value.code == "INCLUDED_PAPERS_SIGNED_PDF_REQUIRED"
    assert not signed_docx.exists()
    assert version.status == "pending"
    assert step.state == "pending"
    assert book.included_papers_revision == 0
    get_settings.cache_clear()
