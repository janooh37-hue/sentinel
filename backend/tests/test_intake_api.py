from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.extraction import ocr
from app.db.models import Book, BookCategory, User
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
