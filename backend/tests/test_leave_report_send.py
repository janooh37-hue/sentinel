"""Leave report «Sign and send to manager»: the report is filed as a General
Book under 6/1 carrying the preparer's saved signature, and goes to the picked
approver; a preparer without a signature files nothing. «Save as PDF» renders
the same paper as a draft: no ref, no book, signature optional."""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path

import docx
import fitz
import pytest
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.config import Settings
from app.core.constants import DEFAULT_MANAGER_TITLE
from app.db.models import Book, BookApprovalStep, BookCategory, Document, Manager, User
from app.services import artifact_service, document_service, leave_service, user_signature_service
from tests.conftest import make_user


@pytest.fixture()
def env(api_db: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Session, Path]:
    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(artifact_service, "get_settings", lambda: settings)
    monkeypatch.setattr(user_signature_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    api_db.add(BookCategory(id="GS", prefix="GS"))
    api_db.commit()
    return api_db, settings.data_dir


def _write_pdf(docx_path: Path) -> Path:
    out = docx_path.with_suffix(".pdf")
    pdf = fitz.open()
    pdf.new_page()
    pdf.save(out)
    return out


@pytest.mark.parametrize("signed", [True, False])
def test_saved_pdf_is_an_unfiled_draft_with_or_without_a_signature(
    env, monkeypatch: pytest.MonkeyPatch, signed: bool
) -> None:
    db, data_dir = env
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", _write_pdf)
    user = (
        _preparer_with_signature(db, data_dir)[0]
        if signed
        else make_user(db, role="admin", email="nosig@x.ae")
    )

    pdf = leave_service.report_pdf(db, user, subject="تقرير", body_html="<p>x</p>")

    assert pdf.startswith(b"%PDF")
    assert db.scalar(select(func.count()).select_from(Book)) == 0
    draft = db.scalar(select(Document).order_by(Document.id.desc()))
    assert draft is not None and draft.ref_number == "DRAFT"
    paper = docx.Document(str(data_dir / draft.docx_path))
    assert len(paper.inline_shapes) == (1 if signed else 0)
    # No picked manager: the addressee names the default signing manager.
    addressee = next(p.text for p in paper.paragraphs if p.text.strip().startswith("السيد"))
    assert DEFAULT_MANAGER_TITLE in addressee


def _preparer_with_signature(db: Session, data_dir: Path) -> tuple[User, bytes]:
    user = make_user(db, role="admin", email="preparer@x.ae")
    user.display_name = "Preparer One"
    buf = BytesIO()
    Image.new("RGBA", (120, 40), (0, 0, 0, 255)).save(buf, format="PNG")
    png = buf.getvalue()
    path = data_dir / "signatures" / str(user.id) / "signature.png"
    path.parent.mkdir(parents=True)
    path.write_bytes(png)
    user.signature_path = str(path)
    db.commit()
    return user, png


def test_filed_report_carries_preparer_signature_and_goes_to_picked_approver(env) -> None:
    db, data_dir = env
    preparer, png = _preparer_with_signature(db, data_dir)
    approver = make_user(db, role="admin", email="manager@x.ae")

    book_id, ref = leave_service.send_report_for_approval(
        db,
        preparer,
        subject="تقرير الإجازات — 2026",
        body_html="<table><tr><td>G-1</td></tr></table>",
        approver_user_id=approver.id,
    )

    book = db.get(Book, book_id)
    assert book is not None and book.classification_code == "6/1"
    assert ref.startswith("1/6/")
    fields = book.versions[-1].fields
    body = fields["body"]
    assert body.startswith("<table><tr><td>G-1</td></tr></table>")
    assert "إعداد" in body and "Preparer One" in body
    assert base64.b64encode(png).decode("ascii") in body
    # No Manager row for the approver: the addressee falls back to the account.
    assert fields["recipient_name"] == "manager@x.ae"

    db.add(Manager(name_ar="سعيد", title="مدير المركز", user_id=approver.id, active=True))
    db.commit()
    second, _ = leave_service.send_report_for_approval(
        db, preparer, subject="s", body_html="<p>x</p>", approver_user_id=approver.id
    )
    assert db.get(Book, second).versions[-1].fields["recipient_name"] == "مدير المركز"
    steps = db.scalars(select(BookApprovalStep).where(BookApprovalStep.book_id == book_id)).all()
    assert [(s.kind, s.assignee_user_id, s.state) for s in steps] == [
        ("approver", approver.id, "pending")
    ]


def test_preparer_without_signature_files_nothing(env) -> None:
    db, _ = env
    preparer = make_user(db, role="admin", email="nosig@x.ae")
    approver = make_user(db, role="admin", email="manager@x.ae")

    with pytest.raises(ValidationFailedError) as err:
        leave_service.send_report_for_approval(
            db,
            preparer,
            subject="Leave report",
            body_html="<p>x</p>",
            approver_user_id=approver.id,
        )

    assert err.value.code == "SIGNATURE_REQUIRED"
    assert db.scalar(select(func.count()).select_from(Book)) == 0
