from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.extraction import ocr
from app.db.models import Book, BookCategory, Employee, User
from app.db.session import get_db
from app.main import create_app

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "scan_triage"


def test_returned_form_response_is_exact(
    api_db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    category = BookCategory(
        id="GS",
        name_en="General Records",
        name_ar="السجلات العامة",
        prefix="GS",
    )
    book = Book(
        category=category,
        ref_number="GS-0042",
        approval_state="approved",
        subject="Synthetic returned form",
        employee_id=None,
        employee_name_snapshot="Synthetic Employee",
    )
    user = User(
        email="scan.operator@example.invalid",
        password_hash="not-a-login-secret",
        display_name="Synthetic Scan Operator",
        role="operator",
        status="active",
    )
    api_db.add_all([book, user])
    api_db.commit()
    api_db.refresh(book)
    writes_before = api_db.execute(text("SELECT total_changes()")).scalar_one()

    def reject_ocr(*_args, **_kwargs):
        raise AssertionError("searchable PDF unexpectedly invoked Tesseract")

    monkeypatch.setattr(ocr, "extract_text", reject_ocr)
    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", reject_ocr)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user

    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post(
            "/api/v1/intake",
            files={
                "file": (
                    "returned-form-text.pdf",
                    (FIXTURE_DIR / "returned-form-text.pdf").read_bytes(),
                    "application/pdf",
                )
            },
        )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "mode": "returned_form",
        "book_id": book.id,
        "ref_number": "GS-0042",
        "approval_state": "approved",
        "category": "General Records",
        "subject": "Synthetic returned form",
        "employee_id": None,
        "employee_name": "Synthetic Employee",
    }
    api_db.flush()
    assert api_db.execute(text("SELECT total_changes()")).scalar_one() == writes_before


def test_external_multisignal_response_is_exact(
    api_db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    employee = Employee(
        id="G-FIX-1",
        name_en="LAYLA HASSAN",
        name_ar="ليلى حسن",
        uae_id_no="784-1990-1234567-1",
    )
    user = User(
        email="external.scan.operator@example.invalid",
        password_hash="not-a-login-secret",
        display_name="Synthetic External Scan Operator",
        role="operator",
        status="active",
    )
    api_db.add_all([employee, user])
    api_db.commit()
    writes_before = api_db.execute(text("SELECT total_changes()")).scalar_one()

    def reject_ocr(*_args, **_kwargs):
        raise AssertionError("searchable PDF unexpectedly invoked Tesseract")

    monkeypatch.setattr(ocr, "extract_text", reject_ocr)
    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", reject_ocr)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user

    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post(
            "/api/v1/intake",
            files={
                "file": (
                    "external-multi-signal.pdf",
                    (FIXTURE_DIR / "external-multi-signal.pdf").read_bytes(),
                    "application/pdf",
                )
            },
        )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "mode": "external",
        "document_type": "emirates_id",
        "document_type_confidence": 0.9,
        "alternatives": ["bank_iban"],
        "extraction": [
            {
                "key": "uae_id_no",
                "value": "784-1990-1234567-1",
                "confidence": 0.97,
                "source_snippet": "784-1990-1234567-1",
            },
            {
                "key": "name_en",
                "value": "LAYLA HASSAN",
                "confidence": 0.6,
                "source_snippet": "Name: LAYLA HASSAN",
            },
            {
                "key": "name_ar",
                "value": "ليلى حسن",
                "confidence": 0.6,
                "source_snippet": "الاسم: ليلى حسن",
            },
            {
                "key": "expiry",
                "value": "2030-12-31",
                "confidence": 0.9,
                "source_snippet": "Expiry Date: 31/12/2030",
            },
        ],
        "matched_employee_id": "G-FIX-1",
        "match_score": 1.0,
        "matched_employee_name_en": "LAYLA HASSAN",
        "matched_employee_name_ar": "ليلى حسن",
        "route_kind": "employee",
        "route_form_slug": None,
    }
    api_db.flush()
    assert api_db.execute(text("SELECT total_changes()")).scalar_one() == writes_before


@pytest.fixture(autouse=True)
def prevent_real_ocr(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked():
        raise AssertionError("HTTP scan tests must not resolve real Tesseract")

    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", blocked)


@pytest.mark.parametrize(
    "route,expected_status", [("/api/v1/intake", 200), ("/api/v1/extractions", 503)]
)
def test_qr_survives_unavailable_ocr_only_for_intake(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, route: str, expected_status: int
) -> None:
    from sqlalchemy import func, select

    from app.db.models import DocumentExtraction

    book = Book(
        category=BookCategory(id="GS", name_en="Records", prefix="GS"),
        ref_number="GS-0042",
        approval_state="approved",
    )
    user = User(
        email="qr.scan@example.invalid", password_hash="synthetic", role="operator", status="active"
    )
    api_db.add_all([book, user])
    api_db.commit()

    def unavailable(_image):
        raise ocr.OcrUnavailableError("Synthetic OCR unavailable")

    monkeypatch.setattr(ocr, "extract_text", unavailable)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        response = client.post(
            route,
            files={
                "file": (
                    "synthetic.png",
                    (FIXTURE_DIR / "returned-form-qr.png").read_bytes(),
                    "image/png",
                )
            },
        )
    assert response.status_code == expected_status, response.text
    if expected_status == 200:
        assert response.json() == {
            "mode": "returned_form",
            "book_id": book.id,
            "ref_number": "GS-0042",
            "approval_state": "approved",
            "category": "Records",
            "subject": None,
            "employee_id": None,
            "employee_name": None,
        }
    else:
        assert response.json()["error"]["code"] == "HTTP_503"
        assert response.json()["error"]["message"] == "Synthetic OCR unavailable"
    api_db.flush()
    assert api_db.scalar(select(func.count()).select_from(DocumentExtraction)) == 0


@pytest.mark.parametrize("route", ["/api/v1/intake", "/api/v1/extractions"])
def test_unavailable_ocr_without_qr_retains_503_and_creates_no_extraction(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, route: str
) -> None:
    from sqlalchemy import func, select

    from app.db.models import DocumentExtraction

    user = User(
        email="no-qr.scan@example.invalid",
        password_hash="synthetic",
        role="operator",
        status="active",
    )
    api_db.add(user)
    api_db.commit()

    def unavailable(_image):
        raise ocr.OcrUnavailableError("Synthetic missing language pack")

    monkeypatch.setattr(ocr, "extract_text", unavailable)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        response = client.post(
            route,
            files={
                "file": ("blank.png", (FIXTURE_DIR / "blank-valid.png").read_bytes(), "image/png")
            },
        )
    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "HTTP_503"
    assert response.json()["error"]["message"] == "Synthetic missing language pack"
    api_db.flush()
    assert api_db.scalar(select(func.count()).select_from(DocumentExtraction)) == 0


@pytest.mark.parametrize("route", ["/api/v1/intake", "/api/v1/extractions"])
@pytest.mark.parametrize(
    "filename,message",
    [
        ("malformed.bin", "The uploaded file is not a readable image."),
        ("malformed.pdf", "The uploaded PDF is not readable."),
    ],
)
def test_malformed_upload_retains_error_and_creates_no_extraction(
    api_db: Session, route: str, filename: str, message: str
) -> None:
    from sqlalchemy import func, select

    from app.db.models import DocumentExtraction

    user = User(
        email="bad.scan@example.invalid",
        password_hash="synthetic",
        role="operator",
        status="active",
    )
    api_db.add(user)
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        response = client.post(
            route,
            files={
                "file": (
                    filename,
                    (FIXTURE_DIR / filename).read_bytes(),
                    "application/octet-stream",
                )
            },
        )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "INVALID_IMAGE"
    assert response.json()["error"]["message"] == message
    api_db.flush()
    assert api_db.scalar(select(func.count()).select_from(DocumentExtraction)) == 0


@pytest.mark.parametrize(
    "route,code",
    [
        ("/api/v1/intake", "INTAKE_FILE_TOO_LARGE"),
        ("/api/v1/extractions", "EXTRACTION_FILE_TOO_LARGE"),
    ],
)
def test_upload_limit_rejects_before_reading_document(
    api_db: Session, route: str, code: str
) -> None:
    from sqlalchemy import func, select

    from app.db.models import DocumentExtraction
    from app.services.vault_service import MAX_UPLOAD_BYTES

    user = User(
        email="large.scan@example.invalid",
        password_hash="synthetic",
        role="operator",
        status="active",
    )
    api_db.add(user)
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        response = client.post(
            route,
            files={
                "file": ("oversize.bin", b"x" * (MAX_UPLOAD_BYTES + 1), "application/octet-stream")
            },
        )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["message"] == "File exceeds 26214400 bytes"
    assert response.json()["error"]["details"] == {"max_bytes": 26214400}
    api_db.flush()
    assert api_db.scalar(select(func.count()).select_from(DocumentExtraction)) == 0
