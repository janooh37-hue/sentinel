from __future__ import annotations

import importlib
import json
import uuid
from pathlib import Path

import fitz
import pytest
from sqlalchemy.orm import Session

from app.api.errors import AppError, ConflictError
from app.config import get_settings
from app.db.models import (
    AuditLog,
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Document,
    User,
)
from app.services import document_service, staging_service


def _service():
    return importlib.import_module("app.services.included_papers_service")


def _pdf(path: Path, labels: list[str]) -> Path:
    doc = fitz.open()
    try:
        for label in labels:
            page = doc.new_page(width=300, height=400)
            page.insert_text((40, 80), label)
        doc.save(path)
    finally:
        doc.close()
    return path


def _texts(data: bytes) -> list[str]:
    with fitz.open("pdf", data) as doc:
        return [page.get_text().strip() for page in doc]


def _record(
    db: Session,
    tmp_path: Path,
    *,
    base: Path | None,
    published: Path,
    paper: Path,
    state: str = "none",
) -> tuple[Book, BookVersion, Document, User, User]:
    creator = User(
        email="creator@example.ae",
        password_hash="x",
        role="operator",
        status="active",
        display_name="Record creator",
    )
    other = User(
        email="manager@example.ae",
        password_hash="x",
        role="manager",
        status="active",
        display_name="Records manager",
    )
    db.add_all([creator, other, BookCategory(id="HR", prefix="HR")])
    db.flush()
    document = Document(
        employee_id=None,
        template_id="General Book",
        ref_number="HR-1",
        docx_path="source.docx",
        pdf_path=published.relative_to(tmp_path).as_posix(),
        base_pdf_path=base.relative_to(tmp_path).as_posix() if base else None,
        submission_id="submission-1",
        role="primary",
    )
    db.add(document)
    db.flush()
    book = Book(
        category_id="HR",
        ref_number="HR-1",
        subject="Test record",
        approval_state=state,
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
        fields={"subject": "Test record"},
        status=state,
        created_by_user_id=creator.id,
    )
    db.add(version)
    db.commit()
    db.refresh(book)
    db.refresh(version)
    return book, version, document, creator, other


def test_legacy_metadata_is_deterministic_side_effect_free_and_creator_only(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    base = _pdf(tmp_path / "base.pdf", ["FORM"])
    paper = _pdf(tmp_path / "medical.pdf", ["PAPER-1", "PAPER-2"])
    published = _pdf(tmp_path / "published.pdf", ["FORM", "PAPER-1", "PAPER-2"])
    book, _version, _document, creator, other = _record(
        db_session, tmp_path, base=base, published=published, paper=paper
    )
    before = [dict(item) for item in book.merged_attachment_paths]
    service = _service()

    first = service.get_package(db_session, book.id, user_id=creator.id)
    second = service.get_package(db_session, book.id, user_id=creator.id)

    assert first.revision == 0
    assert _texts(first.pdf_bytes) == _texts(second.pdf_bytes)
    assert first.papers[0].id == second.papers[0].id
    assert first.papers[0].original_name == "medical.pdf"
    assert first.papers[0].slot_key == "medical_certificate"
    assert first.papers[0].page_count == 2
    assert (first.papers[0].page_start, first.papers[0].page_end) == (2, 3)
    assert _texts(first.pdf_bytes) == ["FORM", "PAPER-1", "PAPER-2"]
    assert book.merged_attachment_paths == before
    assert book.included_papers_revision == 0

    with pytest.raises(AppError) as forbidden:
        service.get_package(db_session, book.id, user_id=other.id)
    assert forbidden.value.http_status == 403
    assert forbidden.value.code == "INCLUDED_PAPERS_CREATOR_ONLY"
    get_settings.cache_clear()


def test_existing_flattened_scan_projects_current_papers_as_embedded(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    base = _pdf(tmp_path / "base.pdf", ["FORM"])
    paper = _pdf(tmp_path / "paper.pdf", ["PAPER"])
    published = _pdf(tmp_path / "published.pdf", ["FORM", "PAPER"])
    book, version, _document, creator, _other = _record(
        db_session,
        tmp_path,
        base=base,
        published=published,
        paper=paper,
        state="approved",
    )
    signed_dir = tmp_path / "book_attachments" / str(book.id)
    signed_dir.mkdir(parents=True)
    signed_scan = _pdf(signed_dir / "signed.pdf", ["SIGNED-FORM", "PAPER"])
    version.signed_pdf_path = signed_scan.relative_to(tmp_path).as_posix()
    version.signed_base_pdf_path = None
    version.signed_embedded_paper_ids = []
    db_session.commit()
    service = _service()

    package = service.get_package(db_session, book.id, user_id=creator.id)

    assert package.base_page_count == 2
    assert package.total_page_count == 2
    assert _texts(package.pdf_bytes) == ["SIGNED-FORM", "PAPER"]
    assert package.papers[0].embedded_in_signed_base
    assert package.papers[0].page_start is None
    assert package.papers[0].page_end is None
    assert version.signed_embedded_paper_ids == []
    get_settings.cache_clear()


def test_existing_generated_package_reconstructs_form_and_companion_before_papers(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    form = _pdf(tmp_path / "reconstructed.pdf", ["FORM"])
    paper = _pdf(tmp_path / "paper.pdf", ["PAPER"])
    published = _pdf(tmp_path / "published.pdf", ["FORM", "PAPER"])
    book, _version, document, creator, _other = _record(
        db_session, tmp_path, base=None, published=published, paper=paper
    )
    (tmp_path / "source.docx").write_bytes(b"docx placeholder")
    companion = _pdf(tmp_path / "companion.pdf", ["COMPANION"])
    db_session.add(
        Document(
            employee_id=None,
            template_id="Leave Undertaking",
            ref_number="HR-1",
            docx_path="companion.docx",
            pdf_path=companion.relative_to(tmp_path).as_posix(),
            submission_id=document.submission_id,
            role="companion",
        )
    )
    db_session.commit()
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda _path: form)
    service = _service()

    package = service.get_package(db_session, book.id, user_id=creator.id)

    assert package.base_page_count == 2
    assert _texts(package.pdf_bytes) == ["FORM", "COMPANION", "PAPER"]
    db_session.refresh(document)
    assert document.base_pdf_path is None
    assert book.merged_attachment_paths[0] == {
        "path": paper.relative_to(tmp_path).as_posix(),
        "slot_key": "medical_certificate",
    }
    get_settings.cache_clear()


def test_existing_in_app_signature_is_rebuilt_without_old_included_tail(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    generated = _pdf(tmp_path / "generated-base.pdf", ["FORM"])
    paper = _pdf(tmp_path / "paper.pdf", ["PAPER"])
    published = _pdf(tmp_path / "published.pdf", ["FORM", "PAPER"])
    book, version, _document, creator, signer = _record(
        db_session,
        tmp_path,
        base=generated,
        published=published,
        paper=paper,
        state="approved",
    )
    signed_published = _pdf(tmp_path / "signed-published.pdf", ["SIGNED-FORM", "PAPER"])
    signed_form = _pdf(tmp_path / "signed-form.pdf", ["SIGNED-FORM"])
    signature = tmp_path / "signature.png"
    signature.write_bytes(b"signature")
    signer.signature_path = str(signature)
    version.signed_pdf_path = signed_published.relative_to(tmp_path).as_posix()
    version.signed_base_pdf_path = None
    version.signed_by_user_id = signer.id
    db_session.commit()
    calls: list[dict[str, object]] = []

    def fake_render(*_args, **kwargs):
        calls.append(kwargs)
        output = Path(kwargs["output_dir"]) / "rebuilt-signed.pdf"
        output.write_bytes(signed_form.read_bytes())
        return str(output)

    monkeypatch.setattr(document_service, "render_signed_pdf", fake_render)
    service = _service()

    package = service.get_package(db_session, book.id, user_id=creator.id)

    assert _texts(package.pdf_bytes) == ["SIGNED-FORM", "PAPER"]
    assert len(calls) == 1
    assert "merge_included_papers" not in calls[0]
    assert Path(calls[0]["output_dir"]).name.startswith("included-base-")
    db_session.refresh(version)
    assert version.signed_base_pdf_path is None
    get_settings.cache_clear()


def test_approved_package_change_pushes_one_localized_summary_per_approver(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    base = _pdf(tmp_path / "base.pdf", ["FORM"])
    published = _pdf(tmp_path / "published.pdf", ["FORM", "PAPER"])
    paper = _pdf(tmp_path / "paper.pdf", ["PAPER"])
    book, version, _document, creator, manager = _record(
        db_session,
        tmp_path,
        base=base,
        published=published,
        paper=paper,
        state="approved",
    )
    db_session.add_all(
        [
            BookApprovalStep(
                book_id=book.id,
                version_id=version.id,
                step_order=1,
                stage_label="Manager approval",
                assignee_user_id=manager.id,
                kind="approver",
                state="approved",
            ),
            BookApprovalStep(
                book_id=book.id,
                version_id=version.id,
                step_order=2,
                stage_label="Duplicate manager approval",
                assignee_user_id=manager.id,
                kind="approver",
                state="approved",
            ),
            BookApprovalStep(
                book_id=book.id,
                version_id=version.id,
                step_order=3,
                stage_label="Advisory review",
                assignee_user_id=creator.id,
                kind="reviewer",
                state="approved",
            ),
        ]
    )
    db_session.commit()
    sent: list[tuple[int, dict[str, tuple[str, str]], str]] = []
    service = _service()
    monkeypatch.setattr(
        service.push_service,
        "send_to_user",
        lambda _db, user_id, messages, url: sent.append((user_id, messages, url)),
    )

    service.notify_approvers(
        db_session,
        book,
        version,
        creator,
        {
            "added": ["invoice.pdf"],
            "removed": ["old.pdf"],
            "replaced": [{"from": "scan-1.pdf", "to": "scan-2.pdf"}],
            "reordered": ["scan-2.pdf", "invoice.pdf"],
        },
    )

    assert len(sent) == 1
    recipient_id, messages, url = sent[0]
    assert recipient_id == manager.id
    assert url == f"/books/{book.id}"
    assert messages["en"] == (
        "GSSG Manager",
        "Included papers updated. Record creator updated HR-1. "
        "Added (1): invoice.pdf; Removed (1): old.pdf; "
        "Replaced (1): scan-1.pdf → scan-2.pdf; Changed paper order",
    )
    assert messages["ar"] == (
        "GSSG Manager",
        "تم تحديث السجل \u2068HR-1\u2069 بواسطة \u2068Record creator\u2069. "
        "تمت الإضافة (1): \u2068invoice.pdf\u2069؛ "
        "تمت الإزالة (1): \u2068old.pdf\u2069؛ "
        "تم الاستبدال (1): \u2068scan-2.pdf\u2069 بدلًا من "
        "\u2068scan-1.pdf\u2069؛ تم تغيير ترتيب الأوراق",
    )
    long_name = f"{'x' * 100}.pdf"
    bounded = service._package_change_messages(
        creator,
        book,
        {
            "added": [long_name, "second.pdf"],
            "removed": [],
            "replaced": [],
            "reordered": [],
        },
    )
    shortened = f"{'x' * 35}….pdf"
    assert f"Added (2): {shortened}, … (+1)" in bounded["en"][1]
    assert f"تمت الإضافة (2): \u2068{shortened}\u2069، … (+1)" in bounded["ar"][1]


def test_preview_is_side_effect_free_and_save_is_revisioned_atomic_and_audited(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    base = _pdf(tmp_path / "base.pdf", ["FORM"])
    original = _pdf(tmp_path / "original.pdf", ["ORIGINAL"])
    published = _pdf(tmp_path / "published.pdf", ["FORM", "ORIGINAL"])
    book, _version, document, creator, _other = _record(
        db_session, tmp_path, base=base, published=published, paper=original
    )
    service = _service()
    opened = service.get_package(db_session, book.id, user_id=creator.id)
    late = _pdf(tmp_path / "late.pdf", ["LATE-1", "LATE-2"])
    staged = staging_service.stage(late.read_bytes(), "late paper.pdf")
    new_id = str(uuid.uuid4())
    proposal = [
        service.PaperProposal(id=opened.papers[0].id),
        service.PaperProposal(
            id=new_id,
            staged_token=staged.token,
            original_name="late paper.pdf",
        ),
    ]

    preview = service.preview_package(
        db_session,
        book.id,
        user_id=creator.id,
        revision=0,
        proposal=proposal,
    )

    assert _texts(preview.pdf_bytes) == ["FORM", "ORIGINAL", "LATE-1", "LATE-2"]
    assert book.included_papers_revision == 0
    assert book.merged_attachment_paths == [
        {
            "path": original.relative_to(tmp_path).as_posix(),
            "slot_key": "medical_certificate",
        }
    ]
    assert staging_service.resolve(staged.token) is not None
    assert db_session.query(AuditLog).count() == 0

    saved = service.save_package(
        db_session,
        book.id,
        user_id=creator.id,
        revision=0,
        proposal=proposal,
    )

    db_session.refresh(book)
    db_session.refresh(document)
    assert saved.revision == 1
    assert book.included_papers_revision == 1
    assert [item["id"] for item in book.merged_attachment_paths] == [
        opened.papers[0].id,
        new_id,
    ]
    assert [item["original_name"] for item in book.merged_attachment_paths] == [
        "original.pdf",
        "late paper.pdf",
    ]
    assert all(item["page_count"] for item in book.merged_attachment_paths)
    assert document.base_pdf_path == "base.pdf"
    assert document.pdf_path != "published.pdf"
    assert _texts((tmp_path / str(document.pdf_path)).read_bytes()) == [
        "FORM",
        "ORIGINAL",
        "LATE-1",
        "LATE-2",
    ]
    assert staging_service.resolve(staged.token) is None
    event = db_session.query(AuditLog).one()
    payload = json.loads(event.payload or "{}")
    assert event.action == "update_included_papers"
    assert payload["revision_before"] == 0
    assert payload["revision_after"] == 1
    assert payload["added"] == ["late paper.pdf"]

    current_path = document.pdf_path
    current_bytes = (tmp_path / str(current_path)).read_bytes()
    with pytest.raises(ConflictError) as stale:
        service.save_package(
            db_session,
            book.id,
            user_id=creator.id,
            revision=0,
            proposal=proposal,
        )
    assert stale.value.code == "INCLUDED_PAPERS_STALE_REVISION"
    db_session.refresh(document)
    assert document.pdf_path == current_path
    assert (tmp_path / str(current_path)).read_bytes() == current_bytes
    assert db_session.query(AuditLog).count() == 1
    get_settings.cache_clear()


def test_save_replaces_removes_and_reorders_whole_files(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    base = _pdf(tmp_path / "base.pdf", ["FORM"])
    first = _pdf(tmp_path / "first.pdf", ["FIRST"])
    published = _pdf(tmp_path / "published.pdf", ["FORM", "FIRST"])
    book, _version, _document, creator, _other = _record(
        db_session, tmp_path, base=base, published=published, paper=first
    )
    service = _service()
    opened = service.get_package(db_session, book.id, user_id=creator.id)
    second = _pdf(tmp_path / "second.pdf", ["SECOND"])
    third = _pdf(tmp_path / "third.pdf", ["THIRD"])
    staged_second = staging_service.stage(second.read_bytes(), "second.pdf")
    staged_third = staging_service.stage(third.read_bytes(), "third.pdf")
    second_id = str(uuid.uuid4())
    third_id = str(uuid.uuid4())
    service.save_package(
        db_session,
        book.id,
        user_id=creator.id,
        revision=0,
        proposal=[
            service.PaperProposal(id=opened.papers[0].id),
            service.PaperProposal(second_id, staged_second.token, "second.pdf"),
            service.PaperProposal(third_id, staged_third.token, "third.pdf"),
        ],
    )
    replacement = _pdf(tmp_path / "replacement.pdf", ["REPLACED-FIRST"])
    staged_replacement = staging_service.stage(
        replacement.read_bytes(), "replacement.pdf"
    )

    saved = service.save_package(
        db_session,
        book.id,
        user_id=creator.id,
        revision=1,
        proposal=[
            service.PaperProposal(id=third_id),
            service.PaperProposal(
                id=opened.papers[0].id,
                staged_token=staged_replacement.token,
                original_name="replacement.pdf",
            ),
        ],
    )

    assert _texts(saved.pdf_bytes) == ["FORM", "THIRD", "REPLACED-FIRST"]
    assert [paper.id for paper in saved.papers] == [third_id, opened.papers[0].id]
    assert saved.change_summary == {
        "added": [],
        "removed": ["second.pdf"],
        "replaced": [{"from": "first.pdf", "to": "replacement.pdf"}],
        "reordered": ["third.pdf", "replacement.pdf"],
    }
    get_settings.cache_clear()


def test_commit_failure_preserves_previous_package_and_staged_upload(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    base = _pdf(tmp_path / "base.pdf", ["FORM"])
    original = _pdf(tmp_path / "original.pdf", ["ORIGINAL"])
    published = _pdf(tmp_path / "published.pdf", ["FORM", "ORIGINAL"])
    book, _version, document, creator, _other = _record(
        db_session, tmp_path, base=base, published=published, paper=original
    )
    service = _service()
    opened = service.get_package(db_session, book.id, user_id=creator.id)
    late = _pdf(tmp_path / "late.pdf", ["LATE"])
    staged = staging_service.stage(late.read_bytes(), "late.pdf")
    old_metadata = [dict(item) for item in book.merged_attachment_paths]
    old_path = document.pdf_path
    old_bytes = (tmp_path / str(old_path)).read_bytes()
    real_commit = db_session.commit

    def fail_commit() -> None:
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="commit failed"):
        service.save_package(
            db_session,
            book.id,
            user_id=creator.id,
            revision=0,
            proposal=[
                service.PaperProposal(id=opened.papers[0].id),
                service.PaperProposal(str(uuid.uuid4()), staged.token, "late.pdf"),
            ],
        )
    monkeypatch.setattr(db_session, "commit", real_commit)
    db_session.expire_all()
    persisted_book = db_session.get(Book, book.id)
    persisted_document = db_session.get(Document, document.id)
    assert persisted_book is not None
    assert persisted_document is not None
    assert persisted_book.included_papers_revision == 0
    assert persisted_book.merged_attachment_paths == old_metadata
    assert persisted_document.pdf_path == old_path
    assert (tmp_path / str(old_path)).read_bytes() == old_bytes
    assert staging_service.resolve(staged.token) is not None
    package_dir = tmp_path / "book_packages" / str(book.id)
    assert not package_dir.exists() or not any(package_dir.iterdir())
    get_settings.cache_clear()
