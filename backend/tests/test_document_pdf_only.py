from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.api.v1.documents import DocumentRead, download_document
from app.db.models import Document, User


def test_document_read_accepts_pdf_only_row() -> None:
    row = Document(
        id=1,
        employee_id=None,
        template_id="Inmate Conduct Violations",
        ref_number="NAT-0001",
        docx_path=None,
        pdf_path="book_attachments/1/original-v1.pdf",
        created_at=datetime(2026, 8, 10, 9, 0),
        submission_id="submission",
        role="primary",
    )

    item = DocumentRead.model_validate(row)

    assert item.docx_path is None


def test_pdf_only_document_rejects_docx_download(
    db_session: Session,
    admin_user: User,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()
    row = Document(
        employee_id=None,
        template_id="Inmate Conduct Violations",
        ref_number="NAT-0001",
        docx_path=None,
        pdf_path="book_attachments/1/original-v1.pdf",
        submission_id="submission",
        role="primary",
    )
    db_session.add(row)
    db_session.commit()

    with pytest.raises(NotFoundError) as exc:
        download_document(row.id, db_session, admin_user, "docx", False, None)

    assert exc.value.code == "DOCX_NOT_AVAILABLE"
    get_settings.cache_clear()
