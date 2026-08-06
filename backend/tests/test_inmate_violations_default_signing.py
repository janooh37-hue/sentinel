"""Task 8 — Inmate Conduct Violations defaults its manager signature ON.

The checkbox stays per-form opt-out (the operator can still untick to
hand-sign), but a default submission — and any caller that omits
``embed_signature`` entirely (a script, a test, any non-UI path) — must land
signed AND routed to ``approval_state == "approved"``, not the silent
unsigned/unrouted dead end Task 7 caught (``document_service.py``'s
auto-forcing line was being skipped for this form because it declares an
optional ``hand_sign_manager`` checkbox, same as three sibling forms).

The per-field default lives in ``_fields.json`` (``hand_sign_manager.default
== "true"``) — scoped to this template only. The third test is the
regression guard for that scoping: a sibling form sharing the exact same
checkbox type/key must be unaffected.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document as DocxDocument
from PIL import Image

from app.db.models import Book, BookCategory, Employee, Manager
from app.services import document_service

INMATE_TEMPLATE = "Inmate Conduct Violations"
# Shares the hand_sign_checkbox type + "hand_sign_manager" key, but its
# _fields.json entry carries no `default` — must stay unaffected.
SIBLING_TEMPLATE = "Administrative Leave Form"


def _sig_png(path: Path) -> None:
    Image.new("RGBA", (40, 20), (0, 0, 0, 255)).save(path)


@pytest.fixture()
def gen_env(db_session, tmp_path, monkeypatch):
    """Point document_service at a tmp data dir; stub PDF conversion — Task 7
    already proved the real Word-COM path end to end, no need to re-pay that
    cost for a signing-state regression test."""
    from app.config import Settings

    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    for cat in ("NAT", "HR"):
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


def test_default_submission_embeds_signature_and_approves(gen_env, tmp_path) -> None:
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
        # Omitted entirely — the exact gap that shipped unsigned/unrouted.
        embed_signature=None,
        commit=True,
        current_user=None,
    )

    assert _drawing_count(result.docx_path) > 0, "signature not embedded on a default submission"
    book = db.get(Book, result.book_id)
    assert book is not None
    assert book.approval_state == "approved"


def test_explicit_untick_still_produces_unsigned_path(gen_env, tmp_path) -> None:
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
        embed_signature={"manager": False},  # explicit untick
        commit=True,
        current_user=None,
    )

    assert _drawing_count(result.docx_path) == 0, "signature embedded despite explicit untick"
    book = db.get(Book, result.book_id)
    assert book is not None
    assert book.approval_state == "none"


def test_sibling_form_still_defaults_to_unsigned(gen_env, tmp_path) -> None:
    """Regression guard for the app-wide constraint: only Inmate Conduct
    Violations may default on. Administrative Leave Form shares the exact
    same hand_sign_checkbox type + "hand_sign_manager" key and must be
    unaffected by the per-field default added for the other form."""
    db = gen_env
    db.add(Employee(id="G-3001", name_en="Ali Hassan", name_ar="علي حسن"))
    mgr = _manager(db, tmp_path)

    result = document_service.generate_document(
        db,
        employee_id="G-3001",
        template_id=SIBLING_TEMPLATE,
        fields={},
        manager_id=mgr.id,
        submitter_id=None,
        embed_signature=None,  # omitted, exactly like the default-submission test above
        commit=True,
        current_user=None,
    )

    assert _drawing_count(result.docx_path) == 0, (
        "sibling form's manager signature embedded by default"
    )
    book = db.get(Book, result.book_id)
    assert book is not None
    assert book.approval_state == "none"
