"""Phase 1 acceptance: CONTRACT.md access rules and direct-send API."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import (
    AuditLog,
    Book,
    BookApprovalStep,
    BookCategory,
    BookRecipient,
    BookVersion,
    Document,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.services import document_service, perm_service, push_service
from tests.conftest import make_user

API = "/api/v1"
LEVELS = ("general", "creator_only", "secret", "named")
# A is deliberately uncleared: creating a Secret record does NOT grant access.
VISIBLE = {
    "A": {"general", "creator_only", "named"},
    "B": {"general"},
    "C": {"general"},
    "C2": {"general", "secret"},
    "M": {"general"},
    "D": set(LEVELS),
}


@dataclass
class ApiHarness:
    db: Session
    client: TestClient
    users: dict[str, User]
    records: dict[str, Book]
    documents: dict[str, Document]
    actor: User
    pushes: list[tuple[int, object, str]]

    def as_user(self, name: str) -> None:
        self.actor = self.users[name]


def _book(db: Session, creator: User, level: str, tmp_path: Path) -> tuple[Book, Document]:
    pdf = tmp_path / f"{level}.pdf"
    pdf.write_bytes(b"%PDF-grade-acceptance")
    record = Book(
        category_id="HR",
        ref_number=f"HR-{level}",
        subject=f"Acceptance {level}",
        direction="outgoing",
        grade="secret" if level == "secret" else "unclassified",
        distribution="named" if level in {"creator_only", "named"} else "organization",
        created_by_user_id=creator.id,
    )
    document = Document(
        template_id="General Book",
        ref_number=record.ref_number,
        pdf_path=str(pdf),
        # No DOCX: reopen exercises the real access gate, then stops before COM.
        docx_path=None,
        submission_id=f"grade-{level}",
    )
    db.add_all([record, document])
    db.flush()
    db.add(
        BookVersion(
            book_id=record.id,
            version_no=1,
            template_id="General Book",
            document_id=document.id,
            fields={},
            status="none",
            created_by_user_id=creator.id,
        )
    )
    db.commit()
    return record, document


@pytest.fixture()
def grade_api(
    api_db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Iterator[ApiHarness]:
    users = {
        name: make_user(api_db, role=role, email=f"grade-{name}@test.ae")
        for name, role in (
            ("A", "operator"),
            ("B", "operator"),
            ("C", "operator"),
            ("C2", "operator"),
            ("M", "manager"),
            ("D", "admin"),
        )
    }
    api_db.add(BookCategory(id="HR", prefix="HR", requires_approval=False))
    api_db.add(UserPermission(user_id=users["C2"].id, capability="books.secret", effect="grant"))
    # Operators normally lack books.edit. Grant only this unrelated prerequisite
    # so Word reopen tests distinguish record hiding from the capability gate.
    api_db.add_all(
        UserPermission(user_id=users[name].id, capability="books.edit", effect="grant")
        for name in ("A", "B", "C", "C2")
    )
    api_db.commit()
    records, documents = {}, {}
    for level in LEVELS:
        records[level], documents[level] = _book(api_db, users["A"], level, tmp_path)

    pushes = []

    def record_push(db: Session, user_id: int, messages: object, url: str) -> None:
        pushes.append((user_id, messages, url))

    monkeypatch.setattr(push_service, "send_to_user", record_push)
    monkeypatch.setattr(
        document_service, "get_settings", lambda: SimpleNamespace(data_dir=tmp_path)
    )
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    with TestClient(app, raise_server_exceptions=True) as client:
        harness = ApiHarness(api_db, client, users, records, documents, users["A"], pushes)
        app.dependency_overrides[get_current_user] = lambda: harness.actor
        yield harness


def _error(response, status: int, code: str) -> dict:
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert error["code"] == code, response.text
    return error


def _listing(api: ApiHarness, expected: set[str], inbox: str | None = None) -> None:
    params = {"inbox": inbox} if inbox else {}
    listing = api.client.get(f"{API}/books", params=params)
    facets = api.client.get(f"{API}/books/facets", params=params)
    assert listing.status_code == 200, listing.text
    assert facets.status_code == 200, facets.text
    body = listing.json()
    assert {item["id"] for item in body["items"]} == {api.records[level].id for level in expected}
    assert body["total"] == len(expected)
    assert facets.json()["total"] == body["total"]


def _send(api: ApiHarness, level: str, targets: list[str], **extra) -> dict:
    before = len(api.pushes)
    response = api.client.post(
        f"{API}/books/{api.records[level].id}/send",
        json={"user_ids": [api.users[name].id for name in targets], "purpose": "info", **extra},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(api.pushes) - before == len(body["sent"])
    assert [call[0] for call in api.pushes[before:]] == [row["user_id"] for row in body["sent"]]
    return body


def _audits(api: ApiHarness, level: str, action: str) -> list[dict]:
    rows = api.db.scalars(
        select(AuditLog).where(
            AuditLog.entity_type == "book",
            AuditLog.entity_id == str(api.records[level].id),
            AuditLog.action == action,
        )
    ).all()
    return [json.loads(row.payload) for row in rows]


@pytest.mark.parametrize("actor", VISIBLE)
def test_visibility_list_and_facets_matrix(grade_api: ApiHarness, actor: str) -> None:
    api = grade_api
    api.as_user(actor)
    _listing(api, VISIBLE[actor])
    _listing(api, set(), "received")
    _listing(api, set(), "sent")


@pytest.mark.parametrize("actor", VISIBLE)
@pytest.mark.parametrize("level", LEVELS)
def test_detail_and_document_visibility_matrix(
    grade_api: ApiHarness, actor: str, level: str
) -> None:
    api = grade_api
    api.as_user(actor)
    visible = level in VISIBLE[actor]
    for path in (
        f"/books/{api.records[level].id}",
        f"/documents/{api.documents[level].id}",
        f"/documents/{api.documents[level].id}/download?format=pdf",
    ):
        response = api.client.get(API + path)
        if visible:
            assert response.status_code == 200, f"{actor} {level} {path}: {response.text}"
            if "/download" in path:
                assert response.content == b"%PDF-grade-acceptance"
        else:
            _error(response, 404, "BOOK_NOT_FOUND")


@pytest.mark.parametrize("actor", VISIBLE)
@pytest.mark.parametrize("level", LEVELS)
def test_word_reopen_visibility_matrix(grade_api: ApiHarness, actor: str, level: str) -> None:
    api = grade_api
    api.as_user(actor)
    response = api.client.post(f"{API}/books/{api.records[level].id}/word-sessions")
    if level in VISIBLE[actor]:
        # Missing source DOCX is a deliberate later failure: no Word COM fixture
        # is needed, and this 409 proves the real full-record gate passed.
        _error(response, 409, "NO_SOURCE_DOCX")
    else:
        _error(response, 404, "BOOK_NOT_FOUND")


def test_named_send_inboxes_and_first_read(grade_api: ApiHarness) -> None:
    api = grade_api
    sent = _send(api, "named", ["B"], purpose="action", note="Please act")
    row = sent["sent"][0]
    assert row["read_at"] is None
    assert row["sent_by_user_id"] == api.users["A"].id
    _listing(api, {"named"}, "sent")
    api.as_user("B")
    _listing(api, {"general", "named"})
    _listing(api, {"named"}, "received")
    _listing(api, set(), "sent")
    stored = api.db.get(BookRecipient, row["id"])
    assert stored.read_at is None, "Listing must not mark a record read"
    response = api.client.get(f"{API}/books/{api.records['named'].id}")
    assert response.status_code == 200, response.text
    inbox = response.json()["my_inbox"]
    assert inbox["id"] == row["id"]
    assert inbox["purpose"] == "action"
    assert inbox["note"] == "Please act"
    assert inbox["sent_by_user_id"] == api.users["A"].id
    assert inbox["read_at"] is not None
    api.db.refresh(stored)
    first_read = stored.read_at
    assert first_read is not None
    second = api.client.get(f"{API}/books/{api.records['named'].id}")
    assert second.status_code == 200, second.text
    assert (
        datetime.fromisoformat(second.json()["my_inbox"]["read_at"]).replace(tzinfo=None)
        == first_read
    )
    api.db.refresh(stored)
    assert stored.read_at == first_read
    api.as_user("C")
    _error(api.client.get(f"{API}/books/{api.records['named'].id}"), 404, "BOOK_NOT_FOUND")
    _listing(api, {"general"})


def test_assigned_approver_reads_secret_revision_not_register(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    record = api.records["secret"]
    version = api.db.scalar(select(BookVersion).where(BookVersion.book_id == record.id))
    api.db.add(
        BookApprovalStep(
            book_id=record.id,
            version_id=version.id,
            step_order=0,
            stage_label="Approve",
            assignee_user_id=api.users["M"].id,
            state="pending",
            kind="approver",
        )
    )
    api.db.commit()
    api.as_user("M")
    response = api.client.get(f"{API}/books/{record.id}")
    assert response.status_code == 200, response.text
    assert response.json()["access_scope"] == "assigned_revision"
    _listing(api, {"general"})


def test_named_send_preserves_grade_and_distribution(grade_api: ApiHarness) -> None:
    api = grade_api
    sent = _send(api, "creator_only", ["B"])
    assert len(sent["sent"]) == 1
    detail = api.client.get(f"{API}/books/{api.records['creator_only'].id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["grade"] == "unclassified"
    assert detail.json()["distribution"] == "named"
    assert not _audits(api, "creator_only", "book_grade_changed")
    assert _audits(api, "creator_only", "book_sent") == [
        {
            "ref_number": api.records["creator_only"].ref_number,
            "user_ids": [api.users["B"].id],
            "purpose": "info",
        }
    ]


@pytest.mark.parametrize("sender", ("C2", "D"))
def test_secret_send_rejects_uncleared_recipient(grade_api: ApiHarness, sender: str) -> None:
    api = grade_api
    api.as_user(sender)
    error = _error(
        api.client.post(
            f"{API}/books/{api.records['secret'].id}/send",
            json={"user_ids": [api.users["C"].id], "purpose": "info"},
        ),
        422,
        "RECIPIENT_NOT_CLEARED",
    )
    assert error["details"]["user_ids"] == [api.users["C"].id]
    assert not api.pushes
    assert not _audits(api, "secret", "book_sent")


def test_send_skips_self_and_existing_recipient(grade_api: ApiHarness) -> None:
    api = grade_api
    _send(api, "named", ["B"])
    repeated = _send(api, "named", ["B", "A"])
    assert repeated["sent"] == []
    assert {row["user_id"]: row["reason"] for row in repeated["skipped"]} == {
        api.users["B"].id: "already_recipient",
        api.users["A"].id: "self",
    }
    assert len(api.pushes) == 1


def test_send_rejects_inactive_recipient(grade_api: ApiHarness) -> None:
    api = grade_api
    inactive = make_user(api.db, status="inactive", email="inactive-grade@test.ae")
    error = _error(
        api.client.post(
            f"{API}/books/{api.records['general'].id}/send",
            json={"user_ids": [inactive.id], "purpose": "info"},
        ),
        422,
        "RECIPIENT_INVALID",
    )
    assert error["details"]["user_ids"] == [inactive.id]
    assert not api.pushes


def test_sender_recall_removes_named_access_and_audits(grade_api: ApiHarness) -> None:
    api = grade_api
    row = _send(api, "named", ["B"])["sent"][0]
    api.as_user("B")
    assert api.client.get(f"{API}/books/{api.records['named'].id}").status_code == 200
    api.as_user("A")
    response = api.client.delete(f"{API}/books/{api.records['named'].id}/recipients/{row['id']}")
    assert response.status_code == 204, response.text
    assert _audits(api, "named", "book_send_recalled") == [
        {
            "ref_number": api.records["named"].ref_number,
            "recipient_id": row["id"],
            "user_id": api.users["B"].id,
        }
    ]
    stored = api.db.get(BookRecipient, row["id"])
    assert stored.revoked_at is not None
    assert stored.revoked_by_user_id == api.users["A"].id
    api.as_user("B")
    _error(api.client.get(f"{API}/books/{api.records['named'].id}"), 404, "BOOK_NOT_FOUND")
    _listing(api, {"general"})
    _listing(api, set(), "received")


def test_unrelated_operator_cannot_recall_open_general_record(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    row = _send(api, "general", ["B"])["sent"][0]
    api.as_user("C")
    assert api.client.get(f"{API}/books/{api.records['general'].id}").status_code == 200
    _error(
        api.client.delete(f"{API}/books/{api.records['general'].id}/recipients/{row['id']}"),
        403,
        "FORBIDDEN",
    )
    assert api.db.get(BookRecipient, row["id"]).revoked_at is None


def test_direct_send_overrides_general_record_type_denial(grade_api: ApiHarness) -> None:
    api = grade_api
    perm_service.set_user_override(
        api.db, api.users["C"].id, "books.category.HR", "deny", actor=api.users["D"]
    )
    api.as_user("C")
    _error(api.client.get(f"{API}/books/{api.records['general'].id}"), 403, "RECORD_TYPE_FORBIDDEN")
    _listing(api, set())
    api.as_user("A")
    _send(api, "general", ["C"])
    api.as_user("C")
    response = api.client.get(f"{API}/books/{api.records['general'].id}")
    assert response.status_code == 200, response.text
    _listing(api, {"general"})
    _listing(api, {"general"}, "received")
    for suffix in ("", "/download?format=pdf"):
        response = api.client.get(f"{API}/documents/{api.documents['general'].id}{suffix}")
        assert response.status_code == 200, response.text


@pytest.mark.parametrize("actor,status", (("A", 200), ("D", 200), ("B", 403), ("M", 403)))
def test_grade_change_authority_and_audit(grade_api: ApiHarness, actor: str, status: int) -> None:
    api = grade_api
    _send(api, "general", ["B"])
    api.as_user(actor)
    response = api.client.put(
        f"{API}/books/{api.records['general'].id}/grade",
        json={"grade": "top_secret"},
    )
    assert response.status_code == status, response.text
    if status == 200:
        assert response.json()["grade"] == "top_secret"
        assert response.json()["distribution"] == "named"
        assert _audits(api, "general", "book_grade_changed") == [
            {
                "ref_number": api.records["general"].ref_number,
                "old": "unclassified",
                "new": "top_secret",
                "distribution": {"old": "organization", "new": "named"},
            }
        ]
    else:
        assert not _audits(api, "general", "book_grade_changed")


def test_uncleared_creator_cannot_change_level_to_secret(grade_api: ApiHarness) -> None:
    api = grade_api
    _error(
        api.client.put(
            f"{API}/books/{api.records['general'].id}/grade",
            json={"grade": "secret"},
        ),
        403,
        "SECRET_CLEARANCE_REQUIRED",
    )
    assert api.records["general"].grade == "unclassified"


def test_uncleared_manager_cannot_create_secret_record(grade_api: ApiHarness) -> None:
    api = grade_api
    api.as_user("M")
    _error(
        api.client.post(
            f"{API}/books",
            json={
                "category_id": "HR",
                "subject": "Uncleared creation",
                "grade": "secret",
            },
        ),
        403,
        "SECRET_CLEARANCE_REQUIRED",
    )


def test_manager_clearance_directory_grant_revoke_and_self_guard(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    api.as_user("C")
    _error(api.client.get(f"{API}/auth/secret-clearance"), 403, "FORBIDDEN")
    api.as_user("M")
    response = api.client.get(f"{API}/auth/secret-clearance")
    assert response.status_code == 200, response.text
    directory = {row["user_id"]: row for row in response.json()}
    assert directory[api.users["C"].id]["cleared"] is False
    assert directory[api.users["D"].id]["cleared"] is True
    assert directory[api.users["D"].id]["locked"] is True
    for enabled in (True, False):
        response = api.client.put(
            f"{API}/auth/users/{api.users['C'].id}/secret-clearance", json={"enabled": enabled}
        )
        assert response.status_code == 204, response.text
        api.as_user("C")
        response = api.client.get(f"{API}/books/{api.records['secret'].id}")
        if enabled:
            assert response.status_code == 200, response.text
            _listing(api, {"general", "secret"})
        else:
            _error(response, 404, "BOOK_NOT_FOUND")
            _listing(api, {"general"})
        api.as_user("M")
    _error(
        api.client.put(
            f"{API}/auth/users/{api.users['M'].id}/secret-clearance", json={"enabled": True}
        ),
        400,
        "FORBIDDEN_OVERRIDE",
    )


def test_inbox_summary_and_notification_counts_follow_first_open(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    _send(api, "named", ["B"], purpose="action")
    api.as_user("B")
    for unread in (1, 0):
        summary = api.client.get(f"{API}/books/inbox/summary")
        assert summary.status_code == 200, summary.text
        assert summary.json() == {
            "unread": unread,
            "received": 1,
            "sent": 0,
            "archived": 0,
            "by_purpose": {"info": 0, "action": 1, "reply": 0, "circulate": 0},
        }
        counts = api.client.get(f"{API}/notifications/counts")
        assert counts.status_code == 200, counts.text
        assert counts.json()["inbox"] == unread
        if unread:
            detail = api.client.get(f"{API}/books/{api.records['named'].id}")
            assert detail.status_code == 200, detail.text


def test_secret_recipient_candidates_exclude_uncleared_and_self(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    response = api.client.get(f"{API}/books/recipient-candidates", params={"grade": "secret"})
    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()} == {api.users["C2"].id, api.users["D"].id}
    assert all(row["has_secret_clearance"] for row in response.json())


def test_recipient_forward_and_recipient_list_visibility(grade_api: ApiHarness) -> None:
    api = grade_api
    initial = _send(api, "named", ["B", "C2"])["sent"]
    api.as_user("B")
    forwarded = _send(api, "named", ["C"])["sent"][0]
    assert forwarded["sent_by_user_id"] == api.users["B"].id
    url = f"{API}/books/{api.records['named'].id}/recipients"
    response = api.client.get(url)
    assert response.status_code == 200, response.text
    own = {row["user_id"]: row for row in response.json()}
    assert set(own) == {api.users["B"].id, api.users["C"].id}
    assert own[api.users["B"].id]["can_recall"] is False
    assert own[api.users["C"].id]["can_recall"] is True
    api.as_user("A")
    response = api.client.get(url)
    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()} == {row["id"] for row in initial} | {
        forwarded["id"]
    }
    assert len(api.pushes) == 3


def test_named_recipient_can_read_but_cannot_mutate(grade_api: ApiHarness) -> None:
    api = grade_api
    _send(api, "named", ["B"])
    api.as_user("B")
    book = api.records["named"]
    assert api.client.get(f"{API}/books/{book.id}").status_code == 200
    pdf = api.client.get(f"{API}/documents/{api.documents['named'].id}/download?format=pdf")
    assert pdf.status_code == 200, pdf.text
    assert pdf.content == b"%PDF-grade-acceptance"
    _error(
        api.client.patch(f"{API}/books/{book.id}", json={"subject": "Changed"}),
        404,
        "BOOK_NOT_FOUND",
    )
    _error(api.client.post(f"{API}/books/{book.id}/word-sessions"), 404, "BOOK_NOT_FOUND")


def test_general_recipient_does_not_override_write_type_denial(
    grade_api: ApiHarness,
) -> None:
    api = grade_api
    perm_service.set_user_override(
        api.db, api.users["B"].id, "books.category.HR", "deny", actor=api.users["D"]
    )
    _send(api, "general", ["B"])
    api.as_user("B")
    assert api.client.get(f"{API}/books/{api.records['general'].id}").status_code == 200
    response = api.client.patch(
        f"{API}/books/{api.records['general'].id}", json={"subject": "Changed"}
    )
    _error(response, 403, "RECORD_TYPE_FORBIDDEN")


def test_reporter_cannot_send_or_list_recipient_candidates(grade_api: ApiHarness) -> None:
    api = grade_api
    reporter = make_user(api.db, role="inmate_reporter", email="reporter-send@test.ae")
    api.actor = reporter
    _error(
        api.client.post(
            f"{API}/books/{api.records['general'].id}/send",
            json={"user_ids": [api.users["B"].id], "purpose": "info"},
        ),
        403,
        "FORBIDDEN",
    )
    _error(api.client.get(f"{API}/books/recipient-candidates"), 403, "FORBIDDEN")


def test_recall_discards_legacy_recipient_word_token(grade_api: ApiHarness, tmp_path: Path) -> None:
    from app.db.models import BookEditSession

    api = grade_api
    recipient = _send(api, "named", ["B"])["sent"][0]
    working = tmp_path / "legacy-session.docx"
    working.write_bytes(b"legacy Word draft")
    session = BookEditSession(
        book_id=api.records["named"].id,
        user_id=api.users["B"].id,
        token="legacy-recipient-word-token",
        working_path=str(working),
        state="active",
    )
    api.db.add(session)
    api.db.commit()
    response = api.client.delete(
        f"{API}/books/{api.records['named'].id}/recipients/{recipient['id']}"
    )
    assert response.status_code == 204, response.text
    assert session.state == "discarded"
    assert api.client.get(f"/dav/{session.token}/legacy-session.docx").status_code == 404


def test_dav_rechecks_access_after_relabel_without_session_cleanup(
    grade_api: ApiHarness, tmp_path: Path
) -> None:
    from app.db.models import BookEditSession

    api = grade_api
    working = tmp_path / "editor.docx"
    working.write_bytes(b"Word draft")
    session = BookEditSession(
        book_id=api.records["general"].id,
        user_id=api.users["B"].id,
        token="relabelled-word-token",
        working_path=str(working),
        state="active",
    )
    api.db.add(session)
    api.db.commit()
    url = f"/dav/{session.token}/editor.docx"
    assert api.client.get(url).status_code == 200
    api.records["general"].grade = "top_secret"
    api.records["general"].distribution = "named"
    api.db.commit()
    assert api.client.get(url).status_code == 404
    assert api.client.put(url, content=b"changed").status_code == 404
    assert api.client.request("PROPFIND", f"/dav/{session.token}/").status_code == 404
    assert working.read_bytes() == b"Word draft"


def test_relabel_discards_inaccessible_word_session(grade_api: ApiHarness, tmp_path: Path) -> None:
    from app.db.models import BookEditSession

    api = grade_api
    working = tmp_path / "relabel-session.docx"
    working.write_bytes(b"Word draft")
    session = BookEditSession(
        book_id=api.records["general"].id,
        user_id=api.users["B"].id,
        token="discard-on-relabel",
        working_path=str(working),
        state="active",
    )
    api.db.add(session)
    api.db.commit()
    response = api.client.put(
        f"{API}/books/{api.records['general'].id}/grade",
        json={"grade": "top_secret"},
    )
    assert response.status_code == 200, response.text
    assert session.state == "discarded"
    assert api.client.get(f"/dav/{session.token}/relabel-session.docx").status_code == 404


def test_named_recipient_write_flag_and_forwarding(grade_api: ApiHarness) -> None:
    api = grade_api
    _send(api, "named", ["M"])
    record_id = api.records["named"].id

    for actor, can_write in (("M", False), ("A", True)):
        api.as_user(actor)
        assert perm_service.has_capability(api.db, api.actor, "books.edit")
        detail = api.client.get(f"{API}/books/{record_id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["can_write"] is can_write
        assert detail.json()["can_send"] is True

        listing = api.client.get(f"{API}/books")
        assert listing.status_code == 200, listing.text
        row = next(item for item in listing.json()["items"] if item["id"] == record_id)
        assert row["can_write"] is can_write
        assert row["can_send"] is True


@pytest.mark.parametrize("grade", ("top_secret", "addressee_only"))
def test_restricted_grade_send_is_writer_only(grade_api: ApiHarness, grade: str) -> None:
    api = grade_api
    record = api.records["creator_only"]
    record.grade = grade
    api.db.commit()
    _send(api, "creator_only", ["B"])
    assert record.grade == grade
    assert record.distribution == "named"
    api.as_user("B")
    _error(
        api.client.post(
            f"{API}/books/{record.id}/send",
            json={"user_ids": [api.users["C"].id], "purpose": "info"},
        ),
        403,
        "WRITER_ONLY_SEND",
    )


@pytest.mark.parametrize("grade", ("top_secret", "addressee_only"))
def test_reference_send_skips_writer_only(grade_api: ApiHarness, grade: str) -> None:
    from app.db.models import BookLink

    api = grade_api
    reference = api.records["creator_only"]
    reference.grade = grade
    api.db.commit()
    _send(api, "creator_only", ["B"])
    api.db.add(
        BookLink(
            book_id=api.records["general"].id,
            target_book_id=reference.id,
            kind="reference",
            attached=True,
            created_by_user_id=api.users["A"].id,
        )
    )
    api.db.commit()
    api.as_user("B")
    response = api.client.post(
        f"{API}/books/{api.records['general'].id}/send",
        json={"user_ids": [api.users["C"].id], "purpose": "info"},
    )
    assert response.status_code == 200, response.text
    result = response.json()["references"][0]
    assert result["sent_user_ids"] == []
    assert result["skipped"] == [{"user_id": api.users["C"].id, "reason": "writer_only"}]


def test_admin_restricted_record_is_metadata_only(grade_api: ApiHarness) -> None:
    api = grade_api
    record = api.records["creator_only"]
    record.grade = "top_secret"
    api.db.commit()
    api.as_user("D")
    response = api.client.get(f"{API}/books")
    assert response.status_code == 200, response.text
    row = next(item for item in response.json()["items"] if item["id"] == record.id)
    assert row["metadata_only"] is True
    assert row["subject"] is None
    for path in (
        f"/books/{record.id}",
        f"/documents/{api.documents['creator_only'].id}",
        f"/documents/{api.documents['creator_only'].id}/download?format=pdf",
    ):
        _error(api.client.get(API + path), 404, "BOOK_NOT_FOUND")
