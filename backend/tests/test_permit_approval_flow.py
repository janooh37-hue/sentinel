"""Permit letters ride the book approval chain (spec 2026-07-27).

Create-time behavior: send_for_approval=True (default) submits the letter to
the permit's manager; False holds it as a draft. A manager without a linked
login account must NOT fail the permit mutation — the book stays draft and an
audit row records why.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditLog, Book, BookCategory, Manager, User
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
        people=[{"name": "Ali", "uae_id": "784-1", "nationality": "مصر"}],
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
        db, permit.id, PermitPersonCreate(name="Omar", uae_id="784-2"), actor="op@x.ae"
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
        db, permit.id, PermitPersonCreate(name="Omar", uae_id="784-2"), actor="op@x.ae"
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
