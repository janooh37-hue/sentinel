"""Submitters receive only unseen current signing-manager outcomes."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.db.models import BookCategory, BookVersion, UserPermission
from app.services import book_service, notification_service
from tests.test_books_approval_log import _client, _submitted_book, _user
from tests.test_books_approval_log import api_db as api_db


@pytest.mark.parametrize("verdict", ["approved", "returned", "rejected"])
def test_manager_decision_notifies_submitter_and_opening_clears_it(api_db: Session, verdict: str):
    submitter = _user(api_db, "submitter@x.ae", "manager")
    decider = _user(api_db, "decider@x.ae", "manager")
    book = _submitted_book(api_db, book_id=1, ref="HR-1", submitter=submitter, approver=decider)
    version = book.versions[0]
    if verdict == "approved":
        api_db.add(BookCategory(id="GS", name_en="General", prefix="GS"))
        book.category_id = "GS"
        book.ref_number = "REPORT-1"
        version.template_id = "Report"
        api_db.commit()
        book_service.sign_book(api_db, book.id, user_id=decider.id, version_id=version.id)
    else:
        book_service.decide_step(
            api_db,
            book.id,
            user_id=decider.id,
            version_id=version.id,
            decision=verdict,
            note="Please amend the dates",
        )
    client = _client(api_db, submitter)
    response = client.get("/api/v1/notifications/decisions")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["items"] == [
        {
            "book_id": book.id,
            "version_id": version.id,
            "ref_number": book.ref_number,
            "subject": None,
            "verdict": verdict,
            "is_report": verdict == "approved",
            "decided_at": body["items"][0]["decided_at"],
            "decider_name": "decider@x.ae",
            "decider_name_ar": None,
            "note": None if verdict == "approved" else "Please amend the dates",
        }
    ]
    assert datetime.fromisoformat(
        body["items"][0]["decided_at"].replace("Z", "+00:00")
    ).utcoffset() == timedelta(0)
    assert notification_service.relevant_counts(api_db, submitter).decisions == 1
    assert notification_service.relevant_counts(api_db, decider).decisions == 0
    sent, _ = book_service.approval_log_sent(api_db, user=submitter, limit=10, offset=0)
    assert sent[0].outcome_unseen
    received, _ = book_service.approval_log_received(
        api_db,
        user=decider,
        kind="reviewer" if verdict == "approved" else "approver",
        status="all",
        limit=10,
        offset=0,
    )
    assert not received[0].outcome_unseen
    # Reading as the decider retains the submitter's separate unread state.
    assert book_service.mark_seen(api_db, book.id, user_id=decider.id)
    assert notification_service.relevant_counts(api_db, submitter).decisions == 1
    assert client.post(f"/api/v1/books/{book.id}/seen").status_code == 204
    assert client.get("/api/v1/notifications/decisions").json() == {"items": [], "total": 0}
    assert not book_service.mark_seen(api_db, book.id, user_id=submitter.id)
    sent, _ = book_service.approval_log_sent(api_db, user=submitter, limit=10, offset=0)
    assert not sent[0].outcome_unseen


def test_reopened_step_notifies_again_after_new_decision(api_db: Session):
    submitter = _user(api_db, "submitter@x.ae", "manager")
    decider = _user(api_db, "decider@x.ae", "manager")
    admin = _user(api_db, "admin@x.ae", "admin")
    book = _submitted_book(api_db, book_id=1, ref="HR-1", submitter=submitter, approver=decider)
    version = book.versions[0]
    book_service.decide_step(
        api_db, book.id, user_id=decider.id, version_id=version.id, decision="rejected", note="No"
    )
    assert book_service.mark_seen(api_db, book.id, user_id=submitter.id)
    assert notification_service.relevant_counts(api_db, submitter).decisions == 0
    book_service.override_state(
        api_db, book.id, target_state="pending", actor=admin, reason="Reopen"
    )
    book_service.decide_step(
        api_db, book.id, user_id=decider.id, version_id=version.id, decision="returned", note="Fix"
    )
    assert notification_service.relevant_counts(api_db, submitter).decisions == 1


def test_decision_list_is_newest_five_and_mark_all_is_user_scoped(api_db: Session):
    submitter = _user(api_db, "submitter@x.ae", "manager")
    other = _user(api_db, "other@x.ae", "manager")
    decider = _user(api_db, "decider@x.ae", "manager")
    for n in range(1, 8):
        book = _submitted_book(
            api_db,
            book_id=n,
            ref=f"HR-{n}",
            submitter=submitter if n < 7 else other,
            approver=decider,
            state="returned",
            approver_state="returned",
            decided_at=datetime(2026, 10, n),
        )
        book.versions[0].approval_steps[0].note = "Fix dates"
    api_db.commit()
    client = _client(api_db, submitter)
    body = client.get("/api/v1/notifications/decisions").json()
    assert body["total"] == 6
    assert [row["book_id"] for row in body["items"]] == [6, 5, 4, 3, 2]
    cleared = client.post("/api/v1/notifications/decisions/seen")
    assert cleared.status_code == 204 and cleared.content == b""
    assert notification_service.relevant_counts(api_db, submitter).decisions == 0
    assert notification_service.relevant_counts(api_db, other).decisions == 1
    assert client.post("/api/v1/notifications/decisions/seen").status_code == 204


@pytest.mark.parametrize(
    "excluded",
    [
        "self",
        "reviewer",
        "override",
        "deleted",
        "voided",
        "superseded",
        "hidden",
        "category",
        "service",
    ],
)
def test_decision_exclusions(api_db: Session, excluded: str):
    submitter = _user(api_db, "submitter@x.ae", "operator")
    decider = _user(api_db, "decider@x.ae", "manager")
    book = _submitted_book(
        api_db,
        book_id=1,
        ref="HR-1",
        submitter=submitter,
        approver=submitter if excluded == "self" else decider,
        state="returned",
        approver_state="returned",
        decided_at=datetime(2026, 10, 1),
    )
    step = book.versions[0].approval_steps[0]
    if excluded == "reviewer":
        step.kind = "reviewer"
    elif excluded == "override":
        step.decided_at = None
    elif excluded == "deleted":
        book.deleted_at = datetime(2026, 10, 2)
    elif excluded == "voided":
        book.voided_at = datetime(2026, 10, 2)
    elif excluded == "superseded":
        book.versions.append(BookVersion(version_no=2, status="pending"))
    elif excluded == "hidden":
        book.confidentiality = "personal"
        book.created_by_user_id = decider.id
    elif excluded == "category":
        api_db.add(
            UserPermission(user_id=submitter.id, capability="books.category.HR", effect="deny")
        )
    elif excluded == "service":
        book.versions[0].template_id = "Report"
        api_db.add(
            UserPermission(
                user_id=submitter.id, capability="books.servicerecords.Report", effect="deny"
            )
        )
    api_db.commit()
    assert notification_service.relevant_counts(api_db, submitter).decisions == 0
    assert _client(api_db, submitter).get("/api/v1/notifications/decisions").json() == {
        "items": [],
        "total": 0,
    }
    assert not any(
        i.kind == "decision" for i in notification_service.actionable_items(api_db, submitter)
    )
    # Mark-all cannot acknowledge an outcome outside the caller's visible set.
    if excluded == "hidden":
        book_service.mark_decisions_seen(api_db, submitter)
        book.confidentiality = "general"
        api_db.commit()
        assert notification_service.relevant_counts(api_db, submitter).decisions == 1


def test_resubmission_supersedes_unread_return(api_db: Session):
    submitter = _user(api_db, "submitter@x.ae", "manager")
    decider = _user(api_db, "decider@x.ae", "manager")
    book = _submitted_book(
        api_db,
        book_id=1,
        ref="HR-1",
        submitter=submitter,
        approver=decider,
        state="returned",
        approver_state="returned",
        decided_at=datetime(2026, 10, 1),
    )
    assert notification_service.relevant_counts(api_db, submitter).decisions == 1
    book_service.submit_for_approval(
        api_db,
        book.id,
        priority="Normal",
        approver_user_id=decider.id,
        reviewer_user_ids=[],
        submitted_by_user_id=submitter.id,
    )
    assert notification_service.relevant_counts(api_db, submitter).decisions == 0


@pytest.mark.parametrize("level", ["general", "personal", "secret", "directed"])
def test_decision_push_items_redact_only_subject(api_db: Session, level: str):
    submitter = _user(api_db, "submitter@x.ae", "admin")
    decider = _user(api_db, "decider@x.ae", "manager")
    book = _submitted_book(
        api_db,
        book_id=1,
        ref="HR-1",
        submitter=submitter,
        approver=decider,
        state="approved",
        approver_state="approved",
        subject="Private dates",
        decided_at=datetime(2026, 10, 1),
    )
    book.confidentiality = level
    api_db.commit()
    items = [
        i for i in notification_service.actionable_items(api_db, submitter) if i.kind == "decision"
    ]
    assert len(items) == 1
    item = items[0]
    assert (item.ref, item.url, item.label, item.verdict, item.is_report) == (
        f"decision:{book.versions[0].approval_steps[0].id}",
        "/books/1",
        "HR-1",
        "approved",
        False,
    )
    assert item.subject == ("Private dates" if level == "general" else None)
    assert item.requester == "decider@x.ae"
    body = _client(api_db, submitter).get("/api/v1/notifications/decisions").json()
    assert body["items"][0]["subject"] == item.subject
