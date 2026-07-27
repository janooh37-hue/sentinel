"""Permit letters ride the book approval chain (spec 2026-07-27).

Create-time behavior: send_for_approval=False (default) leaves the letter a
draft; True submits it to the permit's manager. A manager without a linked
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
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 8, 1),
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


def test_create_without_flag_stays_draft(gen_env: Session) -> None:
    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id), actor="op@x.ae")
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
