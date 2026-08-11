from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import fitz
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.config import get_settings
from app.core.extraction.ocr import qr_refs_from_bytes
from app.db.models import (
    AuditLog,
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    CorrespondenceCategory,
    CorrespondenceRule,
    Document,
    LedgerEntry,
    User,
    Violation,
)
from app.services import approved_import_service, book_service


def _pdf_bytes() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Approved report source")
    data = doc.tobytes()
    doc.close()
    return data


def _prepare(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    user: User,
) -> str:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    db.add(BookCategory(id="NAT", prefix="NAT"))
    category = CorrespondenceCategory(
        key="gov_nat",
        name_en="Government / NAT",
        name_ar="حكومي / الخدمة الوطنية",
        sort=40,
        system=True,
    )
    db.add(category)
    db.flush()
    db.add(
        CorrespondenceRule(
            trigger="document_generated",
            condition_json={"category": "NAT", "template_id": "Inmate Conduct Violations"},
            category_id=category.id,
            enabled=True,
            sort=20,
        )
    )
    db.commit()
    monkeypatch.setattr(
        approved_import_service,
        "text_from_pdf",
        lambda _data: "Date: 10/08/2026\nInmate Name: Ali Hassan\nViolation details",
    )
    return approved_import_service.inspect_upload(
        owner_user_id=user.id,
        filename="approved.pdf",
        data=_pdf_bytes(),
    ).token


def _commit(db: Session, user: User, token: str):
    return approved_import_service.commit_approved_import(
        db,
        owner=user,
        token=token,
        report_date=date(2026, 8, 10),
        inmate_names=["Ali Hassan", "Omar Saleh"],
        subject="Inmate Conduct Violations - Ali Hassan, Omar Saleh",
    )


def test_commit_creates_one_approved_searchable_record_without_violation_row(
    db_session: Session,
    admin_user: User,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    token = _prepare(db_session, monkeypatch, tmp_path, admin_user)

    result = _commit(db_session, admin_user, token)

    book = db_session.get(Book, result.book_id)
    document = db_session.get(Document, result.doc_id)
    version = db_session.scalar(select(BookVersion).where(BookVersion.book_id == book.id))
    assert result.ref_number == "NAT-0001"
    assert book.category_id == "NAT"
    assert book.approval_state == "approved"
    assert book.submitted_by_user_id == admin_user.id
    assert "Violation details" in book.search_text
    assert "2026-08-10" in book.search_text
    assert "Ali Hassan" in book.search_text
    assert "Omar Saleh" in book.search_text
    assert "Inmate Conduct Violations - Ali Hassan, Omar Saleh" in book.search_text
    assert document.docx_path is None
    assert document.pdf_path == book.doc_path
    assert version.signed_pdf_path is None
    assert version.document_id == document.id
    assert version.template_id == "Inmate Conduct Violations"
    assert version.status == "approved"
    assert version.signed_by_user_id is None
    assert version.signed_at is None
    assert version.fields == {
        "report_date": "2026-08-10",
        "inmate_names": ["Ali Hassan", "Omar Saleh"],
        "subject": "Inmate Conduct Violations - Ali Hassan, Omar Saleh",
        "imported_approved": True,
    }

    stamped = (tmp_path / document.pdf_path).read_bytes()
    with fitz.open(stream=stamped, filetype="pdf") as pdf:
        assert "Ref: NAT-0001" in pdf[0].get_text()
    assert qr_refs_from_bytes(stamped) == ["NAT-0001"]
    with pytest.raises(ValidationFailedError) as unfile:
        book_service.unfile_signed_copy(db_session, book.id, user=admin_user)
    assert unfile.value.code == "NO_SIGNED_COPY"
    assert (tmp_path / document.pdf_path).is_file()
    assert book_service.is_document_signed_locked(db_session, document.id) == (
        True,
        document.pdf_path,
    )
    assert db_session.scalar(select(func.count(Violation.id))) == 0
    assert db_session.scalar(select(func.count(BookApprovalStep.id))) == 0
    assert db_session.scalar(select(func.count(LedgerEntry.id))) == 1
    audit = db_session.scalar(select(AuditLog))
    assert audit.action == "approved_violation_imported"
    assert json.loads(audit.payload)["book_id"] == book.id
    assert not (tmp_path / "staged_approved_imports" / token).exists()
    assert not (tmp_path / "staged_approved_imports" / f"{token}.claimed").exists()


def test_commit_consumes_token_exactly_once(
    db_session: Session,
    admin_user: User,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    token = _prepare(db_session, monkeypatch, tmp_path, admin_user)
    _commit(db_session, admin_user, token)

    with pytest.raises(approved_import_service.StagedApprovedImportError):
        _commit(db_session, admin_user, token)

    assert db_session.scalar(select(func.count(Book.id))) == 1
    assert db_session.scalar(select(func.count(Document.id))) == 1


def test_failed_commit_rolls_back_rows_file_and_reference_then_allows_retry(
    db_session: Session,
    admin_user: User,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    token = _prepare(db_session, monkeypatch, tmp_path, admin_user)
    real_log_event = approved_import_service.correspondence_service.log_event
    monkeypatch.setattr(
        approved_import_service.correspondence_service,
        "log_event",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("write failed")),
    )

    with pytest.raises(RuntimeError, match="write failed"):
        _commit(db_session, admin_user, token)

    assert db_session.scalar(select(func.count(Book.id))) == 0
    assert db_session.scalar(select(func.count(Document.id))) == 0
    assert list(tmp_path.glob("book_attachments/**/*.pdf")) == []
    assert (tmp_path / "staged_approved_imports" / token).is_dir()

    monkeypatch.setattr(approved_import_service.correspondence_service, "log_event", real_log_event)
    result = _commit(db_session, admin_user, token)
    assert result.ref_number == "NAT-0001"


def test_existing_final_file_survives_file_exists_failure(
    db_session: Session,
    admin_user: User,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    token = _prepare(db_session, monkeypatch, tmp_path, admin_user)
    final_path = tmp_path / "book_attachments" / "1" / "approved-v1.pdf"
    final_path.parent.mkdir(parents=True)
    original = b"pre-existing final file"
    final_path.write_bytes(original)

    with pytest.raises(approved_import_service.StagedApprovedImportError) as exc:
        _commit(db_session, admin_user, token)

    assert exc.value.code == "APPROVED_IMPORT_FILE_EXISTS"
    assert final_path.read_bytes() == original
