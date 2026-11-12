"""Record render paths stamp the stored grade into DOCX headers."""

from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile

import pytest

from app.config import Settings
from app.db.models import Book, BookCategory, BookEditSession, Document, Employee
from app.services import artifact_service, document_service, report_service, word_book_service

TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


@pytest.fixture()
def render_settings(db_session, tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path / "data", templates_dir=TEMPLATES_DIR)
    for service in (artifact_service, document_service, report_service, word_book_service):
        monkeypatch.setattr(service, "get_settings", lambda: settings)
    db_session.add_all(
        [
            BookCategory(id="GS", prefix="GS"),
            BookCategory(id="HR", prefix="HR"),
            Employee(id="G-1001", name_en="Test Employee", name_ar="موظف اختبار"),
        ]
    )
    db_session.commit()
    return settings


@pytest.mark.parametrize("authoring", ["word", "report", "generated"])
@pytest.mark.parametrize(
    "grade, text",
    [
        ("unclassified", None),
        ("secret", "سري"),
        ("top_secret", "سري للغاية"),
        ("addressee_only", "سري للغاية — لعنايته فقط"),
    ],
)
def test_record_docx_has_grade_mark(
    db_session, admin_user, render_settings, authoring, grade, text
):
    if authoring == "word":
        result = word_book_service.create_word_book(
            db_session,
            user=admin_user,
            classification_code="5/1",
            recipient_id=None,
            subject="اختبار السرية",
            cc=[],
            manager_id=None,
            grade=grade,
        )
        session = db_session.query(BookEditSession).filter_by(book_id=result.book_id).one()
        docx_path = Path(session.working_path)
    elif authoring == "report":
        result = word_book_service.create_report_word_book(
            db_session,
            user=admin_user,
            subject="اختبار السرية",
            recipient_id=None,
            date=None,
            signer_employee_id="G-1001",
            sign=False,
            grade=grade,
        )
        session = db_session.query(BookEditSession).filter_by(book_id=result.book_id).one()
        docx_path = Path(session.working_path)
    else:
        result = document_service.generate_document(
            db_session,
            employee_id=None,
            template_id="General Book",
            fields={"subject": "اختبار السرية", "body": "<p>نص سري</p>"},
            commit=True,
            current_user=admin_user,
            classification_code="5/1",
            grade=grade,
            converter=lambda path: None,
        )
        docx_path = result.documents[0].docx_path

    assert db_session.get(Book, result.book_id).grade == grade
    _assert_level_mark(docx_path, text)


def _assert_level_mark(docx_path, text):
    with ZipFile(docx_path) as archive:
        headers = [
            ElementTree.fromstring(archive.read(name))
            for name in archive.namelist()
            if name.startswith("word/header") and name.endswith(".xml")
        ]
    assert headers, "The rendered DOCX must have header parts"
    for header in headers:
        marks = [
            control
            for control in header.iter(W + "sdt")
            if any(
                tag.get(W + "val") == "gssg-level-mark"
                for tag in control.findall(f"{W}sdtPr/{W}tag")
            )
        ]
        assert len(marks) == (1 if text else 0)
        if text:
            assert "".join(node.text or "" for node in marks[0].iter(W + "t")) == text


@pytest.mark.parametrize("leave_type, count", [("Annual Leave", 2), ("Sick Leave", 1)])
@pytest.mark.parametrize(
    "grade, text",
    [
        ("unclassified", None),
        ("secret", "سري"),
        ("top_secret", "سري للغاية"),
        ("addressee_only", "سري للغاية — لعنايته فقط"),
    ],
)
def test_leave_primary_and_companion_keep_record_grade_on_revision(
    db_session, admin_user, render_settings, leave_type, count, grade, text
):
    fields = {
        "leave_type": leave_type,
        "start_date": "10/08/2026",
        "end_date": "11/08/2026",
        "total_days": 2,
    }
    initial = document_service.generate_document(
        db_session,
        employee_id="G-1001",
        template_id="Leave Application Form",
        fields=fields,
        current_user=admin_user,
        grade=grade,
        converter=lambda _path: None,
    )
    assert len(initial.documents) == count
    for document in initial.documents:
        _assert_level_mark(document.docx_path, text)
    revised = document_service.generate_document(
        db_session,
        employee_id="G-1001",
        template_id="Leave Application Form",
        fields=fields,
        current_user=admin_user,
        revise_of_book_id=initial.book_id,
        grade="unclassified",
        converter=lambda _path: None,
    )

    assert revised.book_id == initial.book_id
    assert db_session.get(Book, initial.book_id).grade == grade
    assert len(revised.documents) == count
    for document in revised.documents:
        _assert_level_mark(document.docx_path, text)


@pytest.mark.parametrize("authoring", ["word", "generated"])
@pytest.mark.parametrize(
    "grade, text",
    [
        ("unclassified", None),
        ("secret", "سري"),
        ("top_secret", "سري للغاية"),
        ("addressee_only", "سري للغاية — لعنايته فقط"),
    ],
)
def test_signing_uses_current_record_grade_and_preserves_submitter_footer(
    db_session, admin_user, render_settings, tmp_path, authoring, grade, text
):
    from PIL import Image

    if authoring == "word":
        admin_user.employee_id = "G-1001"
        db_session.commit()
        result = word_book_service.create_word_book(
            db_session,
            user=admin_user,
            classification_code="5/1",
            recipient_id=None,
            subject="اختبار السرية",
            cc=[],
            manager_id=None,
            grade="secret",
        )
        session = db_session.query(BookEditSession).filter_by(book_id=result.book_id).one()
        session.last_put_at = session.created_at
        db_session.commit()
        book = word_book_service.finish_word_session(
            db_session, user=admin_user, book_id=result.book_id, converter=lambda _path: None
        )
    else:
        result = document_service.generate_document(
            db_session,
            employee_id=None,
            template_id="General Book",
            fields={"subject": "اختبار السرية", "body": "<p>نص سري</p>"},
            current_user=admin_user,
            classification_code="5/1",
            grade="secret",
            converter=lambda _path: None,
        )
        book = db_session.get(Book, result.book_id)
    version = book.versions[-1]
    source = Path(db_session.get(Document, version.document_id).docx_path)
    if not source.is_absolute():
        source = render_settings.data_dir / source
    with ZipFile(source) as archive:
        footers = {
            name: archive.read(name)
            for name in archive.namelist()
            if name.startswith("word/footer") and name.endswith(".xml")
        }
    book.grade = grade
    db_session.commit()
    signature = tmp_path / "signature.png"
    Image.new("RGBA", (100, 40), (0, 0, 0, 255)).save(signature)
    signed = document_service.render_signed_artifact(
        db_session,
        version=version,
        signer_signature_path=str(signature),
        output_dir=tmp_path / "signed",
        converter=lambda _path: None,
    )

    _assert_level_mark(signed.docx_path, text)
    _assert_level_mark(source, "سري")
    if authoring == "word":
        with ZipFile(signed.docx_path) as archive:
            assert {name: archive.read(name) for name in footers} == footers
