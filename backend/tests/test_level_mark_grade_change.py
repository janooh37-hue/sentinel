from __future__ import annotations

import shutil
from pathlib import Path
from zipfile import ZipFile

import fitz
import pytest
from lxml import etree
from sqlalchemy.orm import Session

from app.config import Settings
from app.core.level_mark import apply_level_mark
from app.db.models import Book, BookCategory, BookEditSession, BookVersion, Document, User
from app.services import book_send_service, book_service, document_service, included_papers_service
from tests.conftest import make_user

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "GSSG-GS_300-004_Report.docx"


def _marks(path: Path) -> list[str]:
    with ZipFile(path) as archive:
        marks = []
        for name in archive.namelist():
            if name.startswith("word/header") and name.endswith(".xml"):
                root = etree.fromstring(archive.read(name))
                for control in root.iter(f"{_W}sdt"):
                    if any(
                        tag.get(f"{_W}val") == "gssg-level-mark" for tag in control.iter(f"{_W}tag")
                    ):
                        marks.append("".join(control.itertext()))
        return marks


def _pdf(path: Path, text: str) -> Path:
    with fitz.open() as pdf:
        pdf.new_page().insert_text((72, 72), text)
        pdf.save(path)
    return path


@pytest.fixture()
def editable_record(
    db_session: Session, admin_user: User, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[Book, Document, Path]:
    db_session.add(BookCategory(id="HR", prefix="HR", requires_approval=False))
    db_session.commit()
    pdf = _pdf(tmp_path / "record.pdf", "unclassified")
    book = Book(
        category_id="HR",
        ref_number="HR-mark-1",
        subject="Grade mark",
        grade="unclassified",
        distribution="organization",
        created_by_user_id=admin_user.id,
        approval_state="none",
    )
    document = Document(
        template_id="Report",
        ref_number=book.ref_number,
        submission_id="mark-submission",
        role="primary",
        pdf_path=str(pdf),
    )
    db_session.add_all([book, document])
    db_session.flush()
    db_session.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            trigger="initial",
            status="none",
            template_id="Report",
            document_id=document.id,
            fields={},
            created_by_user_id=admin_user.id,
        )
    )
    source = tmp_path / "record.docx"
    shutil.copy2(_TEMPLATE, source)
    document.docx_path = source.name  # Exercise data-dir-relative path resolution.
    db_session.commit()
    settings = Settings(data_dir=tmp_path)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(book_service, "get_settings", lambda: settings)
    monkeypatch.setattr(included_papers_service, "get_settings", lambda: settings)

    def convert(docx: Path) -> Path:
        return _pdf(docx.with_suffix(".pdf"), "marked" if _marks(docx) else "unclassified")

    monkeypatch.setattr(document_service, "convert_docx_to_pdf", convert)
    return book, document, source


@pytest.fixture()
def editable_companion(
    db_session: Session, editable_record, tmp_path: Path
) -> tuple[Document, Path]:
    _book_row, primary, _source = editable_record
    source = tmp_path / "companion.docx"
    shutil.copy2(_TEMPLATE, source)
    pdf = _pdf(tmp_path / "companion.pdf", "original companion")
    companion = Document(
        template_id="Leave Undertaking",
        ref_number=primary.ref_number,
        submission_id=primary.submission_id,
        role="companion",
        docx_path=source.name,
        pdf_path=pdf.name,
    )
    db_session.add(companion)
    db_session.commit()
    return companion, source


def test_grade_change_restamps_docx_and_republishes_package(
    db_session: Session, admin_user: User, editable_record, tmp_path: Path
) -> None:
    book, document, source = editable_record
    paper = _pdf(tmp_path / "included.pdf", "included paper")
    book.merged_attachment_paths = [{"path": paper.name}]
    db_session.commit()

    original = source.read_bytes()
    revision = book.included_papers_revision
    for grade, expected in (
        ("secret", ["سري"]),
        ("top_secret", ["سري للغاية"]),
        ("addressee_only", ["سري للغاية — لعنايته فقط"]),
        ("unclassified", []),
    ):
        book_send_service.set_grade(db_session, admin_user, book, grade)
        committed = document_service._authored_docx_of(db_session, book.versions[-1])
        assert committed is not None
        assert committed != source
        assert set(_marks(committed)) == set(expected)
        assert source.read_bytes() == original
        assert book.included_papers_revision == revision
        resolved = document_service.resolve_document_artifact(db_session, document.id, format="pdf")
        with fitz.open(resolved.path) as pdf:
            assert pdf.page_count == 2
            assert ("marked" if expected else "unclassified") in pdf[0].get_text()
            assert "included paper" in pdf[1].get_text()
        with fitz.open(tmp_path / document.base_pdf_path) as pdf:
            assert pdf.page_count == 1
            assert ("marked" if expected else "unclassified") in pdf[0].get_text()


@pytest.mark.parametrize(
    "finalization", ["signed", "imported", "approved", "signed_pending", "embedded"]
)
def test_signed_locked_record_is_not_restamped(
    db_session: Session, admin_user: User, editable_record, finalization: str
) -> None:
    book, document, source = editable_record
    version = book.versions[-1]
    version.status = "pending" if finalization in {"signed_pending", "embedded"} else "approved"
    if finalization == "imported":
        version.fields = {"imported_approved": True}
    elif finalization in {"signed", "signed_pending"}:
        version.signed_pdf_path = document.pdf_path
    elif finalization == "embedded":
        version.manager_sig_embedded = True
    db_session.commit()
    original = source.read_bytes()
    pdf_path = document.pdf_path
    docx_path = document.docx_path

    book_send_service.set_grade(db_session, admin_user, book, "secret")

    assert book.grade == "secret"
    assert source.read_bytes() == original
    assert document.docx_path == docx_path
    assert document.pdf_path == pdf_path
    assert document.base_pdf_path is None


@pytest.mark.parametrize("working_copy", ["same_absolute", "same_relative", "separate"])
def test_active_word_working_file_is_not_restamped(
    db_session: Session, admin_user: User, editable_record, working_copy: str
) -> None:
    book, document, source = editable_record
    working = source
    if working_copy == "separate":
        working = source.with_name("working.docx")
        shutil.copy2(source, working)
    db_session.add(
        BookEditSession(
            book_id=book.id,
            user_id=admin_user.id,
            token="level-change-active",
            working_path=working.name if working_copy == "same_relative" else str(working),
            state="active",
        )
    )
    db_session.commit()
    original = source.read_bytes()

    book_send_service.set_grade(db_session, admin_user, book, "secret")

    assert book.grade == "secret"
    assert source.read_bytes() == original
    assert working.read_bytes() == original
    committed = document_service._authored_docx_of(db_session, book.versions[-1])
    assert committed is not None
    if working_copy == "separate":
        assert "سري" in _marks(committed)
        assert document.base_pdf_path is not None
    else:
        assert committed == source
        assert document.base_pdf_path is None


@pytest.mark.parametrize("failure", ["conversion", "publication"])
def test_pdf_failure_does_not_fail_grade_change(
    db_session: Session,
    admin_user: User,
    editable_record,
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    book, document, source = editable_record
    original_pdf_path = document.pdf_path

    def fail(*args, **kwargs):
        raise RuntimeError("PDF unavailable")

    if failure == "conversion":
        monkeypatch.setattr(document_service, "convert_docx_to_pdf", fail)
    else:
        monkeypatch.setattr(included_papers_service, "publish_generated_package", fail)

    book_send_service.set_grade(db_session, admin_user, book, "secret")

    assert book.grade == "secret"
    committed = document_service._authored_docx_of(db_session, book.versions[-1])
    assert committed is not None
    assert "سري" in _marks(committed)
    assert _marks(source) == []
    assert document.pdf_path == original_pdf_path


@pytest.mark.parametrize(
    "grade, distribution",
    [
        ("unclassified", "organization"),
        ("unclassified", "named"),
        ("secret", "organization"),
        ("secret", "named"),
        ("top_secret", "named"),
        ("addressee_only", "named"),
    ],
)
def test_send_preserves_grade_distribution_and_artifacts(
    db_session: Session,
    admin_user: User,
    editable_record,
    monkeypatch: pytest.MonkeyPatch,
    grade: str,
    distribution: str,
) -> None:
    book, document, source = editable_record
    book.grade, book.distribution = grade, distribution
    assert apply_level_mark(source, grade)
    db_session.commit()
    recipient = make_user(db_session, email="grade-mark-recipient@test.ae", role="admin")
    monkeypatch.setattr(book_send_service, "_push_new", lambda *args: None)
    original = source.read_bytes()
    paths = document.docx_path, document.pdf_path, document.base_pdf_path

    book_send_service.send(
        db_session,
        admin_user,
        book,
        user_ids=[recipient.id],
        purpose="info",
        note=None,
    )

    assert (book.grade, book.distribution) == (grade, distribution)
    assert (document.docx_path, document.pdf_path, document.base_pdf_path) == paths
    assert source.read_bytes() == original


@pytest.mark.parametrize("grade", ["top_secret", "addressee_only"])
def test_non_creator_cannot_send_restricted_record(
    db_session: Session, admin_user: User, editable_record, grade: str
) -> None:
    from app.api.errors import AppError
    from app.db.models import BookRecipient

    book, document, source = editable_record
    book.grade, book.distribution = grade, "named"
    forwarder = make_user(db_session, email="forwarder@test.ae")
    recipient = make_user(db_session, email="recipient@test.ae")
    db_session.add(
        BookRecipient(
            book_id=book.id,
            user_id=forwarder.id,
            sent_by_user_id=admin_user.id,
            purpose="info",
        )
    )
    db_session.commit()
    original = source.read_bytes()
    paths = document.docx_path, document.pdf_path, document.base_pdf_path

    with pytest.raises(AppError) as error:
        book_send_service.send(
            db_session,
            forwarder,
            book,
            user_ids=[recipient.id],
            purpose="info",
            note=None,
        )

    assert error.value.code == "WRITER_ONLY_SEND"
    assert error.value.http_status == 403
    assert (book.grade, book.distribution) == (grade, "named")
    assert (document.docx_path, document.pdf_path, document.base_pdf_path) == paths
    assert source.read_bytes() == original


@pytest.mark.parametrize("ending", ["rollback", "close"])
def test_restamp_rollback_preserves_original_artifacts(
    db_session: Session, admin_user: User, editable_record, tmp_path: Path, ending: str
) -> None:
    book, document, source = editable_record
    document_id, book_id = document.id, book.id
    original_docx = source.read_bytes()
    original_pdf_path, original_docx_path = document.pdf_path, document.docx_path
    original_pdf = Path(original_pdf_path).read_bytes()

    book_send_service._change_grade(db_session, admin_user, book, "secret")
    staged_docx = document_service._authored_docx_of(db_session, book.versions[-1])
    assert staged_docx is not None
    staged_paths = [
        staged_docx,
        tmp_path / document.pdf_path,
        tmp_path / document.base_pdf_path,
    ]
    assert "سري" in _marks(staged_docx)
    assert all(path.is_file() for path in staged_paths)
    db_session.flush()

    getattr(db_session, ending)()

    assert source.read_bytes() == original_docx
    assert Path(original_pdf_path).read_bytes() == original_pdf
    assert all(not path.exists() for path in staged_paths)
    persisted_document = db_session.get(Document, document_id)
    assert persisted_document.docx_path == original_docx_path
    assert persisted_document.pdf_path == original_pdf_path
    assert persisted_document.base_pdf_path is None
    assert db_session.get(Book, book_id).grade == "unclassified"


def test_failed_commit_rolls_back_restamp_and_grade(
    db_session: Session,
    admin_user: User,
    editable_record,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    book, document, source = editable_record
    original_docx, original_pdf_path = source.read_bytes(), document.pdf_path
    original_docx_path = document.docx_path

    def fail_commit():
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="commit failed"):
        book_send_service.set_grade(db_session, admin_user, book, "secret")
    staged_docx = document_service._authored_docx_of(db_session, book.versions[-1])
    staged_pdf = tmp_path / document.pdf_path
    db_session.rollback()

    assert book.grade == "unclassified"
    assert document.docx_path == original_docx_path
    assert document.pdf_path == original_pdf_path
    assert source.read_bytes() == original_docx
    assert staged_docx is not None and not staged_docx.exists()
    assert not staged_pdf.exists()


def test_stamp_failure_keeps_previous_artifacts(
    db_session: Session, admin_user: User, editable_record, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services import artifact_service

    book, document, source = editable_record
    original_docx_path, original_pdf_path = document.docx_path, document.pdf_path
    original = source.read_bytes()
    monkeypatch.setattr(artifact_service, "apply_level_mark", lambda *args: False)

    book_send_service.set_grade(db_session, admin_user, book, "secret")

    assert book.grade == "secret"
    assert document.docx_path == original_docx_path
    assert document.pdf_path == original_pdf_path
    assert source.read_bytes() == original


def test_grade_change_restamps_companions_before_publishing_package(
    db_session: Session, admin_user: User, editable_record, editable_companion, tmp_path: Path
) -> None:
    book, document, source = editable_record
    companion, companion_source = editable_companion
    original_sources = [source.read_bytes(), companion_source.read_bytes()]
    paper = _pdf(tmp_path / "included.pdf", "included paper")
    book.merged_attachment_paths = [{"path": paper.name}]
    db_session.commit()

    for grade, expected in (
        ("secret", {"سري"}),
        ("top_secret", {"سري للغاية"}),
        ("addressee_only", {"سري للغاية — لعنايته فقط"}),
        ("unclassified", set()),
    ):
        book_send_service.set_grade(db_session, admin_user, book, grade)
        assert set(_marks(Path(document.docx_path))) == expected
        assert set(_marks(Path(companion.docx_path))) == expected
        assert not Path(companion.pdf_path).is_absolute()
        pdf_level = "marked" if expected else "unclassified"
        with fitz.open(tmp_path / companion.pdf_path) as pdf:
            assert pdf.page_count == 1
            assert pdf_level in pdf[0].get_text()
        with fitz.open(tmp_path / document.base_pdf_path) as pdf:
            assert pdf.page_count == 2
            assert all(pdf_level in page.get_text() for page in pdf)
        resolved = document_service.resolve_document_artifact(db_session, document.id, format="pdf")
        with fitz.open(resolved.path) as pdf:
            assert pdf.page_count == 3
            assert pdf_level in pdf[0].get_text()
            assert pdf_level in pdf[1].get_text()
            assert "included paper" in pdf[2].get_text()
    assert [source.read_bytes(), companion_source.read_bytes()] == original_sources


@pytest.mark.parametrize("ending", ["rollback", "close"])
def test_companion_restamp_rollback_restores_paths_and_preserves_bytes(
    db_session: Session,
    admin_user: User,
    editable_record,
    editable_companion,
    tmp_path: Path,
    ending: str,
) -> None:
    book, document, source = editable_record
    companion, companion_source = editable_companion
    companion_id = companion.id
    original_docx_path, original_pdf_path = companion.docx_path, companion.pdf_path
    original_docx = companion_source.read_bytes()
    original_pdf = (tmp_path / original_pdf_path).read_bytes()

    book_send_service._change_grade(db_session, admin_user, book, "secret")
    staged_paths = [
        Path(document.docx_path),
        tmp_path / document.pdf_path,
        tmp_path / document.base_pdf_path,
        Path(companion.docx_path),
        tmp_path / companion.pdf_path,
    ]
    assert all(path.is_file() for path in staged_paths)
    assert "سري" in _marks(Path(companion.docx_path))
    db_session.flush()
    getattr(db_session, ending)()

    assert all(not path.exists() for path in staged_paths)
    restored = db_session.get(Document, companion_id)
    assert restored.docx_path == original_docx_path
    assert restored.pdf_path == original_pdf_path
    assert companion_source.read_bytes() == original_docx
    assert (tmp_path / original_pdf_path).read_bytes() == original_pdf
    assert _marks(source) == []


@pytest.mark.parametrize("failure", ["conversion", "publication"])
def test_companion_failure_preserves_all_published_pdf_paths(
    db_session: Session,
    admin_user: User,
    editable_record,
    editable_companion,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    book, document, _source = editable_record
    companion, _companion_source = editable_companion
    old_primary_pdf, old_companion_pdf = document.pdf_path, companion.pdf_path
    original_companion = (tmp_path / old_companion_pdf).read_bytes()
    publish_calls = []
    publish = included_papers_service.publish_generated_package

    def tracked_publish(*args, **kwargs):
        publish_calls.append(True)
        if failure == "publication":
            raise RuntimeError("package unavailable")
        return publish(*args, **kwargs)

    monkeypatch.setattr(included_papers_service, "publish_generated_package", tracked_publish)
    if failure == "conversion":

        def convert(path: Path) -> Path | None:
            if path.name.startswith(f"level-{companion.id}-"):
                return None
            return _pdf(path.with_suffix(".pdf"), "secret")

        monkeypatch.setattr(document_service, "convert_docx_to_pdf", convert)

    book_send_service.set_grade(db_session, admin_user, book, "secret")

    assert book.grade == "secret"
    assert "سري" in _marks(Path(document.docx_path))
    assert "سري" in _marks(Path(companion.docx_path))
    assert document.pdf_path == old_primary_pdf
    assert document.base_pdf_path is None
    assert companion.pdf_path == old_companion_pdf
    assert (tmp_path / old_companion_pdf).read_bytes() == original_companion
    assert bool(publish_calls) == (failure == "publication")


def test_grade_change_does_not_restamp_unrelated_companions(
    db_session: Session,
    admin_user: User,
    editable_record,
    editable_companion,
) -> None:
    book, _primary, _source = editable_record
    companion, companion_source = editable_companion
    companion.submission_id = "different-submission"
    db_session.commit()
    original_docx_path, original_pdf_path = companion.docx_path, companion.pdf_path
    original = companion_source.read_bytes()

    book_send_service.set_grade(db_session, admin_user, book, "secret")

    assert companion.docx_path == original_docx_path
    assert companion.pdf_path == original_pdf_path
    assert companion_source.read_bytes() == original
