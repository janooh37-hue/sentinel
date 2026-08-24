"""GET /api/v1/books/approval-log — the approvals log (#31).

Covers the contract of the two scopes:

- ``sent``: every record the caller submitted (and only those), flattened to
  ApprovalLogItem rows carrying ref / subject / category / state / verdict /
  chain names / thumbnail document id;
- ``received``: the caller's pending steps (the ``list_awaiting`` semantics)
  PLUS their own decided steps from the last 30 days — the window boundary is
  inclusive;
- authority: ``received`` needs ``books.approve`` (mirrors /books/awaiting);
  ``sent`` is any authenticated user;
- paging: limit/offset with an honest total;
- routing: the literal ``approval-log`` segment must beat ``/{book_id}``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import (
    Base,
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Document,
    User,
)
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Session:
    db_file = tmp_path / "test_books_approval_log.db"
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
    db.add(BookCategory(id="HR", name_en="Human Resources", name_ar="الموارد البشرية", prefix="HR"))
    db.commit()
    try:
        yield db
    finally:
        db.close()


def _user(db: Session, email: str, role: str) -> User:
    user = User(email=email, password_hash="x", role=role, status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _days_ago(days: float) -> datetime:
    """Naive-UTC stamp ``days`` back — the clock every step stamp uses."""
    return datetime.now(UTC).replace(tzinfo=None) - timedelta(days=days)


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _submitted_book(
    db: Session,
    *,
    book_id: int,
    ref: str,
    submitter: User,
    approver: User,
    state: str = "pending",
    subject: str | None = None,
    document_id: int | None = None,
    approver_state: str = "pending",
    decided_at: datetime | None = None,
) -> Book:
    """A submitted record: one version carrying one approver step."""
    if document_id is not None:
        db.add(
            Document(
                id=document_id,
                template_id="general_book",
                ref_number=ref,
                submission_id=f"sub-{document_id}",
            )
        )
    book = Book(
        id=book_id,
        category_id="HR",
        ref_number=ref,
        subject=subject,
        approval_state=state,
        submitted_by_user_id=submitter.id,
    )
    version = BookVersion(
        id=book_id,
        book_id=book_id,
        version_no=1,
        trigger="initial",
        status=state,
        document_id=document_id,
    )
    step = BookApprovalStep(
        book_id=book_id,
        step_order=0,
        stage_label="Approve",
        assignee_user_id=approver.id,
        kind="approver",
        state=approver_state,
    )
    if decided_at is not None:
        step.decided_at = decided_at
    version.approval_steps.append(step)
    book.versions.append(version)
    db.add(book)
    db.commit()
    return book


# ── sent scope ────────────────────────────────────────────────────────────────


def test_sent_scope_lists_only_caller_submissions(api_db: Session):
    submitter = _user(api_db, "submitter@x.ae", "manager")
    other = _user(api_db, "other@x.ae", "manager")
    approver = _user(api_db, "approver@x.ae", "manager")
    _submitted_book(
        api_db,
        book_id=1,
        ref="HR-0001",
        submitter=submitter,
        approver=approver,
        state="approved",
        approver_state="approved",
        subject="Leave request — Ahmed",
        document_id=77,
        decided_at=_days_ago(1),
    )
    _submitted_book(api_db, book_id=2, ref="HR-0002", submitter=other, approver=approver)

    body = (
        _client(api_db, submitter)
        .get("/api/v1/books/approval-log", params={"scope": "sent"})
        .json()
    )

    assert body["total"] == 1
    assert len(body["items"]) == 1
    row = body["items"][0]
    assert row["book_id"] == 1
    assert row["ref_number"] == "HR-0001"
    assert row["subject"] == "Leave request — Ahmed"
    assert row["category_name_en"] == "Human Resources"
    assert row["category_name_ar"] == "الموارد البشرية"
    assert row["status"] == "approved"
    assert row["verdict"] == "approved"
    assert row["decided_at"] is not None
    assert row["document_id"] == 77
    assert row["submitted_by_name"] == "submitter@x.ae"


def test_sent_scope_pending_row_has_null_verdict_and_decided_at(api_db: Session):
    submitter = _user(api_db, "submitter@x.ae", "operator")
    approver = _user(api_db, "approver@x.ae", "manager")
    _submitted_book(api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=approver)

    row = (
        _client(api_db, submitter)
        .get("/api/v1/books/approval-log", params={"scope": "sent"})
        .json()["items"][0]
    )

    assert row["status"] == "pending"
    assert row["verdict"] is None
    assert row["decided_at"] is None
    assert row["submitted_at"] is not None
    assert row["approver_name"] == "approver@x.ae"


def test_sent_scope_rejected_verdict(api_db: Session):
    submitter = _user(api_db, "submitter@x.ae", "operator")
    approver = _user(api_db, "approver@x.ae", "manager")
    _submitted_book(
        api_db,
        book_id=1,
        ref="HR-0001",
        submitter=submitter,
        approver=approver,
        state="rejected",
        approver_state="rejected",
        decided_at=_days_ago(2),
    )

    row = (
        _client(api_db, submitter)
        .get("/api/v1/books/approval-log", params={"scope": "sent"})
        .json()["items"][0]
    )
    assert row["verdict"] == "rejected"
    assert row["decided_at"] is not None


def test_sent_scope_any_authenticated_user(api_db: Session):
    """No books.approve required to read your own outbox."""
    plain = _user(api_db, "plain@x.ae", "operator")
    response = _client(api_db, plain).get("/api/v1/books/approval-log", params={"scope": "sent"})
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "limit": 100, "offset": 0}


# ── received scope ────────────────────────────────────────────────────────────


def test_received_scope_lists_my_pending_step(api_db: Session):
    me = _user(api_db, "me@x.ae", "manager")
    submitter = _user(api_db, "submitter@x.ae", "operator")
    _submitted_book(api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=me)

    body = _client(api_db, me).get("/api/v1/books/approval-log").json()

    assert body["total"] == 1
    row = body["items"][0]
    assert row["book_id"] == 1
    assert row["your_step_kind"] == "approver"
    assert row["your_step_state"] == "pending"
    assert row["your_step_decided_at"] is None


def test_received_scope_excludes_other_assignees_steps(api_db: Session):
    me = _user(api_db, "me@x.ae", "manager")
    colleague = _user(api_db, "colleague@x.ae", "manager")
    submitter = _user(api_db, "submitter@x.ae", "operator")
    _submitted_book(api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=colleague)

    body = _client(api_db, me).get("/api/v1/books/approval-log").json()
    assert body["total"] == 0
    assert body["items"] == []


def test_received_scope_includes_recent_decision_within_30_days(api_db: Session):
    me = _user(api_db, "me@x.ae", "manager")
    submitter = _user(api_db, "submitter@x.ae", "operator")
    _submitted_book(
        api_db,
        book_id=1,
        ref="HR-0001",
        submitter=submitter,
        approver=me,
        state="rejected",
        approver_state="rejected",
        decided_at=_days_ago(5),
    )

    row = _client(api_db, me).get("/api/v1/books/approval-log").json()["items"][0]
    assert row["book_id"] == 1
    assert row["your_step_state"] == "rejected"
    assert row["your_step_kind"] == "approver"
    assert row["your_step_decided_at"] is not None
    assert row["verdict"] == "rejected"


def test_received_scope_30_day_boundary_is_inclusive(api_db: Session):
    """The window is ``decided_at >= now - 30 days``: a step decided just inside
    30 days still shows; one decided just past it drops off. The ±1h margins
    keep the assertion deterministic against clock jitter between seeding and
    the request."""
    me = _user(api_db, "me@x.ae", "manager")
    submitter = _user(api_db, "submitter@x.ae", "operator")

    def _stamp(**delta: int) -> datetime:
        return datetime.now(UTC).replace(tzinfo=None) - timedelta(**delta)

    _submitted_book(
        api_db,
        book_id=1,
        ref="HR-0001",
        submitter=submitter,
        approver=me,
        state="returned",
        approver_state="returned",
        decided_at=_stamp(days=29, hours=23),
    )
    _submitted_book(
        api_db,
        book_id=2,
        ref="HR-0002",
        submitter=submitter,
        approver=me,
        state="rejected",
        approver_state="rejected",
        decided_at=_stamp(days=30, hours=1),
    )

    body = _client(api_db, me).get("/api/v1/books/approval-log").json()
    ids = [row["book_id"] for row in body["items"]]
    assert ids == [1]


def test_received_scope_reviewer_pending_step_counts(api_db: Session):
    """Advisory reviewer steps are a queue too — same semantics as /awaiting."""
    me = _user(api_db, "me@x.ae", "manager")
    approver = _user(api_db, "approver@x.ae", "manager")
    submitter = _user(api_db, "submitter@x.ae", "operator")
    book = _submitted_book(api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=approver)
    book.versions[0].approval_steps.append(
        BookApprovalStep(
            book_id=1,
            step_order=1,
            stage_label="Review",
            assignee_user_id=me.id,
            kind="reviewer",
            state="pending",
        )
    )
    api_db.commit()

    row = _client(api_db, me).get("/api/v1/books/approval-log").json()["items"][0]
    assert row["book_id"] == 1
    assert row["your_step_kind"] == "reviewer"
    assert row["reviewer_names"] == ["me@x.ae"]
    assert row["approver_name"] == "approver@x.ae"


def test_received_scope_requires_books_approve(api_db: Session):
    """scope=received mirrors /books/awaiting's gate; scope=sent stays open."""
    plain = _user(api_db, "plain@x.ae", "operator")
    client = _client(api_db, plain)
    denied = client.get("/api/v1/books/approval-log", params={"scope": "received"})
    assert denied.status_code == 403
    allowed = client.get("/api/v1/books/approval-log", params={"scope": "sent"})
    assert allowed.status_code == 200


# ── pagination ────────────────────────────────────────────────────────────────


def test_sent_scope_pagination(api_db: Session):
    submitter = _user(api_db, "submitter@x.ae", "operator")
    approver = _user(api_db, "approver@x.ae", "manager")
    for i in range(1, 4):
        _submitted_book(
            api_db, book_id=i, ref=f"HR-{i:04d}", submitter=submitter, approver=approver
        )

    client = _client(api_db, submitter)
    page1 = client.get(
        "/api/v1/books/approval-log", params={"scope": "sent", "limit": 2, "offset": 0}
    ).json()
    assert page1["total"] == 3
    assert len(page1["items"]) == 2
    assert page1["limit"] == 2
    assert page1["offset"] == 0
    page2 = client.get(
        "/api/v1/books/approval-log", params={"scope": "sent", "limit": 2, "offset": 2}
    ).json()
    assert page2["total"] == 3
    assert len(page2["items"]) == 1
    all_refs = {r["ref_number"] for r in page1["items"]} | {page2["items"][0]["ref_number"]}
    assert all_refs == {"HR-0001", "HR-0002", "HR-0003"}


def test_received_scope_pagination_covers_total_not_page(api_db: Session):
    me = _user(api_db, "me@x.ae", "manager")
    submitter = _user(api_db, "submitter@x.ae", "operator")
    for i in range(1, 4):
        _submitted_book(
            api_db,
            book_id=i,
            ref=f"HR-{i:04d}",
            submitter=submitter,
            approver=me,
            state="approved",
            approver_state="approved",
            decided_at=_days_ago(i),  # distinct activity stamps so ordering is stable
        )

    body = (
        _client(api_db, me)
        .get("/api/v1/books/approval-log", params={"limit": 2, "offset": 0})
        .json()
    )
    assert body["total"] == 3
    assert len(body["items"]) == 2


# ── routing ───────────────────────────────────────────────────────────────────


def test_literal_route_beats_book_id_path_param(api_db: Session):
    """/approval-log must never be swallowed by GET /books/{book_id} — that
    collision reads as a 422 ('approval-log' is not an int), not a 404/403."""
    manager = _user(api_db, "manager@x.ae", "manager")
    response = _client(api_db, manager).get("/api/v1/books/approval-log")
    assert response.status_code == 200, response.text
