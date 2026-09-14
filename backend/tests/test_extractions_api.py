from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.extraction import ocr
from app.db.models import DocumentExtraction, Employee, User
from app.db.session import get_db
from app.main import create_app

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "scan_triage"


@pytest.fixture(autouse=True)
def prevent_real_ocr(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked():
        raise AssertionError("HTTP extraction tests must not resolve real Tesseract")

    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", blocked)


def test_external_extraction_response_and_persistence_are_exact(
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

    def reject_ocr(*_args, **_kwargs):
        raise AssertionError("searchable PDF unexpectedly invoked Tesseract")

    monkeypatch.setattr(ocr, "extract_text", reject_ocr)
    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", reject_ocr)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user

    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post(
            "/api/v1/extractions",
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
        "id": 1,
        "document_type": "emirates_id",
        "document_type_confidence": 0.9,
        "alternatives": ["bank_iban"],
        "fields": [
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
    }
    api_db.flush()
    assert api_db.scalar(select(func.count()).select_from(DocumentExtraction)) == 1
    row = api_db.scalar(select(DocumentExtraction))
    assert row is not None
    assert (
        row.raw_text
        == "Resident Identity Card\n784-1990-1234567-1\nName: LAYLA HASSAN\nالاسم: ليلى حسن\nIBAN AE070331234567890123456\nExpiry Date: 31/12/2030\n"  # noqa: RUF001 — literal Arabic text
    )
    assert row.fields == {
        "uae_id_no": "784-1990-1234567-1",
        "name_en": "LAYLA HASSAN",
        "name_ar": "ليلى حسن",
        "expiry": "2030-12-31",
    }
    assert row.employee_id == "G-FIX-1"
    assert row.status == "needs_review"
