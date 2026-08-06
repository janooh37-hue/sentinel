"""Permit letters ride the book approval chain (spec 2026-07-27).

Create-time behavior: send_for_approval=True (default) submits the letter to
the permit's manager; False holds it as a draft. A manager without a linked
login account must NOT fail the permit mutation — the book stays draft and an
audit row records why.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    AuditLog,
    Book,
    BookCategory,
    BookEditSession,
    BookVersion,
    Document,
    Manager,
    User,
)
from app.schemas.permit import PermitCreate
from app.services import document_service, permit_service


def _seed_gs(db: Session) -> None:
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.commit()


@pytest.fixture()
def gen_env(db_session: Session, tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> Session:
    """Point document_service at a tmp data dir and stub the PDF chain."""
    from app.config import Settings

    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    _seed_gs(db_session)
    return db_session


def _actor(db: Session) -> User:
    u = User(email="op@x.ae", password_hash="x", role="admin", status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _linked_manager(db: Session) -> tuple[Manager, User]:
    u = User(email="mgr@x.ae", password_hash="x", role="admin", status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    m = Manager(name_en="Boss", user_id=u.id)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m, u


def _payload(**kw: Any) -> PermitCreate:
    base: dict[str, Any] = dict(
        company="ACME",
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        start_date=date(2026, 7, 1),
        validity={"value": 1, "unit": "month"},
        people=[{"name": "Ali", "uae_id": "784-1", "nationality": "مصر", "role": "Electrician"}],
        vehicles=[],
    )
    base.update(kw)
    return PermitCreate(**base)


def _latest_version(db: Session, book_id: int):
    book = db.get_one(Book, book_id)
    return book, max(book.versions, key=lambda v: v.version_no)


def _audit_actions(db: Session) -> list[str]:
    return list(db.scalars(select(AuditLog.action)))


def test_create_with_flag_off_stays_draft(gen_env: Session) -> None:
    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=False), actor="op@x.ae"
    )
    book, latest = _latest_version(db, permit.book_id)
    assert book.approval_state == "none"
    assert latest.approval_steps == []
    assert "permit.book_submitted" not in _audit_actions(db)


def test_create_with_flag_submits_to_manager(gen_env: Session) -> None:
    db = gen_env
    _actor(db)
    mgr, mgr_user = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=True), actor="op@x.ae"
    )
    book, latest = _latest_version(db, permit.book_id)
    assert book.approval_state == "pending"
    steps = sorted(latest.approval_steps, key=lambda s: s.step_order)
    assert steps and steps[0].assignee_user_id == mgr_user.id
    assert steps[0].state == "pending"
    assert "permit.book_submitted" in _audit_actions(db)


def test_create_flag_with_unlinked_manager_leaves_draft(gen_env: Session) -> None:
    """APPROVER_REQUIRED must not blow up permit creation — draft + audit."""
    db = gen_env
    _actor(db)
    m = Manager(name_en="Names Only")  # no user_id
    db.add(m)
    db.commit()
    db.refresh(m)
    permit = permit_service.create_permit(
        db, _payload(manager_id=m.id, send_for_approval=True), actor="op@x.ae"
    )
    book, _ = _latest_version(db, permit.book_id)
    assert book.approval_state == "none"
    assert "permit.book_submit_failed" in _audit_actions(db)


def _set_state(db: Session, book_id: int, state: str) -> None:
    db.get_one(Book, book_id).approval_state = state
    db.commit()


def test_regen_resubmits_when_pending(gen_env: Session) -> None:
    """A pending letter is withdrawn, re-rendered in place (draft-edit path,
    same single version), and resubmitted — no stale steps left behind."""
    from app.schemas.permit import PermitVehicleCreate

    db = gen_env
    _actor(db)
    mgr, mgr_user = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=True), actor="op@x.ae"
    )
    permit_service.add_vehicle(db, permit.id, PermitVehicleCreate(plate_no="A 1"), actor="op@x.ae")
    book, latest = _latest_version(db, permit.book_id)
    assert len(book.versions) == 1  # in-place draft edit, no version churn
    assert book.approval_state == "pending"
    steps = sorted(latest.approval_steps, key=lambda s: s.step_order)
    assert len(steps) == 1  # fresh chain only — the withdrawn step is gone
    assert steps[0].assignee_user_id == mgr_user.id
    assert steps[0].state == "pending"


def test_regen_resubmits_when_approved(gen_env: Session) -> None:
    """An approved (signed) letter is never edited in place — a fresh version
    is appended (history kept) and immediately resubmitted."""
    from app.schemas.permit import PermitPersonCreate

    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=True), actor="op@x.ae"
    )
    _set_state(db, permit.book_id, "approved")
    permit_service.add_person(
        db,
        permit.id,
        PermitPersonCreate(name="Omar", uae_id="784-2", role="Electrician"),
        actor="op@x.ae",
    )
    book, latest = _latest_version(db, permit.book_id)
    assert len(book.versions) == 2  # prior (signed) version preserved
    assert book.approval_state == "pending"
    assert any(s.state == "pending" for s in latest.approval_steps)


def test_regen_after_rejection_lands_as_fresh_draft(gen_env: Session) -> None:
    """No auto-resubmit after a rejection: the edit produces a fresh draft
    version (generate_document's revise semantics reset the book to 'none');
    the operator reviews and explicitly resends via the button."""
    from app.schemas.permit import PermitPersonCreate

    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=True), actor="op@x.ae"
    )
    _set_state(db, permit.book_id, "rejected")
    permit_service.add_person(
        db,
        permit.id,
        PermitPersonCreate(name="Omar", uae_id="784-2", role="Electrician"),
        actor="op@x.ae",
    )
    book, latest = _latest_version(db, permit.book_id)
    assert book.approval_state == "none"  # fresh draft — NOT auto-resubmitted
    assert latest.approval_steps == []


def test_regen_never_sent_stays_draft(gen_env: Session) -> None:
    from app.schemas.permit import PermitVehicleCreate

    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=False), actor="op@x.ae"
    )
    permit_service.add_vehicle(db, permit.id, PermitVehicleCreate(plate_no="A 1"), actor="op@x.ae")
    book, _ = _latest_version(db, permit.book_id)
    assert book.approval_state == "none"


def test_manual_submit_happy_path(gen_env: Session) -> None:
    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=False), actor="op@x.ae"
    )
    row = permit_service.submit_permit_book(db, permit.id, actor="op@x.ae")
    book, _ = _latest_version(db, permit.book_id)
    assert book.approval_state == "pending"
    read = permit_service.to_read(row, db=db)
    assert read.approval_state == "pending"


def test_manual_submit_unlinked_manager_raises(gen_env: Session) -> None:
    from app.api.errors import ValidationFailedError

    db = gen_env
    _actor(db)
    m = Manager(name_en="Names Only")
    db.add(m)
    db.commit()
    db.refresh(m)
    permit = permit_service.create_permit(db, _payload(manager_id=m.id), actor="op@x.ae")
    with pytest.raises(ValidationFailedError):
        permit_service.submit_permit_book(db, permit.id, actor="op@x.ae")


def test_manual_submit_revoked_raises(gen_env: Session) -> None:
    from app.api.errors import ValidationFailedError

    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id), actor="op@x.ae")
    permit_service.revoke_permit(db, permit.id, actor="op@x.ae")
    with pytest.raises(ValidationFailedError):
        permit_service.submit_permit_book(db, permit.id, actor="op@x.ae")


def test_to_read_exposes_draft_state(gen_env: Session) -> None:
    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=False), actor="op@x.ae"
    )
    read = permit_service.to_read(permit, db=db)
    assert read.approval_state == "none"


def test_create_default_submits_to_manager(gen_env: Session) -> None:
    """The default (no flag passed) must reach the manager — a new permit lands
    in his approval queue without the operator doing anything extra."""
    db = gen_env
    _actor(db)
    mgr, mgr_user = _linked_manager(db)
    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id), actor="op@x.ae")
    book, latest = _latest_version(db, permit.book_id)
    assert book.approval_state == "pending"
    assert [s.assignee_user_id for s in latest.approval_steps] == [mgr_user.id]


def test_new_permit_lands_in_the_managers_awaiting_queue(gen_env: Session) -> None:
    """End to end: the whole point of the feature. A newly created permit must
    show up in the signing manager's "awaiting my approval" list (the query
    behind the dashboard widget and the bell count) — and in nobody else's."""
    from app.services import book_service

    db = gen_env
    operator = _actor(db)
    mgr, mgr_user = _linked_manager(db)
    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id), actor="op@x.ae")

    awaiting = book_service.list_awaiting(db, user_id=mgr_user.id)
    assert [b.id for b in awaiting] == [permit.book_id]
    assert book_service.your_step_kind(awaiting[0], mgr_user.id) == "approver"
    # The operator who raised it is not an approver of it.
    assert book_service.list_awaiting(db, user_id=operator.id) == []


def test_pending_word_version_survives_structured_regeneration(gen_env, tmp_path, monkeypatch):
    """A finished Word snapshot stays immutable when a pending permit changes."""
    from app.config import Settings
    from app.schemas.permit import PermitVehicleCreate
    from app.services import word_book_service

    db = gen_env
    settings = Settings(data_dir=tmp_path / "data", templates_dir=tmp_path / "templates")
    monkeypatch.setattr(word_book_service, "get_settings", lambda: settings)
    monkeypatch.setattr(
        word_book_service, "convert_docx_to_pdf", lambda path: path.with_suffix(".pdf")
    )

    _actor(db)
    manager, _ = _linked_manager(db)
    permit = permit_service.create_permit(
        db,
        _payload(manager_id=manager.id, send_for_approval=False),
        actor="op@x.ae",
    )
    book = db.get(Book, permit.book_id)
    assert book is not None
    initial = max(book.versions, key=lambda version: version.version_no)
    initial_document = db.get(Document, initial.document_id)
    assert initial_document is not None
    initial_path = Path(initial_document.docx_path)
    initial_path.parent.mkdir(parents=True, exist_ok=True)
    initial_path.write_bytes(b"PK generated permit docx")

    word_book_service.reopen_word_session(
        db, user=db.query(User).filter_by(email="op@x.ae").one(), book_id=book.id
    )
    session = db.query(BookEditSession).filter_by(book_id=book.id, state="active").one()
    session.last_put_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()
    word_book_service.finish_word_session(
        db,
        user=db.query(User).filter_by(email="op@x.ae").one(),
        book_id=book.id,
    )

    db.refresh(book)
    word_version = max(book.versions, key=lambda version: version.version_no)
    word_document = db.get(Document, word_version.document_id)
    assert word_document is not None
    assert word_version.fields == {}
    old_snapshot = (
        word_version.id,
        word_document.id,
        word_document.docx_path,
        word_document.pdf_path,
    )

    permit_service.submit_permit_book(db, permit.id, actor="op@x.ae")
    db.refresh(book)
    assert book.approval_state == "pending"

    permit_service.add_vehicle(
        db,
        permit.id,
        PermitVehicleCreate(plate_no="A 1"),
        actor="op@x.ae",
    )

    db.refresh(book)
    assert [version.version_no for version in book.versions] == [1, 2, 3]
    preserved = db.get(BookVersion, old_snapshot[0])
    assert preserved is not None
    preserved_document = db.get(Document, old_snapshot[1])
    assert preserved_document is not None
    assert (
        preserved.id,
        preserved_document.id,
        preserved_document.docx_path,
        preserved_document.pdf_path,
    ) == old_snapshot

    latest = max(book.versions, key=lambda version: version.version_no)
    assert latest.version_no == 3
    assert latest.fields
    assert latest.document_id != old_snapshot[1]
    latest_document = db.get(Document, latest.document_id)
    assert latest_document is not None
    assert latest_document.docx_path != old_snapshot[2]
    assert latest_document.pdf_path != old_snapshot[3]
    assert book.approval_state == "pending"
    assert any(step.state == "pending" for step in latest.approval_steps)
