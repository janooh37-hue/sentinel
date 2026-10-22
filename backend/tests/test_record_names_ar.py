"""Record names use linked employees' Arabic names without inventing a fallback."""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import (
    Book,
    BookAnnotation,
    BookApprovalStep,
    BookCategory,
    BookRevisionAccess,
    BookVersion,
    Employee,
    Manager,
)
from app.db.session import get_db
from app.main import create_app
from app.services import book_service, notification_service, push_service, scheduler_service
from tests.conftest import make_user


@pytest.mark.parametrize("linked", [True, False])
def test_arabic_names_on_record_list_recipients_and_inbox(api_db: Session, monkeypatch, linked):
    sender = make_user(api_db, role="admin", email="sender@names.ae")
    recipient = make_user(api_db, role="admin", email="recipient@names.ae")
    if linked:
        api_db.add_all(
            [
                Employee(id="G-names-s", name_en="Sender", name_ar="المرسل"),
                Employee(id="G-names-r", name_en="Recipient", name_ar="المستلم"),
            ]
        )
        sender.employee_id = "G-names-s"
        recipient.employee_id = "G-names-r"
    api_db.add(BookCategory(id="HR", prefix="HR"))
    manager = Manager(user_id=recipient.id, name_en="Recipient")
    api_db.add(manager)
    api_db.flush()
    record = Book(
        category_id="HR",
        ref_number="HR-names",
        created_by_user_id=sender.id,
        submitted_by_user_id=sender.id,
        doc_manager_id=manager.id,
        approval_state="pending",
    )
    api_db.add(record)
    api_db.flush()
    version = BookVersion(
        book_id=record.id,
        version_no=1,
        created_by_user_id=sender.id,
        status="pending",
        fields={},
        # Legacy snapshots without Arabic fields use the linked employee.
        approval_context={
            "submitted_by_user_id": sender.id,
            "submitted_by_name": "Sender",
            "doc_manager_user_id": recipient.id,
            "doc_manager_name": "Recipient",
        },
    )
    api_db.add(version)
    api_db.flush()
    api_db.add_all(
        [
            BookApprovalStep(
                book_id=record.id,
                version_id=version.id,
                step_order=0,
                stage_label="Approve",
                assignee_user_id=recipient.id,
            ),
            BookRevisionAccess(
                version_id=version.id,
                user_id=sender.id,
                kind="reviewer",
                state="reviewed",
                decided_at=datetime(2026, 10, 1),
            ),
            BookAnnotation(
                version_id=version.id,
                page=1,
                kind="pin",
                geometry={"x": 0.2, "y": 0.3},
                author_user_id=sender.id,
            ),
        ]
    )
    api_db.commit()
    monkeypatch.setattr(push_service, "send_to_user", lambda *args: None)
    monkeypatch.setattr(push_service, "mark_sent", lambda *args: None)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: sender
    with TestClient(app) as client:
        detail = client.get(f"/api/v1/books/{record.id}")
        assert detail.status_code == 200, detail.text
        expected = "المرسل" if linked else None
        assert detail.json()["created_by_name_ar"] == expected
        recipient_ar = "المستلم" if linked else None
        assert detail.json()["submitted_by_name_ar"] == expected
        assert detail.json()["doc_manager_name_ar"] == recipient_ar
        history = detail.json()["versions"][0]
        assert history["created_by_name_ar"] == expected
        assert history["approval_steps"][0]["assignee_name_ar"] == recipient_ar
        assert history["retained_decisions"][0]["assignee_name_ar"] == expected
        annotations = client.get(f"/api/v1/books/{record.id}/versions/{version.id}/annotations")
        assert annotations.status_code == 200, annotations.text
        assert annotations.json()[0]["author_name_ar"] == expected
        revision_access = client.get(f"/api/v1/books/{record.id}/revision-access")
        assert revision_access.status_code == 200, revision_access.text
        assert revision_access.json()[0]["user_name_ar"] == expected
        revoked = client.post(
            f"/api/v1/books/{record.id}/revision-access/{revision_access.json()[0]['id']}/revoke",
            json={"reason": "Access no longer required"},
        )
        assert revoked.status_code == 200, revoked.text
        assert revoked.json()[0]["user_name_ar"] == expected
        reviewers = client.get("/api/v1/books/reviewer-candidates")
        assert reviewers.status_code == 200, reviewers.text
        assert (
            next(row for row in reviewers.json() if row["id"] == recipient.id)["name_ar"]
            == recipient_ar
        )
        approvals = client.get("/api/v1/books/approval-log?scope=sent&status=all")
        assert approvals.status_code == 200, approvals.text
        assert approvals.json()["items"][0]["submitted_by_name_ar"] == expected
        assert approvals.json()["items"][0]["doc_manager_name_ar"] == recipient_ar
        assert approvals.json()["items"][0]["approver_name_ar"] == recipient_ar
        listing = client.get("/api/v1/books")
        assert listing.status_code == 200, listing.text
        assert listing.json()["items"][0]["created_by_name_ar"] == expected
        sent = client.post(
            f"/api/v1/books/{record.id}/send",
            json={"user_ids": [recipient.id], "purpose": "info"},
        )
        assert sent.status_code == 200, sent.text
        row = sent.json()["sent"][0]
        assert row["user_name_ar"] == ("المستلم" if linked else None)
        assert row["sent_by_name_ar"] == expected
        recipients = client.get(f"/api/v1/books/{record.id}/recipients")
        assert recipients.status_code == 200, recipients.text
        assert recipients.json()[0]["user_name_ar"] == row["user_name_ar"]
        assert recipients.json()[0]["sent_by_name_ar"] == expected
        app.dependency_overrides[get_current_user] = lambda: recipient
        items = notification_service.actionable_items(api_db, recipient)
        inbox_item = next(item for item in items if item.kind == "inbox")
        assert inbox_item.requester_ar == expected
        messages, _ = scheduler_service._build_push("inbox", [inbox_item], "/books")
        assert f"من {expected or inbox_item.requester}" in messages["ar"][1]
        inbox = client.get(f"/api/v1/books/{record.id}")
        assert inbox.status_code == 200, inbox.text
        assert inbox.json()["my_inbox"]["sent_by_name_ar"] == expected
        api_db.add(BookVersion(book_id=record.id, version_no=2, fields={}, status="none"))
        api_db.commit()
        historical = client.get(f"/api/v1/books/{record.id}?version_id={version.id}")
        assert historical.status_code == 200, historical.text
        assert historical.json()["submitted_by_name_ar"] == expected
        assert historical.json()["doc_manager_name_ar"] == recipient_ar
        assert historical.json()["approval_steps"][0]["assignee_name_ar"] == recipient_ar


def test_arabic_name_resolution_is_batched(db_session: Session, count_queries):
    users = [make_user(db_session, email=f"batch-{i}@names.ae") for i in range(5)]
    db_session.add(Employee(id="G-names", name_en="Employee", name_ar="موظف"))
    for user in users:
        user.employee_id = "G-names"
    db_session.flush()
    ids = {user.id for user in users}
    with count_queries() as queries:
        names = book_service.resolve_names_ar_by_ids(db_session, ids)
    assert list(names.values()) == ["موظف"] * 5
    assert queries.count == 1
    with count_queries() as queries:
        assert book_service.resolve_names_ar_by_ids(db_session, set()) == {}
    assert queries.count == 0
