"""GET /api/v1/books/approval-log — the approvals log (#31).

Covers the contract of the two scopes:

- ``sent``: records the caller submitted (and only those), requiring
  ``books.view``, flattened to ApprovalLogItem rows carrying ref / subject /
  category / state / verdict / chain names / thumbnail document id;
- ``received``: pending assigned steps requiring ``books.approve``; callers who
  also hold ``books.view`` additionally see their decided steps from the last
  30 days, with the window boundary inclusive;
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
        eng.dispose()


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
    assert row["access_scope"] == "full"


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


def test_sent_scope_status_filter_narrows_to_one_state(api_db: Session):
    submitter = _user(api_db, "submitter@x.ae", "operator")
    approver = _user(api_db, "approver@x.ae", "manager")
    _submitted_book(api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=approver)
    _submitted_book(
        api_db, book_id=2, ref="HR-0002", submitter=submitter, approver=approver,
        state="returned", approver_state="returned", decided_at=_days_ago(1),
    )

    client = _client(api_db, submitter)
    pending = client.get(
        "/api/v1/books/approval-log", params={"scope": "sent", "status": "pending"}
    ).json()
    assert [row["book_id"] for row in pending["items"]] == [1]

    returned = client.get(
        "/api/v1/books/approval-log", params={"scope": "sent", "status": "returned"}
    ).json()
    assert [row["book_id"] for row in returned["items"]] == [2]


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


def test_sent_scope_allows_caller_with_books_view(api_db: Session):
    """No books.approve is needed when the caller holds books.view."""
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
    assert row["status"] == "pending"
    assert row["access_scope"] == "full"
    assert row["assigned_signer_user_id"] == me.id


def test_received_scope_excludes_other_assignees_steps(api_db: Session):
    me = _user(api_db, "me@x.ae", "manager")
    colleague = _user(api_db, "colleague@x.ae", "manager")
    submitter = _user(api_db, "submitter@x.ae", "operator")
    _submitted_book(api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=colleague)

    body = _client(api_db, me).get("/api/v1/books/approval-log").json()
    assert body["total"] == 0
    assert body["items"] == []


def test_received_scope_decided_history_requires_all_status(api_db: Session):
    """A decided step is history, not the default ``pending`` filter — it needs
    an explicit status (or ``all``) to surface, and carries no cutoff."""
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

    client = _client(api_db, me)
    default_page = client.get("/api/v1/books/approval-log").json()
    assert default_page["total"] == 0

    row = client.get(
        "/api/v1/books/approval-log", params={"status": "all"}
    ).json()["items"][0]
    assert row["book_id"] == 1
    assert row["status"] == "rejected"
    assert row["verdict"] == "rejected"
    assert row["decided_at"] is not None


def test_received_scope_history_has_no_30_day_cutoff(api_db: Session):
    """The old rolling window is gone: a decision from well over 30 days ago
    still surfaces under status=all."""
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
        decided_at=_days_ago(400),
    )

    body = _client(api_db, me).get(
        "/api/v1/books/approval-log", params={"status": "all"}
    ).json()
    assert [row["book_id"] for row in body["items"]] == [1]


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

    row = _client(api_db, me).get(
        "/api/v1/books/approval-log", params={"kind": "reviewer"}
    ).json()["items"][0]
    assert row["book_id"] == 1
    assert row["status"] == "pending"
    assert row["reviewer_names"] == ["me@x.ae"]
    assert row["approver_name"] == "approver@x.ae"


def test_received_scope_late_review_stays_actionable_after_signer_decision(api_db: Session):
    """A reviewer's pending step outlives the signer's decision — late advisory
    feedback never blocks or reflects the signing verdict."""
    reviewer = _user(api_db, "late-reviewer@x.ae", "operator")
    approver = _user(api_db, "approver@x.ae", "manager")
    submitter = _user(api_db, "submitter@x.ae", "operator")
    book = _submitted_book(
        api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=approver,
        state="approved", approver_state="approved", decided_at=_days_ago(1),
    )
    book.versions[0].approval_steps.append(
        BookApprovalStep(
            book_id=1, step_order=1, stage_label="Review",
            assignee_user_id=reviewer.id, kind="reviewer", state="pending",
        )
    )
    api_db.commit()

    row = _client(api_db, reviewer).get(
        "/api/v1/books/approval-log", params={"kind": "reviewer"}
    ).json()["items"][0]
    assert row["book_id"] == 1
    assert row["status"] == "pending"
    # The review itself is still actionable ("pending"), but record_status
    # carries the signer's real outcome — this is what lets the UI label the
    # row "late advisory feedback" instead of a plain pending review.
    assert row["record_status"] == "approved"


def test_received_scope_requires_no_capability_only_assignment(api_db: Session):
    """A caller with neither ``books.view`` nor ``books.approve`` can still
    open the authenticated received queue; an unassigned caller sees an empty,
    not forbidden, page."""
    from app.db.models import UserPermission

    plain = _user(api_db, "plain@x.ae", "operator")
    api_db.add(UserPermission(user_id=plain.id, capability="books.view", effect="deny"))
    api_db.add(UserPermission(user_id=plain.id, capability="books.approve", effect="deny"))
    api_db.commit()
    response = _client(api_db, plain).get(
        "/api/v1/books/approval-log", params={"scope": "received"}
    )
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_received_scope_reviewer_status_rejects_non_pending_all(api_db: Session):
    me = _user(api_db, "me@x.ae", "manager")
    response = _client(api_db, me).get(
        "/api/v1/books/approval-log",
        params={"kind": "reviewer", "status": "approved"},
    )
    assert response.status_code == 422


def test_received_scope_sent_kind_is_rejected(api_db: Session):
    me = _user(api_db, "me@x.ae", "manager")
    response = _client(api_db, me).get(
        "/api/v1/books/approval-log", params={"scope": "sent", "kind": "approver"},
    )
    assert response.status_code == 422


def test_approval_summary_reports_actionable_counts(api_db: Session):
    me = _user(api_db, "summary-signer@x.ae", "manager")
    submitter = _user(api_db, "submitter@x.ae", "operator")
    _submitted_book(api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=me)

    summary = _client(api_db, me).get("/api/v1/books/approval-summary").json()
    assert summary["signature"]["count"] == 1
    assert summary["signature"]["oldest"]["book_id"] == 1
    assert summary["actionable_count"] == 1
    assert "approver" in summary["available_received_kinds"]


def test_approval_summary_empty_for_uninvolved_user(api_db: Session):
    bystander = _user(api_db, "bystander@x.ae", "operator")
    summary = _client(api_db, bystander).get("/api/v1/books/approval-summary").json()
    assert summary["signature"]["count"] == 0
    assert summary["review"]["count"] == 0
    assert summary["actionable_count"] == 0


def test_approval_summary_returned_count_is_signer_returned_submissions_only(api_db: Session):
    """`returned_count` counts the CALLER's own SENT submissions a signer
    returned — never the caller's received-approver history. A signer who
    happens to have returned OTHER people's records must not see that
    reflected in their own "needs your changes" count, and an advisory
    reviewer's changes-requested note must not increment it either."""
    submitter = _user(api_db, "returned-submitter@x.ae", "operator")
    signer = _user(api_db, "returned-signer@x.ae", "manager")
    reviewer = _user(api_db, "returned-reviewer@x.ae", "operator")
    # The submitter's own record, returned by the signer.
    _submitted_book(
        api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=signer,
        state="returned", approver_state="returned", decided_at=_days_ago(1),
    )
    # A record the SIGNER themself returned as approver — must not count
    # toward the signer's own returned_count (they didn't submit it).
    _submitted_book(
        api_db, book_id=2, ref="HR-0002", submitter=reviewer, approver=signer,
        state="returned", approver_state="returned", decided_at=_days_ago(1),
    )

    submitter_summary = _client(api_db, submitter).get("/api/v1/books/approval-summary").json()
    assert submitter_summary["returned_count"] == 1

    signer_summary = _client(api_db, signer).get("/api/v1/books/approval-summary").json()
    assert signer_summary["returned_count"] == 0


def test_approval_log_neighbors_reports_position_and_adjacent_rows(api_db: Session):
    me = _user(api_db, "neighbors@x.ae", "manager")
    submitter = _user(api_db, "submitter@x.ae", "operator")
    for i in range(1, 4):
        _submitted_book(
            api_db, book_id=i, ref=f"HR-{i:04d}", submitter=submitter, approver=me,
        )

    client = _client(api_db, me)
    middle = client.get(
        "/api/v1/books/approval-log/2/neighbors", params={"sort": "oldest"}
    ).json()
    assert middle["position"] == 2
    assert middle["total"] == 3
    assert middle["previous"]["book_id"] == 1
    assert middle["next"]["book_id"] == 3

    missing = client.get(
        "/api/v1/books/approval-log/999/neighbors", params={"sort": "oldest"}
    ).json()
    assert missing["position"] is None
    assert missing["previous"] is None
    assert missing["next"] is None


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
        .get(
            "/api/v1/books/approval-log",
            params={"limit": 2, "offset": 0, "status": "all"},
        )
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


def test_completed_review_survives_resubmission_without_reviving_revocation(api_db: Session):
    from sqlalchemy import select

    from app.db.models import BookRevisionAccess
    from app.services import book_service

    submitter = _user(api_db, "owner@x.ae", "operator")
    signer = _user(api_db, "signer@x.ae", "manager")
    reviewer = _user(api_db, "reviewer@x.ae", "operator")
    book = _submitted_book(
        api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=signer,
    )
    book_service.add_reviewers(api_db, book.id, user_ids=[reviewer.id])
    book_service.record_review(
        api_db, book.id, user_id=reviewer.id, decision="reviewed", note="Original feedback",
        version_id=book.versions[0].id,
    )
    grant = api_db.scalar(select(BookRevisionAccess).where(
        BookRevisionAccess.user_id == reviewer.id,
    ))
    assert grant is not None
    revoked_at = _days_ago(0)
    grant.revoked_at = revoked_at
    grant.revoked_by_user_id = submitter.id
    grant.revocation_reason = "Synthetic administrator reason"
    api_db.commit()
    book_service.submit_for_approval(
        api_db, book.id, priority="Normal", approver_user_id=signer.id,
        reviewer_user_ids=[reviewer.id], submitted_by_user_id=submitter.id,
    )
    assert grant.note == "Original feedback"
    assert grant.revoked_at == revoked_at
    book_service.record_review(
        api_db, book.id, user_id=reviewer.id, decision="changes_requested", note="Later feedback",
        version_id=book.versions[0].id,
    )
    assert grant.note == "Later feedback"
    assert grant.revoked_at == revoked_at
    assert grant.revocation_reason == "Synthetic administrator reason"
    assert book.approval_state == "pending"


def test_state_override_does_not_manufacture_completed_assignment(api_db: Session):
    from sqlalchemy import select

    from app.db.models import BookRevisionAccess
    from app.services import book_service

    administrator = _user(api_db, "administrator@x.ae", "admin")
    signer = _user(api_db, "signer@x.ae", "manager")
    book = _submitted_book(
        api_db, book_id=1, ref="HR-0001", submitter=administrator, approver=signer,
    )
    book_service.override_state(
        api_db, book.id, target_state="rejected", actor=administrator, reason="Administrative change",
    )
    book_service.override_state(
        api_db, book.id, target_state="none", actor=administrator, reason="Draft reset",
    )
    assert list(api_db.scalars(select(BookRevisionAccess))) == []


def test_revision_changed_during_signing_does_not_publish_decision(api_db, monkeypatch, tmp_path):
    from sqlalchemy import select

    from app.api.errors import AppError
    from app.db.models import BookRevisionAccess
    from app.services import book_service, document_service

    signer = _user(api_db, "racing-signer@x.ae", "manager")
    book = _submitted_book(
        api_db, book_id=1, ref="HR-0001", submitter=signer, approver=signer,
    )
    first = book.versions[0]
    signature = tmp_path / "signature.png"
    signature.write_bytes(b"synthetic signature locator")
    monkeypatch.setattr(book_service, "_resolve_signer_signature", lambda *_: signature)

    def render_while_revision_changes(*_args, **_kwargs):
        book.versions.append(BookVersion(book_id=book.id, version_no=2, status="none"))
        book.approval_state = "none"
        api_db.commit()
        return str(tmp_path / "not-published.pdf")

    monkeypatch.setattr(document_service, "render_signed_pdf", render_while_revision_changes)
    with pytest.raises(AppError) as caught:
        book_service.sign_book(api_db, book.id, user_id=signer.id, version_id=first.id)
    assert caught.value.code == "REVISION_CHANGED"
    assert first.status == "pending"
    assert first.approval_steps[0].state == "pending"
    assert first.signed_pdf_path is None
    assert book.versions[-1].status == "none"
    assert list(api_db.scalars(select(BookRevisionAccess))) == []


def test_unfinished_superseded_reviewer_has_no_retained_read_access(api_db):
    from app.api.errors import AppError
    from app.db.models import UserPermission
    from app.services import book_service

    signer = _user(api_db, "signer@x.ae", "manager")
    reviewer = _user(api_db, "restricted@x.ae", "operator")
    api_db.add(UserPermission(user_id=reviewer.id, capability="books.view", effect="deny"))
    book = _submitted_book(
        api_db, book_id=1, ref="HR-0001", submitter=signer, approver=signer,
    )
    first = book.versions[0]
    book_service.add_reviewers(api_db, book.id, user_ids=[reviewer.id])
    assert book_service.resolve_book_read_access(api_db, reviewer, book).selected_version_id == first.id
    book.versions.append(BookVersion(book_id=book.id, version_no=2, status="none"))
    book.approval_state = "none"
    api_db.commit()
    with pytest.raises(AppError) as caught:
        book_service.resolve_book_read_access(api_db, reviewer, book, version_id=first.id)
    assert caught.value.code == "FORBIDDEN"
    assert first.approval_steps[-1].state == "pending"


def test_revoked_retained_access_is_skipped_not_a_500_across_the_callers_worklist(api_db: Session):
    """A revoked retained grant leaves historical assignment provenance
    (a completed step) behind, but that provenance is no longer visibility.
    `_approval_worklist` must silently omit that one book — not let
    `resolve_book_read_access`'s FORBIDDEN blow up the caller's entire
    worklist/summary, which would 403 every other unrelated row too."""
    from sqlalchemy import select

    from app.db.models import BookRevisionAccess, UserPermission
    from app.services import book_service

    submitter = _user(api_db, "revoke-submitter@x.ae", "operator")
    signer = _user(api_db, "revoke-signer@x.ae", "manager")
    reviewer = _user(api_db, "revoke-reviewer@x.ae", "operator")
    admin = _user(api_db, "revoke-admin@x.ae", "admin")
    api_db.add(UserPermission(user_id=reviewer.id, capability="books.view", effect="deny"))
    api_db.add(UserPermission(user_id=reviewer.id, capability="books.approve", effect="deny"))
    api_db.commit()

    # A second, unrelated record the reviewer can still see after the first
    # grant is revoked — proves the worklist keeps going instead of failing.
    other_book = _submitted_book(
        api_db, book_id=1, ref="HR-0001", submitter=submitter, approver=signer,
    )
    book_service.add_reviewers(api_db, other_book.id, user_ids=[reviewer.id])

    revoked_book = _submitted_book(
        api_db, book_id=2, ref="HR-0002", submitter=submitter, approver=signer,
    )
    book_service.add_reviewers(api_db, revoked_book.id, user_ids=[reviewer.id])
    book_service.record_review(
        api_db, revoked_book.id, user_id=reviewer.id, version_id=revoked_book.versions[0].id,
        decision="reviewed", note="Completed then revoked",
    )
    grant = api_db.scalar(
        select(BookRevisionAccess).where(BookRevisionAccess.user_id == reviewer.id)
    )
    assert grant is not None
    book_service.revoke_revision_access(
        api_db, book_id=revoked_book.id, access_id=grant.id, actor=admin,
        reason="Synthetic revocation regression test",
    )

    body = _client(api_db, reviewer).get(
        "/api/v1/books/approval-log", params={"kind": "reviewer", "status": "all"}
    ).json()
    assert body["total"] == 1
    assert [row["book_id"] for row in body["items"]] == [other_book.id]

    summary = _client(api_db, reviewer).get("/api/v1/books/approval-summary")
    assert summary.status_code == 200, summary.text
    assert summary.json()["review"]["count"] == 1


def test_restricted_worklist_row_never_leaks_the_live_current_submitter_name(api_db: Session):
    """`submitted_by_name` (unlike `submitted_by_user_id`) must never fall back
    to the Book's LIVE, current submitter for a restricted (assigned_revision)
    row — that submitter may belong to a later revision the caller has no
    authorization to read. It must come from the assigned revision's own
    frozen `approval_context` snapshot, exactly like `priority` and the
    doc-manager fields already do."""
    from app.db.models import UserPermission
    from app.services import book_service

    original_submitter = _user(api_db, "original-submitter@x.ae", "operator")
    signer = _user(api_db, "leak-signer@x.ae", "manager")
    secret_resubmitter = _user(api_db, "secret-resubmitter@x.ae", "operator")
    api_db.add(UserPermission(user_id=signer.id, capability="books.view", effect="deny"))
    book = _submitted_book(
        api_db, book_id=1, ref="HR-0001", submitter=original_submitter, approver=signer,
        state="returned", approver_state="returned", decided_at=_days_ago(1),
    )
    v1 = book.versions[0]
    book_service.capture_approval_context(
        api_db, book, v1, submitted_by_user_id=original_submitter.id,
        submitted_at=v1.approval_steps[0].created_at,
    )
    book_service.retain_revision_access(api_db, v1, v1.approval_steps[0])
    api_db.commit()

    # The book is later resubmitted by a DIFFERENT person — the live
    # Book.submitted_by_user_id now points at someone the restricted signer
    # (retained access to v1 only) is not authorized to see.
    book.submitted_by_user_id = secret_resubmitter.id
    api_db.commit()

    row = (
        _client(api_db, signer)
        .get("/api/v1/books/approval-log", params={"status": "all"})
        .json()["items"][0]
    )
    assert row["access_scope"] == "assigned_revision"
    assert row["submitted_by_user_id"] is None
    assert row["submitted_by_name"] != "secret-resubmitter@x.ae"
    assert row["submitted_by_name"] == "original-submitter@x.ae"
