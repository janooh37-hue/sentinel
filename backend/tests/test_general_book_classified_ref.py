"""General Book ref unification — the rich-editor (HugeRTE) generate path
allocates from the SAME classified register as the Word path.

Every committed General Book ref is ``1/{tab}/GSSG/{serial}``; the legacy
GS-#### counter is retired for this form. Previews stay ref-free.
"""

from __future__ import annotations

import pytest

from app.api.errors import ValidationFailedError
from app.db.models import Book, BookCategory, ClassifiedRefSequence
from app.services import document_service


def _seed_gs(db):
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.commit()


@pytest.fixture()
def gen_env(db_session, tmp_path, monkeypatch):
    """Point document_service at a tmp data dir and stub the PDF chain."""
    from app.config import Settings

    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    _seed_gs(db_session)
    return db_session


def test_committed_general_book_gets_classified_ref(gen_env):
    db = gen_env
    result = document_service.generate_document(
        db,
        employee_id=None,
        template_id="General Book",
        fields={"subject": "تصريح أمني", "body": "<p>مرحبا</p>"},
        commit=True,
        classification_code="5/1",
    )
    assert result.ref_number == "1/5/GSSG/1"
    book = db.query(Book).filter_by(ref_number="1/5/GSSG/1").one()
    assert book.classification_code == "5/1"
    assert book.category_id == "GS"


def test_committed_general_book_without_classification_rejected(gen_env):
    db = gen_env
    with pytest.raises(ValidationFailedError) as exc_info:
        document_service.generate_document(
            db,
            employee_id=None,
            template_id="General Book",
            fields={"subject": "x", "body": "<p>x</p>"},
            commit=True,
        )
    assert exc_info.value.code == "CLASSIFICATION_REQUIRED"


def test_unknown_classification_rejected(gen_env):
    db = gen_env
    with pytest.raises(ValidationFailedError) as exc_info:
        document_service.generate_document(
            db,
            employee_id=None,
            template_id="General Book",
            fields={"subject": "x", "body": "<p>x</p>"},
            commit=True,
            classification_code="99/9",
        )
    assert exc_info.value.code == "UNKNOWN_CLASSIFICATION"


def test_preview_burns_no_serial_and_needs_no_classification(gen_env):
    db = gen_env
    result = document_service.generate_document(
        db,
        employee_id=None,
        template_id="General Book",
        fields={"subject": "معاينة", "body": "<p>x</p>"},
        commit=False,
    )
    assert result.ref_number == "DRAFT"
    seq = db.get(ClassifiedRefSequence, 1)
    assert seq is None or seq.next_value == 1


def test_serial_is_shared_with_word_path(gen_env, tmp_path, monkeypatch):
    """Rich-editor and Word creates draw from ONE register — serials interleave."""
    import shutil

    from app.config import Settings
    from app.db.models import User
    from app.services import word_book_service

    db = gen_env

    # Word path needs its own settings (templates_dir with the real template)
    templates = tmp_path / "templates"
    templates.mkdir(exist_ok=True)
    shutil.copy2(
        str(document_service._TEMPLATES_DIR / "GSSG-GS_300-003_General_Book.docx"),
        str(templates / "GSSG-GS_300-003_General_Book.docx"),
    )
    word_settings = Settings(data_dir=tmp_path / "data", templates_dir=templates)
    monkeypatch.setattr(word_book_service, "get_settings", lambda: word_settings)

    user = User(email="w@test.ae", password_hash="x", status="active")
    db.add(user)
    db.commit()

    r1 = document_service.generate_document(
        db,
        employee_id=None,
        template_id="General Book",
        fields={"subject": "أول", "body": "<p>x</p>"},
        commit=True,
        classification_code="3/1",
    )
    info = word_book_service.create_word_book(
        db,
        user=user,
        classification_code="5/1",
        recipient_id=None,
        subject="ثاني",
        cc=None,
        manager_id=None,
    )
    assert r1.ref_number == "1/3/GSSG/1"
    assert info.ref_number == "1/5/GSSG/2"
