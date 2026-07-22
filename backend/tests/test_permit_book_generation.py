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

from app.db.models import Book, BookCategory
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
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 8, 1),
        people=[{"name": "Ali", "uae_id": "784-1", "nationality": "مصر"}],
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
