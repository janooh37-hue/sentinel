from __future__ import annotations

import hashlib
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core.extraction import ocr
from app.db.models import Book, BookCategory, BookVersion, Employee, ScanInbox, User, VaultFile
from app.services import scan_inbox_service
from app.services.document_reader import DocumentRead

_FIXTURES = Path(__file__).parent / "fixtures" / "scan_triage"


@pytest.fixture(autouse=True)
def _forbid_unexpected_tesseract(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked() -> str:
        raise AssertionError("this test must not invoke Tesseract")

    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", blocked)


@pytest.fixture()
def isolated_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _user(db: Session, *, email: str = "scan-inbox-owner@test.ae") -> User:
    user = User(
        email=email,
        password_hash="x",
        role="operator",
        status="active",
    )
    db.add(user)
    db.flush()
    return user


def _approved_book(db: Session) -> Book:
    db.add(
        BookCategory(
            id="GS",
            name_en="General Services",
            name_ar="الخدمات العامة",
            prefix="GS",
        )
    )
    book = Book(
        category_id="GS",
        ref_number="GS-0042",
        subject="Synthetic returned form",
        approval_state="approved",
        attachment_paths=[],
    )
    db.add(book)
    db.flush()
    return book


def _awaiting_scan_book(db: Session) -> Book:
    book = _approved_book(db)
    book.approval_state = "awaiting_scan"
    db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            trigger="initial",
            status="awaiting_scan",
        )
    )
    db.flush()
    return book


def test_drain_exact_live_book_preserves_row_and_file_effects(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    owner = _user(db_session)
    book = _approved_book(db_session)
    fixture_bytes = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    source_rel = "scan_inbox/returned-form-text.pdf"
    source = isolated_data_dir / source_rel
    source.parent.mkdir(parents=True)
    source.write_bytes(fixture_bytes)

    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=owner.id,
        rel_path=source_rel,
        filename="returned-form-text.pdf",
        data=fixture_bytes,
        is_inline=False,
    )

    assert item is not None
    assert item.state == "pending_ocr"
    assert item.attempts == 0
    db_session.commit()

    assert scan_inbox_service.drain_pending(db_session) == 1
    resolved_at = item.resolved_at
    db_session.rollback()
    db_session.expire_all()

    stored = db_session.get(ScanInbox, item.id)
    assert stored is not None
    expected_attachment = f"book_attachments/{book.id}/returned-form-text.pdf"
    assert {
        "source": stored.source,
        "owner_user_id": stored.owner_user_id,
        "ledger_entry_id": stored.ledger_entry_id,
        "file_path": stored.file_path,
        "filename": stored.filename,
        "content_hash": stored.content_hash,
        "state": stored.state,
        "document_type": stored.document_type,
        "fields": stored.fields,
        "raw_text": stored.raw_text,
        "confidence": stored.confidence,
        "qr_refs": stored.qr_refs,
        "proposed_route": stored.proposed_route,
        "proposed_book_id": stored.proposed_book_id,
        "proposed_ref": stored.proposed_ref,
        "proposed_employee_id": stored.proposed_employee_id,
        "match_score": stored.match_score,
        "confidence_tier": stored.confidence_tier,
        "model_version": stored.model_version,
        "attempts": stored.attempts,
        "candidates": stored.candidates,
        "undo_token": stored.undo_token,
        "resolved_by": stored.resolved_by,
        "resolution": stored.resolution,
        "error_detail": stored.error_detail,
    } == {
        "source": "email_attachment",
        "owner_user_id": owner.id,
        "ledger_entry_id": None,
        "file_path": source_rel,
        "filename": "returned-form-text.pdf",
        "content_hash": hashlib.sha256(fixture_bytes).hexdigest(),
        "state": "auto_filed",
        "document_type": "returned_form",
        "fields": {},
        "raw_text": "Synthetic returned form\nRef: GS-0042\n",
        "confidence": 1.0,
        "qr_refs": [],
        "proposed_route": "book_attach",
        "proposed_book_id": book.id,
        "proposed_ref": "GS-0042",
        "proposed_employee_id": None,
        "match_score": 0.0,
        "confidence_tier": "auto",
        "model_version": "tesseract-v1",
        "attempts": 1,
        "candidates": [],
        "undo_token": f"book:{book.id}:{expected_attachment}",
        "resolved_by": None,
        "resolution": "auto_filed",
        "error_detail": None,
    }
    assert stored.resolved_at == resolved_at
    assert stored.resolved_at is not None

    persisted_book = db_session.get(Book, book.id)
    assert persisted_book is not None
    assert persisted_book.attachment_paths == [expected_attachment]
    assert (isolated_data_dir / expected_attachment).read_bytes() == fixture_bytes
    assert source.read_bytes() == fixture_bytes


def test_drain_exact_awaiting_scan_book_requires_confirmation_without_filing(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    owner = _user(db_session)
    book = _awaiting_scan_book(db_session)
    fixture_bytes = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    source_rel = "scan_inbox/awaiting-scan-returned-form.pdf"
    source = isolated_data_dir / source_rel
    source.parent.mkdir(parents=True)
    source.write_bytes(fixture_bytes)
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=owner.id,
        rel_path=source_rel,
        filename="awaiting-scan-returned-form.pdf",
        data=fixture_bytes,
        is_inline=False,
    )
    assert item is not None
    db_session.commit()

    assert scan_inbox_service.drain_pending(db_session) == 1
    db_session.rollback()
    db_session.expire_all()

    stored = db_session.get(ScanInbox, item.id)
    assert stored is not None
    assert {
        "state": stored.state,
        "document_type": stored.document_type,
        "raw_text": stored.raw_text,
        "confidence": stored.confidence,
        "qr_refs": stored.qr_refs,
        "proposed_route": stored.proposed_route,
        "proposed_book_id": stored.proposed_book_id,
        "proposed_ref": stored.proposed_ref,
        "confidence_tier": stored.confidence_tier,
        "attempts": stored.attempts,
        "undo_token": stored.undo_token,
        "resolved_at": stored.resolved_at,
        "resolution": stored.resolution,
        "error_detail": stored.error_detail,
    } == {
        "state": "awaiting_confirmation",
        "document_type": "returned_form",
        "raw_text": "Synthetic returned form\nRef: GS-0042\n",
        "confidence": 0.7,
        "qr_refs": [],
        "proposed_route": "book_attach",
        "proposed_book_id": book.id,
        "proposed_ref": "GS-0042",
        "confidence_tier": "confirm",
        "attempts": 1,
        "undo_token": None,
        "resolved_at": None,
        "resolution": None,
        "error_detail": None,
    }
    persisted_book = db_session.get(Book, book.id)
    assert persisted_book is not None
    assert persisted_book.approval_state == "awaiting_scan"
    assert persisted_book.attachment_paths == []
    assert persisted_book.versions[-1].status == "awaiting_scan"
    assert persisted_book.versions[-1].signed_pdf_path is None
    assert not (isolated_data_dir / "book_attachments" / str(book.id)).exists()
    assert source.read_bytes() == fixture_bytes


def test_confirm_awaiting_scan_book_files_signed_copy_and_resolves_item(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    owner = _user(db_session)
    book = _awaiting_scan_book(db_session)
    fixture_bytes = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    source_rel = "scan_inbox/confirmed-returned-form.pdf"
    source = isolated_data_dir / source_rel
    source.parent.mkdir(parents=True)
    source.write_bytes(fixture_bytes)
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=owner.id,
        rel_path=source_rel,
        filename="confirmed-returned-form.pdf",
        data=fixture_bytes,
        is_inline=False,
    )
    assert item is not None
    db_session.commit()
    assert scan_inbox_service.drain_pending(db_session) == 1
    assert item.state == "awaiting_confirmation"

    confirmed = scan_inbox_service.confirm(db_session, item.id, user=owner)
    resolved_at = confirmed.resolved_at
    db_session.rollback()
    db_session.expire_all()

    stored = db_session.get(ScanInbox, item.id)
    assert stored is not None
    assert {
        "state": stored.state,
        "resolution": stored.resolution,
        "resolved_by": stored.resolved_by,
        "resolved_at": stored.resolved_at,
        "undo_token": stored.undo_token,
        "error_detail": stored.error_detail,
    } == {
        "state": "filed",
        "resolution": "filed",
        "resolved_by": owner.id,
        "resolved_at": resolved_at,
        "undo_token": None,
        "error_detail": None,
    }
    assert stored.resolved_at is not None

    persisted_book = db_session.get(Book, book.id)
    assert persisted_book is not None
    version = persisted_book.versions[-1]
    expected_signed = f"book_attachments/{book.id}/signed-v1.pdf"
    assert persisted_book.approval_state == "approved"
    assert persisted_book.attachment_paths == []
    assert version.status == "approved"
    assert version.signed_base_pdf_path == expected_signed
    assert version.signed_pdf_path == expected_signed
    assert version.signed_by_user_id == owner.id
    assert version.signed_at is not None
    assert (isolated_data_dir / expected_signed).read_bytes() == fixture_bytes
    assert source.read_bytes() == fixture_bytes


def test_undo_auto_filed_book_detaches_exact_artifact_and_reopens_item(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    owner = _user(db_session)
    book = _approved_book(db_session)
    fixture_bytes = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    source_rel = "scan_inbox/undo-returned-form.pdf"
    source = isolated_data_dir / source_rel
    source.parent.mkdir(parents=True)
    source.write_bytes(fixture_bytes)
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=owner.id,
        rel_path=source_rel,
        filename="undo-returned-form.pdf",
        data=fixture_bytes,
        is_inline=False,
    )
    assert item is not None
    db_session.commit()
    assert scan_inbox_service.drain_pending(db_session) == 1
    filed_path = f"book_attachments/{book.id}/undo-returned-form.pdf"
    assert item.state == "auto_filed"
    assert item.undo_token == f"book:{book.id}:{filed_path}"
    assert (isolated_data_dir / filed_path).read_bytes() == fixture_bytes

    reopened = scan_inbox_service.undo(db_session, item.id, user=owner)
    db_session.rollback()
    db_session.expire_all()

    stored = db_session.get(ScanInbox, item.id)
    assert stored is not None
    assert reopened.id == stored.id
    assert {
        "state": stored.state,
        "resolution": stored.resolution,
        "resolved_by": stored.resolved_by,
        "resolved_at": stored.resolved_at,
        "undo_token": stored.undo_token,
        "proposed_route": stored.proposed_route,
        "proposed_book_id": stored.proposed_book_id,
        "proposed_ref": stored.proposed_ref,
    } == {
        "state": "awaiting_confirmation",
        "resolution": None,
        "resolved_by": None,
        "resolved_at": None,
        "undo_token": None,
        "proposed_route": "book_attach",
        "proposed_book_id": book.id,
        "proposed_ref": "GS-0042",
    }
    persisted_book = db_session.get(Book, book.id)
    assert persisted_book is not None
    assert persisted_book.attachment_paths == []
    assert not (isolated_data_dir / filed_path).exists()
    assert source.read_bytes() == fixture_bytes


def test_foreign_confirm_is_not_found_without_row_or_file_side_effects(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    owner = _user(db_session)
    foreign_user = _user(db_session, email="foreign-scan-operator@test.ae")
    book = _awaiting_scan_book(db_session)
    fixture_bytes = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    source_rel = "scan_inbox/foreign-confirm.pdf"
    source = isolated_data_dir / source_rel
    source.parent.mkdir(parents=True)
    source.write_bytes(fixture_bytes)
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=owner.id,
        rel_path=source_rel,
        filename="foreign-confirm.pdf",
        data=fixture_bytes,
        is_inline=False,
    )
    assert item is not None
    db_session.commit()
    assert scan_inbox_service.drain_pending(db_session) == 1
    assert item.state == "awaiting_confirmation"

    with pytest.raises(NotFoundError) as caught:
        scan_inbox_service.confirm(db_session, item.id, user=foreign_user)

    assert caught.value.code == "SCAN_ITEM_NOT_FOUND"
    assert caught.value.message == f"No scan-inbox item {item.id}"
    assert caught.value.http_status == 404
    db_session.flush()
    db_session.expire_all()
    stored = db_session.get(ScanInbox, item.id)
    assert stored is not None
    assert stored.state == "awaiting_confirmation"
    assert stored.resolution is None
    assert stored.resolved_at is None
    assert stored.resolved_by is None
    assert stored.undo_token is None
    persisted_book = db_session.get(Book, book.id)
    assert persisted_book is not None
    assert persisted_book.approval_state == "awaiting_scan"
    assert persisted_book.attachment_paths == []
    assert persisted_book.versions[-1].signed_pdf_path is None
    assert not (isolated_data_dir / "book_attachments" / str(book.id)).exists()
    assert source.read_bytes() == fixture_bytes


def test_abs_file_path_rejects_a_scan_path_outside_the_data_root(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    outside = isolated_data_dir.parent / f"{isolated_data_dir.name}-outside.pdf"
    outside.write_bytes(b"%PDF-1.4 synthetic outside file")
    item = ScanInbox(
        source="upload",
        file_path=f"../{outside.name}",
        filename="outside.pdf",
        state="unrouted",
    )
    db_session.add(item)
    db_session.commit()

    with pytest.raises(NotFoundError) as caught:
        scan_inbox_service.abs_file_path(item)

    assert caught.value.code == "SCAN_FILE_OUTSIDE_ROOT"
    assert caught.value.message == f"scan file for {item.id} is outside the data root"
    assert caught.value.http_status == 404
    db_session.flush()
    db_session.refresh(item)
    assert item.state == "unrouted"
    assert item.resolution is None
    assert outside.read_bytes() == b"%PDF-1.4 synthetic outside file"


def test_drain_auto_files_each_pending_item_at_most_once(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    owner = _user(db_session)
    book = _approved_book(db_session)
    fixture_bytes = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    source_rel = "scan_inbox/at-most-once.pdf"
    source = isolated_data_dir / source_rel
    source.parent.mkdir(parents=True)
    source.write_bytes(fixture_bytes)
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=owner.id,
        rel_path=source_rel,
        filename="at-most-once.pdf",
        data=fixture_bytes,
        is_inline=False,
    )
    assert item is not None
    db_session.commit()

    assert scan_inbox_service.drain_pending(db_session) == 1
    first_token = item.undo_token
    assert scan_inbox_service.drain_pending(db_session) == 0
    db_session.rollback()
    db_session.expire_all()

    stored = db_session.get(ScanInbox, item.id)
    assert stored is not None
    expected_attachment = f"book_attachments/{book.id}/at-most-once.pdf"
    assert stored.state == "auto_filed"
    assert stored.attempts == 1
    assert stored.undo_token == first_token
    assert stored.undo_token == f"book:{book.id}:{expected_attachment}"
    persisted_book = db_session.get(Book, book.id)
    assert persisted_book is not None
    assert persisted_book.attachment_paths == [expected_attachment]
    attachment_dir = isolated_data_dir / "book_attachments" / str(book.id)
    assert [path.name for path in attachment_dir.iterdir()] == ["at-most-once.pdf"]
    assert (isolated_data_dir / expected_attachment).read_bytes() == fixture_bytes
    assert source.read_bytes() == fixture_bytes


def test_drain_unavailable_ocr_commits_two_retries_then_terminal_error(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    source = isolated_data_dir / "unavailable.png"
    source.write_bytes(b"synthetic OCR input")
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=None,
        rel_path=source.name,
        filename=source.name,
        data=source.read_bytes(),
        is_inline=False,
    )
    assert item is not None
    db_session.commit()

    def unavailable(raw: bytes) -> DocumentRead:
        assert raw == b"synthetic OCR input"
        return DocumentRead(
            text="",
            text_source="unavailable",
            unavailable_reason="synthetic missing language pack",
        )

    for attempt, state, error in [
        (1, "pending_ocr", None),
        (2, "pending_ocr", None),
        (3, "error", "OCR unavailable"),
    ]:
        assert scan_inbox_service.drain_pending(db_session, reader=unavailable) == 1
        db_session.rollback()
        stored = scan_inbox_service.get_item(db_session, item.id, user=None)
        assert (stored.attempts, stored.state, stored.error_detail) == (attempt, state, error)
        assert stored.document_type is None
        assert stored.proposed_book_id is None
        assert stored.proposed_employee_id is None
        assert stored.undo_token is None
        assert stored.resolution is None
    assert scan_inbox_service.drain_pending(db_session, reader=unavailable) == 0
    assert source.read_bytes() == b"synthetic OCR input"
    assert not (isolated_data_dir / "book_attachments").exists()
    assert not any(path.is_file() for path in (isolated_data_dir / "vault").rglob("*"))


def test_drain_invalid_image_is_terminal_after_one_attempt(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    source = isolated_data_dir / "invalid.png"
    source.write_bytes(b"not a readable image")
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=None,
        rel_path=source.name,
        filename=source.name,
        data=source.read_bytes(),
        is_inline=False,
    )
    assert item is not None
    db_session.commit()

    assert scan_inbox_service.drain_pending(db_session) == 1
    db_session.rollback()
    stored = scan_inbox_service.get_item(db_session, item.id, user=None)
    assert (stored.attempts, stored.state, stored.error_detail) == (
        1,
        "error",
        "The uploaded file is not a readable image.",
    )
    assert stored.document_type is None
    assert stored.undo_token is None
    assert stored.resolution is None
    assert scan_inbox_service.drain_pending(db_session) == 0
    assert source.read_bytes() == b"not a readable image"
    assert not (isolated_data_dir / "book_attachments").exists()
    assert not any(path.is_file() for path in (isolated_data_dir / "vault").rglob("*"))


def test_drain_unmatched_external_preserves_fields_candidates_and_zero_match_score(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    employee = Employee(id="NEAR-MISS", name_en="LAYLA AHMED")
    db_session.add(employee)
    source = isolated_data_dir / "external.pdf"
    raw = (_FIXTURES / "external-multi-signal.pdf").read_bytes()
    source.write_bytes(raw)
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=None,
        rel_path=source.name,
        filename=source.name,
        data=raw,
        is_inline=False,
    )
    assert item is not None
    db_session.commit()

    assert scan_inbox_service.drain_pending(db_session) == 1
    db_session.rollback()
    stored = scan_inbox_service.get_item(db_session, item.id, user=None)
    assert stored.state == "unrouted"
    assert stored.document_type == "emirates_id"
    assert stored.confidence == 0.9
    assert stored.confidence_tier == "manual"
    assert stored.proposed_route == "unknown"
    assert stored.proposed_employee_id is None
    assert stored.match_score == 0.0
    assert stored.fields == {
        "uae_id_no": "784-1990-1234567-1",
        "name_en": "LAYLA HASSAN",
        "name_ar": "ليلى حسن",
        "expiry": "2030-12-31",
    }
    assert stored.candidates == [
        {"employee_id": "NEAR-MISS", "name_en": "LAYLA AHMED", "name_ar": None, "score": 0.609}
    ]
    assert stored.raw_text == (
        "Resident Identity Card\n784-1990-1234567-1\nName: LAYLA HASSAN\n"
        "الاسم: ليلى حسن\nIBAN AE070331234567890123456\nExpiry Date: 31/12/2030\n"
    )
    assert stored.undo_token is None
    assert stored.resolution is None
    assert source.read_bytes() == raw
    assert not any(path.is_file() for path in (isolated_data_dir / "vault").rglob("*"))


def test_drain_rejects_outside_root_source_without_filing(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    book = _approved_book(db_session)
    outside = isolated_data_dir.parent / f"{isolated_data_dir.name}-outside.pdf"
    raw = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    outside.write_bytes(raw)
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=None,
        rel_path=f"../{outside.name}",
        filename="outside.pdf",
        data=raw,
        is_inline=False,
    )
    assert item is not None
    db_session.commit()

    assert scan_inbox_service.drain_pending(db_session) == 1
    db_session.rollback()
    stored = scan_inbox_service.get_item(db_session, item.id, user=None)
    assert (stored.attempts, stored.state, stored.error_detail) == (
        1,
        "error",
        f"scan file for {item.id} is outside the data root",
    )
    assert stored.undo_token is None
    assert stored.resolution is None
    db_session.refresh(book)
    assert book.attachment_paths == []
    assert outside.read_bytes() == raw
    assert not (isolated_data_dir / "book_attachments").exists()


@pytest.mark.parametrize("operation", ["confirm", "route_item"])
def test_operator_filing_rejects_outside_root_before_changes(
    db_session: Session,
    isolated_data_dir: Path,
    operation: str,
) -> None:
    owner = _user(db_session)
    book = _approved_book(db_session)
    outside = isolated_data_dir.parent / f"{isolated_data_dir.name}-outside.pdf"
    raw = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    outside.write_bytes(raw)
    item = ScanInbox(
        source="upload",
        owner_user_id=owner.id,
        file_path=f"../{outside.name}",
        filename="outside.pdf",
        state="awaiting_confirmation",
        proposed_route="book_attach" if operation == "confirm" else "unknown",
        proposed_book_id=book.id if operation == "confirm" else None,
    )
    db_session.add(item)
    db_session.commit()
    before_route = item.proposed_route
    before_book = item.proposed_book_id

    with pytest.raises(NotFoundError) as caught:
        if operation == "confirm":
            scan_inbox_service.confirm(db_session, item.id, user=owner)
        else:
            scan_inbox_service.route_item(db_session, item.id, user=owner, book_id=book.id)
    assert caught.value.code == "SCAN_FILE_OUTSIDE_ROOT"
    assert caught.value.http_status == 404
    db_session.flush()
    db_session.refresh(item)
    db_session.refresh(book)
    assert item.state == "awaiting_confirmation"
    assert item.proposed_route == before_route
    assert item.proposed_book_id == before_book
    assert item.undo_token is None
    assert item.resolution is None
    assert book.attachment_paths == []
    assert outside.read_bytes() == raw
    assert not (isolated_data_dir / "book_attachments").exists()


@pytest.mark.parametrize(
    "token",
    [None, "", "unknown:1", "book", "book:nope:scan.pdf", "book:1:", "vault:nope", "vault:0"],
)
def test_undo_rejects_missing_or_malformed_target_without_changes(
    db_session: Session,
    isolated_data_dir: Path,
    token: str | None,
) -> None:
    owner = _user(db_session)
    book = _approved_book(db_session)
    source = isolated_data_dir / "source.pdf"
    raw = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    source.write_bytes(raw)
    artifact = isolated_data_dir / "book_attachments" / str(book.id) / "scan.pdf"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(raw)
    book.attachment_paths = [artifact.relative_to(isolated_data_dir).as_posix()]
    item = ScanInbox(
        source="upload",
        owner_user_id=owner.id,
        file_path=source.name,
        filename=source.name,
        state="auto_filed",
        undo_token=token,
        resolution="auto_filed",
        proposed_route="book_attach",
        proposed_book_id=book.id,
    )
    db_session.add(item)
    db_session.commit()

    with pytest.raises(ValidationFailedError) as caught:
        scan_inbox_service.undo(db_session, item.id, user=owner)
    assert caught.value.code == "SCAN_BAD_STATE"
    assert caught.value.http_status == 422
    assert caught.value.message == "Scan item has no valid undo target."
    db_session.flush()
    db_session.refresh(item)
    db_session.refresh(book)
    assert item.state == "auto_filed"
    assert item.resolution == "auto_filed"
    assert item.undo_token == token
    assert book.attachment_paths == [artifact.relative_to(isolated_data_dir).as_posix()]
    assert artifact.read_bytes() == raw
    assert source.read_bytes() == raw


def test_drain_and_undo_exact_employee_document_preserve_vault_and_expiry_effects(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    owner = _user(db_session)
    employee = Employee(
        id="G-FIX-1",
        name_en="LAYLA HASSAN",
        name_ar="ليلى حسن",
        uae_id_no="784-1990-1234567-1",
        uae_id_expiry=date(2029, 1, 1),
    )
    db_session.add(employee)
    source = isolated_data_dir / "external.pdf"
    raw = (_FIXTURES / "external-multi-signal.pdf").read_bytes()
    source.write_bytes(raw)
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=owner.id,
        rel_path=source.name,
        filename=source.name,
        data=raw,
        is_inline=False,
    )
    assert item is not None
    db_session.commit()

    assert scan_inbox_service.drain_pending(db_session) == 1
    db_session.rollback()
    stored = scan_inbox_service.get_item(db_session, item.id, user=owner)
    assert stored.state == "auto_filed"
    assert stored.proposed_route == "employee_doc"
    assert stored.proposed_employee_id == "G-FIX-1"
    assert stored.confidence_tier == "auto"
    assert stored.match_score == 1.0
    assert stored.candidates == []
    assert stored.undo_token is not None and stored.undo_token.startswith("vault:")
    vault_id = int(stored.undo_token.split(":")[1])
    vault_file = db_session.get(VaultFile, vault_id)
    assert vault_file is not None
    assert vault_file.employee_id == "G-FIX-1"
    assert vault_file.kind == "uae_id"
    destination = isolated_data_dir / "vault" / vault_file.path
    assert destination.read_bytes() == raw
    db_session.refresh(employee)
    assert employee.uae_id_expiry == date(2029, 1, 1)

    scan_inbox_service.undo(db_session, item.id, user=owner)
    db_session.rollback()
    reopened = scan_inbox_service.get_item(db_session, item.id, user=owner)
    assert reopened.state == "awaiting_confirmation"
    assert reopened.undo_token is None
    assert reopened.resolution is None
    assert db_session.get(VaultFile, vault_id) is None
    assert not destination.exists()
    assert source.read_bytes() == raw
    db_session.refresh(employee)
    assert employee.uae_id_expiry == date(2029, 1, 1)


def test_drain_qr_only_files_once_when_ocr_is_unavailable(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    book = _approved_book(db_session)
    source = isolated_data_dir / "returned-form-qr.png"
    raw = (_FIXTURES / source.name).read_bytes()
    source.write_bytes(raw)
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=None,
        rel_path=source.name,
        filename=source.name,
        data=raw,
        is_inline=False,
    )
    assert item is not None
    db_session.commit()

    def reader(data: bytes) -> DocumentRead:
        assert data == raw
        return DocumentRead(
            text="",
            text_source="unavailable",
            qr_refs=("GS-0042",),
            unavailable_reason="synthetic OCR unavailable",
        )

    assert scan_inbox_service.drain_pending(db_session, reader=reader) == 1
    assert scan_inbox_service.drain_pending(db_session, reader=reader) == 0
    db_session.rollback()
    stored = scan_inbox_service.get_item(db_session, item.id, user=None)
    assert stored.state == "auto_filed"
    assert stored.attempts == 1
    assert stored.raw_text == ""
    assert stored.qr_refs == ["GS-0042"]
    assert stored.proposed_book_id == book.id
    assert stored.confidence_tier == "auto"
    assert stored.error_detail is None
    db_session.refresh(book)
    assert book.attachment_paths == [f"book_attachments/{book.id}/returned-form-qr.png"]
    assert (isolated_data_dir / book.attachment_paths[0]).read_bytes() == raw
    assert source.read_bytes() == raw


def test_drain_ambiguous_exact_books_stays_manual_without_artifacts(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    first = _approved_book(db_session)
    second = Book(
        category_id="GS",
        ref_number="GS-0043",
        subject="Another form",
        approval_state="approved",
        attachment_paths=[],
    )
    db_session.add(second)
    source = isolated_data_dir / "ambiguous.pdf"
    raw = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    source.write_bytes(raw)
    item = scan_inbox_service.enqueue_email_attachment(
        db_session,
        ledger_entry_id=None,
        owner_user_id=None,
        rel_path=source.name,
        filename=source.name,
        data=raw,
        is_inline=False,
    )
    assert item is not None
    db_session.commit()

    def reader(data: bytes) -> DocumentRead:
        assert data == raw
        return DocumentRead(text="Ref: GS-0042\nRef: GS-0043", text_source="ocr")

    assert scan_inbox_service.drain_pending(db_session, reader=reader) == 1
    db_session.rollback()
    stored = scan_inbox_service.get_item(db_session, item.id, user=None)
    assert stored.state == "unrouted"
    assert stored.confidence_tier == "manual"
    assert stored.proposed_route == "unknown"
    assert stored.proposed_book_id is None
    assert stored.proposed_ref is None
    assert stored.undo_token is None
    assert stored.resolution is None
    db_session.refresh(first)
    db_session.refresh(second)
    assert first.attachment_paths == second.attachment_paths == []
    assert not (isolated_data_dir / "book_attachments").exists()
    assert source.read_bytes() == raw


def test_drain_commits_containment_error_and_continues_to_next_item(
    db_session: Session,
    isolated_data_dir: Path,
) -> None:
    book = _approved_book(db_session)
    raw = (_FIXTURES / "returned-form-text.pdf").read_bytes()
    outside = isolated_data_dir.parent / f"{isolated_data_dir.name}-outside.pdf"
    outside.write_bytes(raw)
    source = isolated_data_dir / "valid.pdf"
    source.write_bytes(raw)
    rejected = ScanInbox(
        source="upload", file_path=f"../{outside.name}", filename="outside.pdf", state="pending_ocr"
    )
    valid = ScanInbox(
        source="upload", file_path=source.name, filename=source.name, state="pending_ocr"
    )
    db_session.add_all([rejected, valid])
    db_session.commit()

    assert scan_inbox_service.drain_pending(db_session) == 2
    db_session.rollback()
    assert scan_inbox_service.get_item(db_session, rejected.id, user=None).state == "error"
    assert scan_inbox_service.get_item(db_session, valid.id, user=None).state == "auto_filed"
    assert rejected.attempts == valid.attempts == 1
    assert rejected.error_detail == f"scan file for {rejected.id} is outside the data root"
    db_session.refresh(book)
    assert book.attachment_paths == [f"book_attachments/{book.id}/valid.pdf"]
    assert (isolated_data_dir / book.attachment_paths[0]).read_bytes() == raw
    assert outside.read_bytes() == source.read_bytes() == raw
