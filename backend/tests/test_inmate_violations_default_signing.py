"""Ordinary Inmate Conduct Violations generation waits for chain signing."""

from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document as DocxDocument
from PIL import Image

from app.db.models import Book, BookCategory, Employee, Manager
from app.services import document_service

INMATE_TEMPLATE = "Inmate Conduct Violations"


def _sig_png(path: Path) -> None:
    Image.new("RGBA", (40, 20), (0, 0, 0, 255)).save(path)


@pytest.fixture()
def gen_env(db_session, tmp_path, monkeypatch):
    """Use isolated artifacts without invoking Word for signing-state coverage."""
    from app.config import Settings

    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    for cat in ("INV", "HR"):
        if db_session.get(BookCategory, cat) is None:
            db_session.add(BookCategory(id=cat, prefix=cat))
    db_session.commit()
    return db_session


def _manager(db, tmp_path: Path) -> Manager:
    sig = tmp_path / "mgr_sig.png"
    _sig_png(sig)
    mgr = Manager(
        name_en="Nasser Fadhel Al Saedi",
        name_ar="ناصر فاضل الساعدي",
        title="مدير فرع شؤون النزلاء",
        sig_path=str(sig),
        active=True,
    )
    db.add(mgr)
    db.commit()
    return mgr


def _drawing_count(docx_path: Path) -> int:
    return DocxDocument(str(docx_path)).element.xml.count("<w:drawing>")


@pytest.mark.parametrize("embed_signature", (None, {"manager": False}, {"manager": True}))
def test_generation_waits_for_chain_signing(gen_env, tmp_path, embed_signature) -> None:
    db = gen_env
    db.add(Employee(id="G-2001", name_en="Abdullah Saif", name_ar="عبدالله سيف المنصوري"))
    mgr = _manager(db, tmp_path)

    result = document_service.generate_document(
        db,
        employee_id=None,
        template_id=INMATE_TEMPLATE,
        fields={
            "reporter_id": "G-2001",
            "inmates": [
                {"name": "a", "nationality": "b", "wing": "c", "uid": "1", "holding_no": "2"}
            ],
        },
        manager_id=mgr.id,
        submitter_id=None,
        embed_signature=embed_signature,
        commit=True,
        current_user=None,
    )

    assert _drawing_count(result.docx_path) == 0, "manager signed before chain approval"
    book = db.get(Book, result.book_id)
    assert book is not None
    assert book.approval_state == "none"
    version = max(book.versions, key=lambda item: item.version_no)
    assert version.manager_sig_embedded is False
