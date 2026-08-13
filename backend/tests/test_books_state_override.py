"""Admin state override — ``PUT /api/v1/books/{id}/state``.

Covers the contract of ``book_service.override_state``:

- the gate: ``books.override_state`` is admin-only by default, and delegable
  (a per-user grant works, so it is not welded to the role);
- reachability: every state in ``OVERRIDABLE_STATES`` can be forced, and the
  current version's status follows the aggregate;
- chain alignment: the stored state and the approval chain never end up telling
  two different stories (that was the whole risk of a raw column write);
- what the override must NOT do: fabricate a signature, or delete a filed
  signed artifact;
- the audit row, which is the only record that a human forced the state.
"""

from __future__ import annotations

import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import (
    AuditLog,
    Base,
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Employee,
    User,
    UserPermission,
)
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service
from app.services.book_service import OVERRIDABLE_STATES

STATE_PATH = "/api/v1/books/1/state"


@pytest.fixture()
def api_db(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Session:
    db_file = tmp_path / "test_books_state_override.db"
    eng = create_engine(
        f"sqlite:///{db_file}", future=True, connect_args={"check_same_thread": False}
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    db.add(BookCategory(id="HR", name_en="HR", prefix="HR"))
    db.commit()
    try:
        yield db
    finally:
        db.close()


def _user(db: Session, email: str, role: str, *, grant: str | None = None) -> User:
    user = User(email=email, password_hash="x", role=role, status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    if grant is not None:
        db.add(UserPermission(user_id=user.id, capability=grant, effect="grant"))
        db.commit()
    return user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _pending_record(db: Session, approver: User) -> Book:
    """A record mid-flight: one committed version awaiting its signing manager."""
    book = Book(id=1, category_id="HR", ref_number="HR-0001", approval_state="pending")
    version = BookVersion(id=1, book_id=1, version_no=1, trigger="initial", status="pending")
    version.approval_steps.append(
        BookApprovalStep(
            book_id=1,
            step_order=0,
            stage_label="Approve",
            assignee_user_id=approver.id,
            kind="approver",
            state="pending",
        )
    )
    book.versions.append(version)
    db.add(book)
    db.commit()
    return book


def _audit_rows(db: Session) -> list[AuditLog]:
    return list(
        db.execute(
            select(AuditLog).where(AuditLog.action == "book_state_override")
        ).scalars()
    )


def _reload(db: Session) -> tuple[Book, BookVersion | None]:
    db.expire_all()
    book = db.get(Book, 1)
    assert book is not None
    return book, (book.versions[-1] if book.versions else None)


# ── the gate ──────────────────────────────────────────────────────────────────


def test_manager_cannot_override_state(api_db: Session):
    """books.override_state is outside the manager preset: approving is not the
    same authority as rewriting who approved."""
    manager = _user(api_db, "manager@x.ae", "manager")
    _pending_record(api_db, manager)
    response = _client(api_db, manager).put(STATE_PATH, json={"state": "approved"})
    assert response.status_code == 403


def test_admin_can_override_state(api_db: Session):
    admin = _user(api_db, "admin@x.ae", "admin")
    _pending_record(api_db, admin)
    response = _client(api_db, admin).put(STATE_PATH, json={"state": "approved"})
    assert response.status_code == 200, response.text
    assert response.json()["approval_state"] == "approved"


def test_capability_is_delegable_to_a_manager(api_db: Session):
    """Admin-only *by default* — a deliberate grant is honored, so the authority
    can be delegated without editing code."""
    manager = _user(api_db, "granted@x.ae", "manager", grant="books.override_state")
    _pending_record(api_db, manager)
    response = _client(api_db, manager).put(STATE_PATH, json={"state": "none"})
    assert response.status_code == 200, response.text


# ── reachability ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("target", [s for s in OVERRIDABLE_STATES if s != "pending"])
def test_every_state_is_reachable_from_pending(api_db: Session, target: str):
    admin = _user(api_db, "admin@x.ae", "admin")
    _pending_record(api_db, admin)
    response = _client(api_db, admin).put(
        STATE_PATH, json={"state": target, "reason": "register repair"}
    )
    assert response.status_code == 200, response.text
    book, version = _reload(api_db)
    if target == "voided":
        # The one pseudo-state: stored as a discarded draft, not an approval state.
        assert book.approval_state == "none"
        assert book.voided_at is not None
    else:
        assert book.approval_state == target
        assert book.voided_at is None
    assert version is not None
    assert version.status == book.approval_state


def test_pending_is_reachable_from_a_chainless_draft(api_db: Session):
    """Forcing `pending` on a record that never had a chain builds one — without
    an assignee the state would be unactionable by anyone."""
    admin = _user(api_db, "admin@x.ae", "admin")
    book = Book(id=1, category_id="HR", ref_number="HR-0001", approval_state="none")
    book.versions.append(
        BookVersion(id=1, book_id=1, version_no=1, trigger="initial", status="none")
    )
    api_db.add(book)
    api_db.commit()

    response = _client(api_db, admin).put(STATE_PATH, json={"state": "pending"})
    assert response.status_code == 200, response.text
    _, version = _reload(api_db)
    assert version is not None
    steps = [s for s in version.approval_steps if s.kind == "approver"]
    assert len(steps) == 1
    assert steps[0].state == "pending"
    # No linked doc manager on this record, so the step parks on the acting admin.
    assert steps[0].assignee_user_id == admin.id


# ── chain alignment ───────────────────────────────────────────────────────────


def test_forcing_approved_settles_the_pending_step(api_db: Session):
    admin = _user(api_db, "admin@x.ae", "admin")
    _pending_record(api_db, admin)
    _client(api_db, admin).put(STATE_PATH, json={"state": "approved", "reason": "signed on paper"})
    _, version = _reload(api_db)
    assert version is not None
    step = version.approval_steps[0]
    assert step.state == "approved"
    assert step.decided_at is not None
    assert step.note == "signed on paper"


def test_forcing_approved_never_fabricates_a_signature(api_db: Session):
    """An administrative approval must not look like someone signed it."""
    admin = _user(api_db, "admin@x.ae", "admin")
    _pending_record(api_db, admin)
    _client(api_db, admin).put(STATE_PATH, json={"state": "approved"})
    _, version = _reload(api_db)
    assert version is not None
    assert version.signed_pdf_path is None
    assert version.signed_by_user_id is None
    assert version.signed_at is None
    assert version.manager_sig_embedded is False


def test_forcing_draft_clears_the_chain(api_db: Session):
    """A draft carries no chain in the normal flow, so a forced draft must not
    keep a stale decision hanging off it."""
    admin = _user(api_db, "admin@x.ae", "admin")
    _pending_record(api_db, admin)
    _client(api_db, admin).put(STATE_PATH, json={"state": "none"})
    _, version = _reload(api_db)
    assert version is not None
    assert version.approval_steps == []
    assert version.status == "none"


def test_forcing_pending_reopens_a_decided_step(api_db: Session):
    admin = _user(api_db, "admin@x.ae", "admin")
    _pending_record(api_db, admin)
    client = _client(api_db, admin)
    client.put(STATE_PATH, json={"state": "rejected", "reason": "wrong employee"})
    client.put(STATE_PATH, json={"state": "pending"})
    _, version = _reload(api_db)
    assert version is not None
    step = version.approval_steps[0]
    assert step.state == "pending"
    assert step.decided_at is None
    assert step.note is None


def test_forcing_rejected_records_the_reason_on_the_step(api_db: Session):
    admin = _user(api_db, "admin@x.ae", "admin")
    _pending_record(api_db, admin)
    _client(api_db, admin).put(STATE_PATH, json={"state": "returned", "reason": "resend to unit"})
    _, version = _reload(api_db)
    assert version is not None
    step = version.approval_steps[0]
    assert step.state == "returned"
    assert step.note == "resend to unit"


# ── voided is the other half of "record state" ────────────────────────────────


def test_voiding_and_un_voiding_a_record(api_db: Session):
    """The discarded-draft marker is a separate column but reads as a state, so
    the override owns both directions — this is the resurrect path."""
    admin = _user(api_db, "admin@x.ae", "admin")
    book = Book(id=1, category_id="HR", ref_number="HR-0001", approval_state="none")
    api_db.add(book)
    api_db.commit()
    client = _client(api_db, admin)

    voided = client.put(STATE_PATH, json={"state": "voided"})
    assert voided.status_code == 200, voided.text
    assert voided.json()["voided_at"] is not None
    assert voided.json()["is_draft"] is False

    revived = client.put(STATE_PATH, json={"state": "none"})
    assert revived.status_code == 200, revived.text
    assert revived.json()["voided_at"] is None
    assert revived.json()["is_draft"] is True


def test_voided_record_flips_straight_to_a_live_state(api_db: Session):
    admin = _user(api_db, "admin@x.ae", "admin")
    book = Book(id=1, category_id="HR", ref_number="HR-0001", approval_state="none")
    book.voided_at = datetime(2026, 1, 1, 12, 0, 0)
    api_db.add(book)
    api_db.commit()

    response = _client(api_db, admin).put(STATE_PATH, json={"state": "approved"})
    assert response.status_code == 200, response.text
    book, _ = _reload(api_db)
    assert book.voided_at is None
    assert book.approval_state == "approved"


# ── refusals ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("target", ["returned", "rejected"])
def test_negative_verdicts_require_a_reason(api_db: Session, target: str):
    """Same contract as the normal return/reject path."""
    admin = _user(api_db, "admin@x.ae", "admin")
    _pending_record(api_db, admin)
    response = _client(api_db, admin).put(STATE_PATH, json={"state": target, "reason": "   "})
    # ValidationFailedError is the app's 422 envelope, distinguished by `code`.
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REASON_REQUIRED"
    book, _ = _reload(api_db)
    assert book.approval_state == "pending"


def test_flipping_to_the_current_state_is_refused(api_db: Session):
    admin = _user(api_db, "admin@x.ae", "admin")
    _pending_record(api_db, admin)
    response = _client(api_db, admin).put(STATE_PATH, json={"state": "pending"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "STATE_UNCHANGED"
    assert _audit_rows(api_db) == []


def test_unknown_state_is_rejected_by_the_schema(api_db: Session):
    admin = _user(api_db, "admin@x.ae", "admin")
    _pending_record(api_db, admin)
    response = _client(api_db, admin).put(STATE_PATH, json={"state": "archived"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_missing_record_is_a_404(api_db: Session):
    admin = _user(api_db, "admin@x.ae", "admin")
    response = _client(api_db, admin).put("/api/v1/books/999/state", json={"state": "approved"})
    assert response.status_code == 404


# ── artifacts survive ─────────────────────────────────────────────────────────


def test_leaving_approved_keeps_the_signed_artifact(api_db: Session):
    """The override moves state, it does not destroy evidence — removing a filed
    signed copy stays the job of unfile_signed_copy."""
    admin = _user(api_db, "admin@x.ae", "admin")
    book = Book(id=1, category_id="HR", ref_number="HR-0001", approval_state="approved")
    book.versions.append(
        BookVersion(
            id=1,
            book_id=1,
            version_no=1,
            trigger="initial",
            status="approved",
            signed_pdf_path="book_attachments/HR-0001-signed.pdf",
        )
    )
    api_db.add(book)
    api_db.commit()

    response = _client(api_db, admin).put(STATE_PATH, json={"state": "awaiting_scan"})
    assert response.status_code == 200, response.text
    _, version = _reload(api_db)
    assert version is not None
    assert version.signed_pdf_path == "book_attachments/HR-0001-signed.pdf"
    # It stops being *served*, because serving keys on status == "approved".
    assert response.json()["versions"][0]["signed_pdf_url"] is None


# ── the audit trail ───────────────────────────────────────────────────────────


def test_override_writes_an_audit_row(api_db: Session):
    # users.employee_id is a real FK — the audit row's `actor` is that G number.
    api_db.add(Employee(id="G9001", name_en="Admin Person"))
    api_db.commit()
    admin = _user(api_db, "admin@x.ae", "admin")
    admin.employee_id = "G9001"
    api_db.commit()
    _pending_record(api_db, admin)

    _client(api_db, admin).put(
        STATE_PATH, json={"state": "approved", "reason": "signed on paper 2026-08-14"}
    )
    rows = _audit_rows(api_db)
    assert len(rows) == 1
    assert rows[0].actor == "G9001"
    assert rows[0].entity_type == "book"
    assert rows[0].entity_id == "1"
    payload = json.loads(rows[0].payload or "{}")
    assert payload["from"] == "pending"
    assert payload["to"] == "approved"
    assert payload["reason"] == "signed on paper 2026-08-14"
    assert payload["ref_number"] == "HR-0001"
    assert payload["actor_user_id"] == admin.id
