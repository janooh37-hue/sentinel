"""TDD tests for Task 5: permit → 1/5 General Book auto-generation.

RED first — run before implementing regenerate_permit_book.

Mirrors the gen_env pattern from test_general_book_classified_ref.py:
monkeypatches document_service.get_settings (data dir) and
document_service.convert_docx_to_pdf (no Word COM needed).
BookCategory GS is seeded so the classified ref allocator can write.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.db.models import Book, BookCategory, BookVersion, Document, Employee, User
from app.schemas.permit import PermitCreate, PermitVehicleCreate
from app.services import document_service, permit_service


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


def _payload(**kw):
    base = dict(
        company="ACME",
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        start_date=date(2026, 7, 1),
        validity={"value": 2, "unit": "month"},
        people=[{"name": "Ali", "uae_id": "784-1", "nationality": "مصر", "role": "Electrician"}],
        vehicles=[],
    )
    base.update(kw)
    return PermitCreate(**base)


def test_create_permit_generates_1_5_book(gen_env):
    db = gen_env
    permit = permit_service.create_permit(db, _payload())
    assert permit.book_id is not None
    book = db.get(Book, permit.book_id)
    assert book is not None
    assert book.classification_code == "5/1"
    assert book.ref_number.startswith("1/5/")


def test_generated_book_body_preserves_location_zone_pairings(gen_env, monkeypatch):
    captured: dict[str, str] = {}
    original = document_service.generate_document

    def _spy(*args, **kw):
        captured["body"] = kw["fields"]["body"]
        return original(*args, **kw)

    monkeypatch.setattr(document_service, "generate_document", _spy)
    permit_service.create_permit(
        gen_env,
        _payload(
            access_areas={"al_wathba_1": ["green"], "al_wathba_2": ["red"], "work_residence": False}
        ),
    )

    body = captured["body"]
    assert "Electrician" in body
    assert "المهنة" in body
    assert "شهران" in body
    assert "2026/08/31" not in body
    w1_start = body.index("الوثبة 1")
    w2_start = body.index("الوثبة 2")
    assert "المنطقة الخضراء" in body[w1_start:w2_start]
    assert "المنطقة الحمراء" not in body[w1_start:w2_start]
    w2_fragment = body[w2_start : body.index("</td>", w2_start)]
    assert "المنطقة الحمراء" in w2_fragment
    assert "المنطقة الخضراء" not in w2_fragment


def test_submitter_g_resolved_from_actor(gen_env, monkeypatch):
    """The issuing operator's G-number reaches the footer: regenerate resolves
    the actor's User row and threads it as generate_document(current_user=...)."""
    db = gen_env
    db.add(Employee(id="G-9001", name_en="Op"))
    db.add(
        User(
            email="op@x.ae", password_hash="x", role="admin", status="active", employee_id="G-9001"
        )
    )
    db.commit()

    captured: dict = {}
    orig = document_service.generate_document

    def _spy(*args, **kw):
        captured["current_user"] = kw.get("current_user")
        return orig(*args, **kw)

    monkeypatch.setattr(document_service, "generate_document", _spy)
    permit_service.create_permit(db, _payload(), actor="op@x.ae")
    assert captured["current_user"] is not None
    assert captured["current_user"].employee_id == "G-9001"


def test_roster_change_reversions_same_ref(gen_env):
    db = gen_env
    permit = permit_service.create_permit(db, _payload())
    ref_before = db.get(Book, permit.book_id).ref_number
    permit_service.add_vehicle(
        db,
        permit.id,
        PermitVehicleCreate(plate_no="A 1"),
    )
    # Same ref (revise path), new version — ref_number unchanged
    assert db.get(Book, permit.book_id).ref_number == ref_before


def test_to_read_exposes_book_ref(gen_env):
    db = gen_env
    permit = permit_service.create_permit(db, _payload())
    read = permit_service.to_read(permit, db=db)
    assert read.book_id == permit.book_id
    assert read.book_ref is not None
    assert read.book_ref.startswith("1/5/")


def test_revoke_does_not_regenerate(gen_env, monkeypatch):
    """Revoking keeps the last letter — no new book version."""
    db = gen_env
    permit = permit_service.create_permit(db, _payload())
    calls: list[str] = []
    orig = permit_service.regenerate_permit_book

    def _spy(db, permit, **kw):
        calls.append("called")
        return orig(db, permit, **kw)

    monkeypatch.setattr(permit_service, "regenerate_permit_book", _spy)
    permit_service.revoke_permit(db, permit.id, reason="test")
    assert calls == []  # regenerate was NOT called


def _mark_latest_as_finished_word(db, permit_id: int) -> tuple[int, str, str | None]:
    permit = permit_service.get_permit(db, permit_id)
    assert permit.book_id is not None
    book = db.get(Book, permit.book_id)
    assert book is not None and book.versions
    latest = book.versions[-1]
    assert latest.document_id is not None
    document = db.get(Document, latest.document_id)
    assert document is not None
    latest.fields = {}
    db.commit()
    return latest.id, document.docx_path, document.pdf_path


def test_finished_word_version_survives_structured_regeneration_with_pdf(gen_env, monkeypatch):
    db = gen_env
    monkeypatch.setattr(
        document_service, "convert_docx_to_pdf", lambda path: path.with_suffix(".pdf")
    )
    permit = permit_service.create_permit(db, _payload())
    old_version_id, old_docx_path, old_pdf_path = _mark_latest_as_finished_word(db, permit.id)

    permit_service.add_vehicle(db, permit.id, PermitVehicleCreate(plate_no="A 1"))

    book = db.get(Book, permit.book_id)
    assert book is not None
    assert [version.version_no for version in book.versions] == [1, 2]
    assert book.approval_state == "none"
    assert book.versions[-1].status == "none"
    old_version = db.get(BookVersion, old_version_id)
    assert old_version is not None
    old_document = db.get(Document, old_version.document_id)
    assert old_document is not None
    assert old_version.fields == {}
    assert (old_document.docx_path, old_document.pdf_path) == (old_docx_path, old_pdf_path)
    latest_document = db.get(Document, book.versions[-1].document_id)
    assert latest_document is not None and latest_document.pdf_path is not None


def test_finished_word_version_keeps_older_pdf_when_new_conversion_returns_none(
    gen_env, monkeypatch
):
    db = gen_env
    monkeypatch.setattr(
        document_service, "convert_docx_to_pdf", lambda path: path.with_suffix(".pdf")
    )
    permit = permit_service.create_permit(db, _payload())
    old_version_id, _, old_pdf_path = _mark_latest_as_finished_word(db, permit.id)
    assert old_pdf_path is not None

    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda path: None)
    permit_service.add_vehicle(db, permit.id, PermitVehicleCreate(plate_no="A 2"))

    book = db.get(Book, permit.book_id)
    assert book is not None and len(book.versions) == 2
    old_version = db.get(BookVersion, old_version_id)
    assert old_version is not None
    old_document = db.get(Document, old_version.document_id)
    from app.api.v1.books import _build_versions

    payload = _build_versions(db, book)
    old_payload = next(version for version in payload if version.version_no == 1)
    latest_payload = next(version for version in payload if version.version_no == 2)
    assert old_payload.pdf_url is not None
    assert latest_payload.pdf_url is None
    latest_document = db.get(Document, book.versions[-1].document_id)
    assert old_document is not None and old_document.pdf_path == old_pdf_path
    assert latest_document is not None and latest_document.pdf_path is None



def test_permit_letter_renders_from_its_own_paper(gen_env):
    """The permit letter is a General Book clone on a SEPARATE .docx, so the
    permit form can be restyled without touching every other 1/x letter."""
    from pathlib import Path

    from app.core.constants import TEMPLATE_FILES

    permit_file = TEMPLATE_FILES["Security Permit"]
    assert permit_file != TEMPLATE_FILES["General Book"]
    templates_dir = Path(document_service._TEMPLATES_DIR)
    assert (templates_dir / permit_file).is_file()

    db = gen_env
    permit = permit_service.create_permit(db, _payload())
    book = db.get(Book, permit.book_id)
    assert book is not None
    version = book.versions[-1]
    assert version.template_id == "Security Permit"
    document = db.get(Document, version.document_id)
    assert document is not None and document.template_id == "Security Permit"


def test_permit_book_still_files_under_the_general_book_rail(gen_env):
    """Splitting the paper must not move permit letters out of their Records
    bucket, and must not put a Security Permit tile in the Services gallery."""
    from app.core.form_kind import resolve_service
    from app.services import template_service

    db = gen_env
    permit = permit_service.create_permit(db, _payload())
    book = db.get(Book, permit.book_id)
    assert book is not None
    assert resolve_service(book.subject, book.versions[-1].template_id, versioned=True) == (
        "General Book"
    )
    assert "Security Permit" not in {m.id for m in template_service.list_templates().items}


def test_permit_letter_takes_the_full_classified_paper_pipeline(gen_env):
    """The four things that break SILENTLY if a classified-paper branch in
    document_service misses the new template id: classified ref allocation, the
    Arabic «الرقم:» body line (which replaces the English header stamp), the
    page-2+ footer sync, and the rich HTML body."""
    import zipfile
    from pathlib import Path

    db = gen_env
    permit = permit_service.create_permit(db, _payload())
    book = db.get(Book, permit.book_id)
    assert book is not None
    # 1. Ref came from the classified register (1/{tab}/{serial}), not the
    #    legacy HR-#### counter.
    assert book.ref_number.startswith("1/5/")

    document = db.get(Document, book.versions[-1].document_id)
    assert document is not None
    docx = Path(document.docx_path)
    if not docx.is_absolute():
        docx = Path(document_service.get_settings().data_dir) / docx
    with zipfile.ZipFile(docx) as z:
        body = z.read("word/document.xml").decode("utf-8")
        # 2. footer2 (pages 2+) was synced from footer3 (page 1).
        assert z.read("word/footer2.xml") == z.read("word/footer3.xml")
    # 3. The ref renders into the paper itself.
    assert book.ref_number in body
    # 4. The body arrived as rendered Word content, not a flattened sentinel:
    #    the people table and its Arabic caption are really in the document.
    assert document_service.GENERAL_BOOK_BODY_SENTINEL not in body
    assert "الجدول الأول" in body
    assert "Electrician" in body