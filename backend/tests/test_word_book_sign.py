"""Signing a Word-authored General Book must keep the authored body."""

import re
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
    # and the signature image landed as a behind-text FLOAT (not inline) —
    # General Book's keep-together signing block floats it so the image
    # never grows the paragraph's layout height and displaces the authored
    # body/name/title; see docx_engine._stamp_manager_signing_block.
    with zipfile.ZipFile(signed) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    assert "<w:drawing" in xml
    assert "<wp:anchor" in xml  # floated, not "<wp:inline"
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
    from app.core import signature as signature_core
    from app.db.models import Employee, User
    from app.services import user_signature_service

    settings = Settings(data_dir=tmp_path)
    monkeypatch.setattr(user_signature_service, "get_settings", lambda: settings)
    profile = signature_core.employee_signature_path(settings.vault_dir, "G7001")
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


def _manager_drawing_kind(docx_path: Path) -> str | None:
    """'anchor' (floated) or 'inline' for the drawing carrying the
    ``gssg-signature:v1:manager:`` identity marker, or None if absent."""
    with zipfile.ZipFile(docx_path) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    match = re.search(r"gssg-signature:v1:manager:[0-9a-f]{32}", xml)
    if match is None:
        return None
    head = xml[: match.start()]
    anchor_idx = head.rfind("<wp:anchor")
    inline_idx = head.rfind("<wp:inline")
    if anchor_idx > inline_idx:
        return "anchor"
    if inline_idx > anchor_idx:
        return "inline"
    return None


@pytest.mark.parametrize("template_id", ["General Book", "Security Permit"])
@pytest.mark.parametrize("with_bookmark", [False, True], ids=["fallback-scan", "bookmark"])
def test_authored_manager_signature_floats_in_keep_together_templates(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    template_id: str,
    with_bookmark: bool,
) -> None:
    """General Book / Security Permit's "keep manager block together" path
    must FLOAT the manager signature behind text (the pre-feature/restored
    placement), not insert it inline — an inline image participates in
    paragraph layout and visibly displaces the authored body/name/title,
    which is the regression this restores. Covers both the bookmark-first
    anchor (``GSSG_ManagerSignature``) and the name+title fallback scan.
    """
    from app.core._docx_helpers import wrap_paragraph_in_bookmark
    from app.core.constants import DEFAULT_MANAGER_NAME, DEFAULT_MANAGER_TITLE

    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)

    docx_path = tmp_path / f"{template_id.replace(' ', '_')}-{with_bookmark}.docx"
    d = DocxFile()
    d.add_paragraph(BODY_LINE)
    sig_gap = d.add_paragraph("")
    d.add_paragraph(DEFAULT_MANAGER_NAME)
    d.add_paragraph(DEFAULT_MANAGER_TITLE)
    if with_bookmark:
        wrap_paragraph_in_bookmark(sig_gap, "GSSG_ManagerSignature")
    d.save(str(docx_path))

    if db_session.get(BookCategory, "GS") is None:
        db_session.add(BookCategory(id="GS", prefix="GS"))
        db_session.flush()
    book = Book(category_id="GS", ref_number="1/11/9", subject="اختبار التوقيع")
    db_session.add(book)
    db_session.flush()
    doc = Document(
        template_id=template_id,
        ref_number=book.ref_number,
        docx_path=str(docx_path),
        submission_id=f"t-sign-{template_id}-{with_bookmark}",
        role="primary",
    )
    db_session.add(doc)
    db_session.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        trigger="initial",
        status="none",
        template_id=template_id,
        fields={},
        document_id=doc.id,
    )
    db_session.add(version)
    db_session.commit()

    artifact = document_service.render_signed_artifact(
        db_session, version=version, signer_signature_path=_sig(tmp_path)
    )
    signed = artifact.docx_path
    text = docx_to_text(signed)
    assert BODY_LINE in text  # authored body survives
    assert DEFAULT_MANAGER_NAME in text
    assert DEFAULT_MANAGER_TITLE in text
    assert _manager_drawing_kind(signed) == "anchor"  # floated, not inline
    signed.unlink()
