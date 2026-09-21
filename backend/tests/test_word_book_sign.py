"""Signing a Word-authored General Book must keep the authored body."""

import zipfile
from pathlib import Path

import pytest
from docx import Document as DocxFile
from sqlalchemy.orm import Session

from app.core.book_text import docx_to_text
from app.db.models import Book, BookCategory, BookVersion, Document
from app.services import document_service

BODY_LINE = "نرجو الموافقة على أعمال الصيانة العاجلة"


@pytest.fixture
def word_version(db_session: Session, tmp_path: Path) -> BookVersion:
    """A finished word-authored book: Document docx on disk, version.fields == {}."""
    docx_path = tmp_path / "1-11-9.docx"
    d = DocxFile()
    d.add_paragraph(BODY_LINE)
    d.add_paragraph("")
    d.add_paragraph("سعيد راشد اليحيائي")
    d.save(str(docx_path))

    if db_session.get(BookCategory, "GS") is None:
        db_session.add(BookCategory(id="GS", prefix="GS"))
        db_session.flush()
    book = Book(category_id="GS", ref_number="1/11/9", subject="اختبار التوقيع")
    db_session.add(book)
    db_session.flush()
    doc = Document(
        template_id="General Book",
        ref_number=book.ref_number,
        docx_path=str(docx_path),
        submission_id="t-sign",
        role="primary",
    )
    db_session.add(doc)
    db_session.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        trigger="initial",
        status="none",
        template_id="General Book",
        fields={},
        document_id=doc.id,
    )
    db_session.add(version)
    db_session.commit()
    return version


def _sig(tmp_path: Path) -> str:
    from PIL import Image

    p = tmp_path / "sig.png"
    Image.new("RGBA", (60, 30), (0, 0, 200, 255)).save(p)
    return str(p)


def test_signed_artifact_keeps_word_body(
    db_session: Session,
    tmp_path: Path,
    word_version: BookVersion,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # PDF conversion is environment-dependent — force the docx fallback path.
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    artifact = document_service.render_signed_artifact(
        db_session, version=word_version, signer_signature_path=_sig(tmp_path)
    )
    signed = artifact.docx_path
    assert signed.suffix == ".docx"  # conversion stubbed out
    text = docx_to_text(signed)
    assert BODY_LINE in text  # the authored body SURVIVED signing
    # and the signature image landed (a drawing is present — General Book's
    # keep-together signing block inserts it INLINE, not as a float, so Word
    # counts its height when deciding whether the signature/name/title group
    # fits on the page; see docx_engine._stamp_manager_signing_block).
    with zipfile.ZipFile(signed) as z:
        assert b"<w:drawing" in z.read("word/document.xml")
    signed.unlink()  # keep the shared output dir clean


def test_sign_raises_when_authored_docx_missing(
    db_session: Session,
    tmp_path: Path,
    word_version: BookVersion,
) -> None:
    """fields == {} with the docx gone must FAIL loudly — falling through to the
    template re-render would reproduce the blank signed paper (review M2)."""
    from app.api.errors import AppError

    doc = db_session.get(Document, word_version.document_id)
    assert doc is not None and doc.docx_path
    Path(doc.docx_path).unlink()
    with pytest.raises(AppError) as ei:
        document_service.render_signed_artifact(
            db_session, version=word_version, signer_signature_path=_sig(tmp_path)
        )
    assert ei.value.code == "SOURCE_DOCX_MISSING"


def test_sign_raises_when_stamp_fails(
    db_session: Session,
    tmp_path: Path,
    word_version: BookVersion,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 'signed' artifact with no visible signature is the defect class this
    branch fixes — a failed stamp must abort the signing (review M1)."""
    import app.core.docx_engine as docx_engine_mod
    from app.api.errors import AppError

    monkeypatch.setattr(docx_engine_mod, "stamp_signature_above_name", lambda *a, **k: False)
    with pytest.raises(AppError) as ei:
        document_service.render_signed_artifact(
            db_session, version=word_version, signer_signature_path=_sig(tmp_path)
        )
    assert ei.value.code == "SIGNATURE_STAMP_FAILED"


def test_resolve_signature_linked_user_uses_profile(
    db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import Settings
    from app.db.models import Employee, User
    from app.services import user_signature_service

    settings = Settings(data_dir=tmp_path)
    monkeypatch.setattr(user_signature_service, "get_settings", lambda: settings)
    profile = user_signature_service.employee_signature_path("G7001", vault_dir=settings.vault_dir)
    profile.parent.mkdir(parents=True)
    from PIL import Image

    Image.new("RGBA", (80, 40), (0, 0, 200, 255)).save(profile)

    db_session.add(Employee(id="G7001", name_en="Signer Emp"))
    db_session.flush()
    user = User(
        email="signer@test.ae",
        password_hash="x",
        role="manager",
        status="active",
        employee_id="G7001",
        signature_path=None,
    )
    db_session.add(user)
    db_session.commit()

    assert user_signature_service.resolve_signature(user) == profile


def test_resolve_signature_unlinked_user_uses_own_signature_path(
    db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import Settings
    from app.db.models import User
    from app.services import user_signature_service

    monkeypatch.setattr(user_signature_service, "get_settings", lambda: Settings(data_dir=tmp_path))
    own = tmp_path / "own.png"
    from PIL import Image

    Image.new("RGBA", (80, 40), (0, 0, 0, 255)).save(own)
    user = User(
        email="own@test.ae",
        password_hash="x",
        role="manager",
        status="active",
        signature_path=str(own),
    )
    db_session.add(user)
    db_session.commit()

    assert user_signature_service.resolve_signature(user) == own


def test_rich_versions_still_rerender(
    db_session: Session,
    tmp_path: Path,
    word_version: BookVersion,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A version WITH fields keeps the existing template re-render path."""
    word_version.fields = {"subject": "موضوع", "body": "نص"}
    db_session.commit()
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    artifact = document_service.render_signed_artifact(
        db_session, version=word_version, signer_signature_path=_sig(tmp_path)
    )
    leftover = artifact.docx_path
    text = docx_to_text(leftover)
    assert "موضوع" in text
    assert "نص" in text
    leftover.unlink(missing_ok=True)
