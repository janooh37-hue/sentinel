from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import fitz
import pytest
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import Settings, get_settings
from app.db.models import (
    Book,
    BookCategory,
    BookEditSession,
    ClassifiedRefSequence,
    Document,
    Employee,
    User,
)
from app.schemas.book import GenerateAttachmentSpec
from app.services import document_service, staging_service, word_book_service


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
    primary, companion = result.documents
    book = db.get(Book, result.book_id)
    assert primary.ref_number == companion.ref_number
    assert primary.ref_number.startswith("1/3/")
    assert book is not None
    assert book.ref_number == primary.ref_number
    assert book.classification_code == "3/1"
    get_settings.cache_clear()


def test_resignation_pair_shares_force_affairs_ref(
    generation_env: tuple[Session, Settings, User],
) -> None:
    db, _settings, creator = generation_env

    result = document_service.generate_document(
        db,
        employee_id="G-1001",
        template_id="Resignation Letter",
        fields={"reason": "Family responsibilities after long service."},
        commit=True,
        current_user=creator,
    )

    assert len(result.documents) == 2
    primary, companion = result.documents
    book = db.get(Book, result.book_id)
    assert primary.ref_number == companion.ref_number
    assert primary.ref_number.startswith("1/12/")
    assert book is not None
    assert book.ref_number == primary.ref_number
    assert book.classification_code == "12/1"
    get_settings.cache_clear()


def test_sick_leave_application_uses_sick_classified_ref(
    generation_env: tuple[Session, Settings, User],
) -> None:
    db, _settings, creator = generation_env

    result = document_service.generate_document(
        db,
        employee_id="G-1001",
        template_id="Leave Application Form",
        fields={
            "leave_type": "Sick Leave",
            "start_date": "10/08/2026",
            "end_date": "11/08/2026",
            "total_days": 2,
        },
        commit=True,
        current_user=creator,
    )

    assert len(result.documents) == 1
    document = result.documents[0]
    book = db.get(Book, result.book_id)
    assert document.ref_number.startswith("1/4/")
    assert book is not None
    assert book.ref_number == document.ref_number
    assert book.classification_code == "4/1"


def test_preview_includes_staged_papers_without_consuming_them(generation_env, tmp_path):
    db, settings, creator = generation_env
    paper = _pdf(tmp_path / "preview-paper.pdf", ["PAPER-1", "PAPER-2"])
    staged = staging_service.stage(paper.read_bytes(), paper.name)
    specs = [
        GenerateAttachmentSpec(source="staged", staged_token=staged.token, original_name=paper.name)
    ]
    kwargs = dict(
        employee_id=None,
        template_id="General Book",
        fields={"subject": "Preview", "body": "<p>Body</p>"},
        current_user=creator,
        classification_code="5/1",
        attachments=specs,
    )
    preview = document_service.generate_document(db, commit=False, **kwargs)
    assert _texts(preview.documents[0].pdf_path) == ["FORM", "PAPER-1", "PAPER-2"]
    assert preview.book_id is None
    assert db.query(Book).count() == 0
    assert staging_service.resolve(staged.token) is not None
    saved = document_service.generate_document(db, commit=True, **kwargs)
    book = db.get(Book, saved.book_id)
    assert book is not None and len(book.merged_attachment_paths) == 1
    assert _texts(settings.data_dir / saved.documents[0].pdf_path) == ["FORM", "PAPER-1", "PAPER-2"]
    assert staging_service.resolve(staged.token) is None


def test_word_create_preview_and_finish_include_staged_and_record_papers(
    generation_env, tmp_path, monkeypatch
):
    db, settings, creator = generation_env
    creator.role = "admin"
    db.commit()
    monkeypatch.setattr(word_book_service, "get_settings", lambda: settings)
    source = document_service.generate_document(
        db,
        employee_id=None,
        template_id="General Book",
        fields={"subject": "Source", "body": "<p>Body</p>"},
        current_user=creator,
        classification_code="5/1",
    )
    paper = _pdf(tmp_path / "word-paper.pdf", ["PAPER-1", "PAPER-2"])
    staged = staging_service.stage(paper.read_bytes(), paper.name)
    real_commit = db.commit
    commits = []

    def commit_with_staged_source_intact():
        assert staging_service.resolve(staged.token) is not None
        commits.append(True)
        real_commit()

    with monkeypatch.context() as transaction:
        transaction.setattr(db, "commit", commit_with_staged_source_intact)
        info = word_book_service.create_word_book(
            db,
            user=creator,
            classification_code="5/1",
            recipient_id=None,
            subject="Word package",
            cc=None,
            manager_id=None,
            record_access_user=creator,
            attachments=[
                GenerateAttachmentSpec(
                    source="staged", staged_token=staged.token, original_name=paper.name
                ),
                GenerateAttachmentSpec(source="record_document", book_id=source.book_id),
            ],
        )
    assert commits == [True]
    assert staging_service.resolve(staged.token) is None
    book = db.get(Book, info.book_id)
    assert book is not None and len(book.merged_attachment_paths) == 2
    assert [item["page_count"] for item in book.merged_attachment_paths] == [2, 1]
    assert all(item["added_by_user_id"] == creator.id for item in book.merged_attachment_paths)
    session = db.query(BookEditSession).filter_by(book_id=book.id).one()
    session.last_put_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()

    def convert(path):
        return _pdf(path.with_suffix(".pdf"), ["LETTER"])

    preview = word_book_service.render_session_preview(db, book_id=book.id, converter=convert)
    assert isinstance(preview, bytes)
    with fitz.open("pdf", preview) as pdf:
        assert [page.get_text().strip() for page in pdf] == ["LETTER", "PAPER-1", "PAPER-2", "FORM"]
    letter = Path(session.working_path).parent / "preview-src.pdf"
    original_letter = letter.read_bytes()
    assert _texts(letter) == ["LETTER"]
    finished = word_book_service.finish_word_session(
        db, user=creator, book_id=book.id, converter=convert
    )
    document = db.get(Document, finished.versions[-1].document_id)
    assert document is not None
    assert _texts(settings.data_dir / document.pdf_path) == ["LETTER", "PAPER-1", "PAPER-2", "FORM"]
    # Finish may clean the cache, but the preserved fixed base remains letter-only.
    assert _texts(settings.data_dir / document.base_pdf_path) == ["LETTER"]
    if letter.exists():
        assert letter.read_bytes() == original_letter


@pytest.mark.parametrize("invalid_source", ["staged", "record_document", "slot"])
def test_word_invalid_attachment_does_not_allocate_reference(
    generation_env, monkeypatch, invalid_source
):
    db, settings, creator = generation_env
    monkeypatch.setattr(word_book_service, "get_settings", lambda: settings)
    sequence = ClassifiedRefSequence(id=1, next_value=17)
    db.add(sequence)
    db.commit()
    if invalid_source == "record_document":
        book = Book(category_id="GS", ref_number="PRIVATE", confidentiality="secret")
        db.add(book)
        db.commit()
        spec = GenerateAttachmentSpec(source="record_document", book_id=book.id)
    else:
        spec = GenerateAttachmentSpec(
            source="staged",
            staged_token="invalid",
            slot_key="unknown" if invalid_source == "slot" else None,
        )
    with pytest.raises(AppError):
        word_book_service.create_word_book(
            db,
            user=creator,
            classification_code="5/1",
            recipient_id=None,
            subject="Invalid paper",
            cc=None,
            manager_id=None,
            attachments=[spec],
            record_access_user=creator,
        )
    assert db.get(ClassifiedRefSequence, 1).next_value == 17
    assert db.query(BookEditSession).count() == 0


def test_word_failed_commit_keeps_staged_attachment(generation_env, tmp_path, monkeypatch):
    db, settings, creator = generation_env
    monkeypatch.setattr(word_book_service, "get_settings", lambda: settings)
    paper = _pdf(tmp_path / "retry.pdf", ["PAPER"])
    staged = staging_service.stage(paper.read_bytes(), paper.name)
    monkeypatch.setattr(db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("commit failed")))
    with pytest.raises(RuntimeError, match="commit failed"):
        word_book_service.create_word_book(
            db,
            user=creator,
            classification_code="5/1",
            recipient_id=None,
            subject="Retry",
            cc=None,
            manager_id=None,
            attachments=[
                GenerateAttachmentSpec(
                    source="staged", staged_token=staged.token, original_name=paper.name
                )
            ],
        )
    assert staging_service.resolve(staged.token) is not None


def test_report_word_create_persists_attachments(generation_env, tmp_path, monkeypatch):
    db, settings, creator = generation_env
    monkeypatch.setattr(word_book_service, "get_settings", lambda: settings)
    paper = _pdf(tmp_path / "report-paper.pdf", ["REPORT PAPER"])
    staged = staging_service.stage(paper.read_bytes(), paper.name)
    info = word_book_service.create_report_word_book(
        db,
        user=creator,
        signer_employee_id="G-1001",
        recipient_id=None,
        subject="Report package",
        date=None,
        sign=False,
        attachments=[
            GenerateAttachmentSpec(
                source="staged", staged_token=staged.token, original_name=paper.name
            )
        ],
        record_access_user=creator,
    )
    book = db.get(Book, info.book_id)
    assert book is not None and len(book.merged_attachment_paths) == 1
    assert book.merged_attachment_paths[0]["original_name"] == paper.name
    assert staging_service.resolve(staged.token) is None
