from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path

import pymupdf
import pytest
import zxingcpp
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import ValidationFailedError
from app.config import get_settings
from app.db.models import Book, BookCategory, BookVersion, ScanInbox, User
from app.db.session import get_db
from app.main import create_app
from app.services import book_service


def _barcode_pdf(ref: str, paper_date: str = "20260921") -> bytes:
    barcode = Image.fromarray(
        zxingcpp.create_barcode(
            f"{ref}+{paper_date}", zxingcpp.BarcodeFormat.Code39
        ).to_image(scale=4)
    )
    image = io.BytesIO()
    barcode.save(image, format="PNG")
    with pymupdf.open() as pdf:
        page = pdf.new_page(width=595, height=842)
        page.insert_image(pymupdf.Rect(40, 40, 500, 140), stream=image.getvalue())
        return pdf.tobytes()


def _book(
    db: Session,
    *,
    ref: str = "1/5/141",
    state: str = "awaiting_scan",
    template_id: str = "General Book",
) -> Book:
    category = BookCategory(id="GS", name_en="Records", prefix="GS")
    book = Book(
        category=category,
        ref_number=ref,
        approval_state=state,
        created_at=datetime(2026, 9, 21),
    )
    book.versions.append(
        BookVersion(
            version_no=1,
            template_id=template_id,
            fields={"date": "21-09-2026"},
            status=state,
        )
    )
    db.add(book)
    db.commit()
    return book


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _user(db: Session) -> User:
    user = User(
        email="scan-back@test.ae",
        password_hash="x",
        role="admin",
        status="active",
    )
    db.add(user)
    db.commit()
    return user


def test_matching_general_book_barcode_files_signed_copy(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book = _book(db_session)

    result = book_service.add_attachment(
        db_session,
        book.id,
        "signed.pdf",
        _barcode_pdf(book.ref_number),
        as_signed=True,
    )

    assert result.approval_state == "approved"
    assert result.versions[-1].signed_pdf_path is not None
    get_settings.cache_clear()


def test_general_book_barcode_must_match_selected_record_before_write(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book = _book(db_session)

    with pytest.raises(ValidationFailedError) as caught:
        book_service.add_attachment(
            db_session,
            book.id,
            "wrong.pdf",
            _barcode_pdf("1/5/999"),
            as_signed=True,
        )

    assert caught.value.code == "BOOK_BARCODE_REF_MISMATCH"
    assert not (tmp_path / "book_attachments").exists()
    get_settings.cache_clear()


def test_barcode_upload_rejects_general_book_not_awaiting_scan(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book = _book(db_session, state="pending")

    with pytest.raises(ValidationFailedError) as caught:
        book_service.add_attachment(
            db_session,
            book.id,
            "signed.pdf",
            _barcode_pdf(book.ref_number),
            as_signed=True,
        )

    assert caught.value.code == "BOOK_NOT_AWAITING_SCAN"
    assert not (tmp_path / "book_attachments").exists()
    get_settings.cache_clear()


def test_plain_upload_without_barcode_keeps_existing_attachment_behavior(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book = _book(db_session, state="none")
    with pymupdf.open() as pdf:
        pdf.new_page()
        raw = pdf.tobytes()

    result = book_service.add_attachment(db_session, book.id, "plain.pdf", raw)

    assert len(result.attachment_paths) == 1
    assert (tmp_path / result.attachment_paths[0]).exists()
    get_settings.cache_clear()



def test_scan_back_route_files_exact_awaiting_scan_match(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book = _book(api_db)

    response = _client(api_db, _user(api_db)).post(
        "/api/v1/books/scan-back",
        files={"file": ("signed.pdf", _barcode_pdf(book.ref_number), "application/pdf")},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "book_id": book.id,
        "ref_number": book.ref_number,
        "outcome": "filed",
    }
    assert api_db.get(Book, book.id).approval_state == "approved"
    get_settings.cache_clear()


def test_scan_back_route_parks_unknown_reference_for_confirmation(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    raw = _barcode_pdf("1/5/999")

    response = _client(api_db, _user(api_db)).post(
        "/api/v1/books/scan-back",
        files={"file": ("unknown.pdf", raw, "application/pdf")},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "book_id": None,
        "ref_number": "1/5/999",
        "outcome": "parked",
    }
    item = api_db.scalar(select(ScanInbox))
    assert item is not None
    assert item.source == "scan_back"
    assert item.state == "awaiting_confirmation"
    assert item.confidence_tier == "confirm"
    assert (tmp_path / item.file_path).read_bytes() == raw
    get_settings.cache_clear()


def test_scan_back_route_parks_paper_date_mismatch_with_hint(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book = _book(api_db)

    response = _client(api_db, _user(api_db)).post(
        "/api/v1/books/scan-back",
        files={
            "file": (
                "mismatch.pdf",
                _barcode_pdf(book.ref_number, "20260922"),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "book_id": book.id,
        "ref_number": book.ref_number,
        "outcome": "parked",
    }
    item = api_db.scalar(select(ScanInbox))
    assert item is not None
    assert item.fields["barcode_date_mismatch"] == "2026-09-22"
    assert item.confidence == 0.7
    get_settings.cache_clear()


def test_scan_back_route_rejects_record_not_awaiting_scan(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    book = _book(api_db, state="approved")

    response = _client(api_db, _user(api_db)).post(
        "/api/v1/books/scan-back",
        files={"file": ("signed.pdf", _barcode_pdf(book.ref_number), "application/pdf")},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "BOOK_NOT_AWAITING_SCAN"
    get_settings.cache_clear()


def test_scan_back_route_rejects_unreadable_barcode(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    with pymupdf.open() as pdf:
        pdf.new_page()
        raw = pdf.tobytes()

    response = _client(api_db, _user(api_db)).post(
        "/api/v1/books/scan-back",
        files={"file": ("blank.pdf", raw, "application/pdf")},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "BOOK_BARCODE_UNREADABLE"
    get_settings.cache_clear()
