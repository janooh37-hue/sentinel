from __future__ import annotations

from pathlib import Path

import fitz
import pytest
from sqlalchemy.orm import Session

from app.api.v1.documents import GenerateAttachmentSpec
from app.config import Settings, get_settings
from app.db.models import Book, BookCategory, Document, Employee, User
from app.services import document_service, staging_service


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


@pytest.fixture()
def generation_env(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> tuple[Session, Settings, User]:
    data_dir = tmp_path / "data"
    monkeypatch.setenv("GSSG_DATA_DIR", str(data_dir))
    get_settings.cache_clear()
    settings = Settings(data_dir=data_dir)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)

    def convert(docx_path: Path) -> Path:
        label = "COMPANION" if "LeaveUndertaking" in docx_path.name else "FORM"
        return _pdf(docx_path.with_suffix(".pdf"), [label])

    monkeypatch.setattr(document_service, "convert_docx_to_pdf", convert)
    db_session.add_all(
        [
            BookCategory(id="GS", prefix="GS"),
            BookCategory(id="HR", prefix="HR"),
            Employee(id="G-1001", name_en="Test Employee", name_ar="موظف اختبار"),
        ]
    )
    user = User(
        email="creator@example.ae",
        password_hash="x",
        role="operator",
        status="active",
        display_name="Record creator",
    )
    db_session.add(user)
    db_session.commit()
    return db_session, settings, user


def test_future_generation_preserves_fixed_base_and_normalizes_included_papers(
    generation_env: tuple[Session, Settings, User], tmp_path: Path
) -> None:
    db, settings, creator = generation_env
    upload = _pdf(tmp_path / "medical.pdf", ["PAPER-1", "PAPER-2"])
    staged = staging_service.stage(upload.read_bytes(), upload.name)

    result = document_service.generate_document(
        db,
        employee_id=None,
        template_id="General Book",
        fields={"subject": "Package test", "body": "<p>Body</p>"},
        commit=True,
        current_user=creator,
        classification_code="5/1",
        attachments=[
            GenerateAttachmentSpec(
                source="staged",
                staged_token=staged.token,
                original_name=upload.name,
            )
        ],
    )

    book = db.get(Book, result.book_id)
    document = db.get(Document, result.documents[0].document_id)
    assert book is not None
    assert document is not None
    assert document.base_pdf_path is not None
    assert document.pdf_path is not None
    assert _texts(settings.data_dir / document.base_pdf_path) == ["FORM"]
    assert _texts(settings.data_dir / document.pdf_path) == ["FORM", "PAPER-1", "PAPER-2"]
    assert len(book.merged_attachment_paths) == 1
    paper = book.merged_attachment_paths[0]
    assert paper["original_name"] == "medical.pdf"
    assert paper["media_type"] == "application/pdf"
    assert paper["page_count"] == 2
    assert paper["added_by_user_id"] == creator.id
    assert paper["id"]
    assert paper["added_at"]
    get_settings.cache_clear()


def test_future_generation_places_automatic_companion_inside_fixed_base(
    generation_env: tuple[Session, Settings, User],
) -> None:
    db, settings, creator = generation_env

    result = document_service.generate_document(
        db,
        employee_id="G-1001",
        template_id="Leave Application Form",
        fields={
            "leave_type": "Annual Leave",
            "start_date": "10/08/2026",
            "end_date": "11/08/2026",
            "total_days": 2,
        },
        commit=True,
        current_user=creator,
    )

    assert len(result.documents) == 2
    document = db.get(Document, result.documents[0].document_id)
    assert document is not None
    assert document.base_pdf_path is not None
    assert document.pdf_path is not None
    assert _texts(settings.data_dir / document.base_pdf_path) == ["FORM", "COMPANION"]
    assert _texts(settings.data_dir / document.pdf_path) == ["FORM", "COMPANION"]
    get_settings.cache_clear()
