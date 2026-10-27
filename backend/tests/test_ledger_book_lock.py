"""Signed Ledger Revisions reject the generic book mutation API surface."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import Settings
from app.db.models import (
    AuditLog,
    Book,
    BookAnnotation,
    BookApprovalStep,
    BookEditSession,
    BookLink,
    BookRecipient,
    BookVersion,
    LedgerBookSave,
    User,
)
from app.db.session import get_db
from app.main import create_app
from app.services import book_service, ledger_book_service
from tests.conftest import make_user

_ATTACHMENT = b"%PDF-1.4\noriginal attachment\n%%EOF\n"
_SIGNED_AT = datetime(2026, 1, 15, 12, 0)
_ANNOTATION = {
    "page": 1,
    "kind": "pin",
    "geometry": {"x": 0.25, "y": 0.5},
    "comment": "Review this paragraph",
}


@dataclass
class LedgerBookAPI:
    db: Session
    client: TestClient
    creator: User
    admin: User
    actor: list[User]
    book_id: int
    version_id: int
    recipient_id: int
    reviewer_id: int
    data_dir: Path
    target_book_id: int | None = None
    annotation_id: int | None = None

    def sign(self) -> None:
        version = self.db.get(BookVersion, self.version_id)
        version.signed_at = _SIGNED_AT
        self.db.commit()
        self.db.expire_all()


@pytest.fixture()
def ledger_api(api_db, monkeypatch, tmp_path):
    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(ledger_book_service, "get_settings", lambda: settings)
    monkeypatch.setattr(book_service, "get_settings", lambda: settings)
    creator = make_user(api_db, role="manager", email="ledger-writer@test.ae")
    admin = make_user(api_db, role="admin", email="ledger-admin@test.ae")
    reviewer = make_user(api_db, email="ledger-reviewer@test.ae")
    actor = [creator]
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: actor[0]
    with TestClient(app) as client:
        draft = client.post(
            "/api/v1/ledger/drafts",
            json={"tab": 3, "subjects": ["Original subject"], "body_html": "<p>Original body</p>"},
        )
        assert draft.status_code == 201, draft.text
        sent = client.post(f"/api/v1/ledger/drafts/{draft.json()['id']}/save-and-send")
        assert sent.status_code == 200, sent.text
        detail = sent.json()
        book_id = detail["id"]
        version_id = detail["selected_version_id"]
        # The attachment-delete route checks its index before entering the guard.
        attachment = settings.data_dir / "book_attachments" / str(book_id) / "original.pdf"
        attachment.parent.mkdir(parents=True)
        attachment.write_bytes(_ATTACHMENT)
        book = api_db.get(Book, book_id)
        book.attachment_paths = [attachment.relative_to(settings.data_dir).as_posix()]
        recipient = BookRecipient(
            book_id=book_id,
            user_id=reviewer.id,
            sent_by_user_id=creator.id,
            purpose="info",
        )
        api_db.add(recipient)
        api_db.add(
            BookApprovalStep(
                book_id=book_id,
                version_id=version_id,
                step_order=1,
                stage_label="Reviewer",
                assignee_user_id=reviewer.id,
                kind="reviewer",
                state="pending",
            )
        )
        api_db.commit()
        yield LedgerBookAPI(
            api_db,
            client,
            creator,
            admin,
            actor,
            book_id,
            version_id,
            recipient.id,
            reviewer.id,
            settings.data_dir,
        )
    app.dependency_overrides.clear()


def _snapshot(api: LedgerBookAPI) -> dict:
    """Persisted book data, workflow/history, and bytes must all stay untouched."""
    api.db.expire_all()
    models = (
        Book,
        BookVersion,
        LedgerBookSave,
        BookApprovalStep,
        BookRecipient,
        BookEditSession,
        BookLink,
        BookAnnotation,
        AuditLog,
    )
    rows = {
        model.__tablename__: list(
            api.db.execute(select(model.__table__).order_by(model.__table__.c.id)).mappings()
        )
        for model in models
    }
    return deepcopy(
        {
            "rows": rows,
            "files": {
                path.relative_to(api.data_dir).as_posix(): path.read_bytes()
                for path in api.data_dir.rglob("*")
                if path.is_file()
            },
        }
    )


def _mutate(api: LedgerBookAPI, method: str, route: str, payload: str | None = None):
    api.actor[0] = api.creator if route.startswith("/ledger/") else api.admin
    path = route.format(
        book_id=api.book_id,
        recipient_id=api.recipient_id,
        user_id=api.reviewer_id,
        target_book_id=api.target_book_id,
        version_id=api.version_id,
        annotation_id=api.annotation_id,
    )
    payloads = {
        "metadata": {"subject": "Changed subject"},
        "reviewers": {"user_ids": [api.reviewer_id]},
        "grade": {"grade": "secret"},
        "restore": {"reason": "Restore distribution"},
        "send": {"user_ids": [api.reviewer_id], "purpose": "info"},
        "state": {"state": "rejected", "reason": "Repair state"},
        "submit": {"approver_user_id": api.admin.id, "reviewer_user_ids": []},
        "sign": {"version_id": api.version_id},
        "decision": {"version_id": api.version_id, "note": "Requested decision"},
        "content": {"subjects": ["Changed subject"], "body_html": "<p>Changed body</p>"},
        "link": {"target_book_id": api.target_book_id},
        "review": {
            "version_id": api.version_id,
            "decision": "reviewed",
            "note": "Reviewed",
        },
        "annotation": _ANNOTATION,
    }
    if payload in ("upload", "upload_signed"):
        return api.client.request(
            method,
            f"/api/v1{path}",
            files={"file": ("replacement.pdf", b"%PDF-1.4\nreplacement\n%%EOF", "application/pdf")},
            data={"as_signed": "true"} if payload == "upload_signed" else None,
        )
    kwargs = {"json": payloads[payload]} if payload else {}
    return api.client.request(method, f"/api/v1{path}", **kwargs)


def _prepare_mutation(api: LedgerBookAPI, method: str, route: str) -> None:
    if "/links" in route:
        api.actor[0] = api.creator
        draft = api.client.post(
            "/api/v1/ledger/drafts",
            json={"tab": 3, "subjects": ["Reference target"], "body_html": "<p>Reference body</p>"},
        )
        assert draft.status_code == 201, draft.text
        sent = api.client.post(f"/api/v1/ledger/drafts/{draft.json()['id']}/save-and-send")
        assert sent.status_code == 200, sent.text
        api.target_book_id = sent.json()["id"]
        if method == "DELETE":
            linked = _mutate(api, "POST", "/books/{book_id}/links", "link")
            assert linked.status_code == 201, linked.text
    if "/annotations" in route and method == "DELETE":
        created = _mutate(
            api, "POST", "/books/{book_id}/versions/{version_id}/annotations", "annotation"
        )
        assert created.status_code == 201, created.text
        api.annotation_id = created.json()["id"]
    if route.endswith(("/note", "/review")):
        # The mutation would otherwise be actionable for this actor: signing is
        # simulated solely by signed_at, as required for Phase 2a.
        api.db.get(Book, api.book_id).approval_state = "pending"
        api.db.add(
            BookApprovalStep(
                book_id=api.book_id,
                version_id=api.version_id,
                step_order=2,
                stage_label="Current assignment",
                assignee_user_id=api.admin.id,
                kind="reviewer" if route.endswith("/review") else "approver",
                state="pending",
            )
        )
        api.db.commit()


# Generic approval-flow entries refuse every Ledger Book, signed or not, with
# LEDGER_BOOK_CHAIN_ONLY (ADR 0008: signing authority is the Branch chain only).
# That check runs before the signature lock, so signed books answer it too.
_CHAIN_ONLY = {
    "unfile-signed-copy",
    "add-reviewer",
    "remove-reviewer",
    "override-state",
    "submit",
    "sign",
    "reject",
    "return",
    "finish-word",
    "add-note",
    "review",
}


def _expected_code(case_id: str) -> str:
    return "LEDGER_BOOK_CHAIN_ONLY" if case_id in _CHAIN_ONLY else "REVISION_LOCKED"


# PUT included-papers is intentionally excluded: a real Ledger Revision has no
# Document, so _editable_context raises INCLUDED_PAPERS_UNAVAILABLE before the
# lock guard (included_papers_service.py). Do not fabricate a DOCX/PDF-backed
# Ledger Revision merely to reach a guard that its real API cannot reach.
_GUARDED = [
    pytest.param("PATCH", "/books/{book_id}", "metadata", id="metadata"),
    pytest.param("DELETE", "/books/{book_id}", None, id="delete-book"),
    pytest.param("POST", "/books/{book_id}/attachments", "upload", id="add-attachment"),
    pytest.param("DELETE", "/books/{book_id}/attachments/0", None, id="delete-attachment"),
    pytest.param("PUT", "/books/{book_id}/attachments/0", "upload", id="replace-attachment"),
    pytest.param("PUT", "/books/{book_id}/signed-copy", "upload", id="replace-signed-copy"),
    pytest.param("DELETE", "/books/{book_id}/signed-copy", None, id="unfile-signed-copy"),
    pytest.param("POST", "/books/{book_id}/reviewers", "reviewers", id="add-reviewer"),
    pytest.param("DELETE", "/books/{book_id}/reviewers/{user_id}", None, id="remove-reviewer"),
    pytest.param("PUT", "/books/{book_id}/grade", "grade", id="grade"),
    pytest.param("POST", "/books/{book_id}/restore-distribution", "restore", id="distribution"),
    pytest.param("POST", "/books/{book_id}/send", "send", id="send"),
    pytest.param("DELETE", "/books/{book_id}/recipients/{recipient_id}", None, id="recall"),
    pytest.param("PUT", "/books/{book_id}/state", "state", id="override-state"),
    pytest.param("POST", "/books/{book_id}/submit", "submit", id="submit"),
    pytest.param("POST", "/books/{book_id}/sign", "sign", id="sign"),
    pytest.param("POST", "/books/{book_id}/reject", "decision", id="reject"),
    pytest.param("POST", "/books/{book_id}/return", "decision", id="return"),
    pytest.param("POST", "/books/{book_id}/word-sessions", None, id="reopen-word"),
    pytest.param("POST", "/books/{book_id}/word-sessions/finish", None, id="finish-word"),
    pytest.param("PUT", "/ledger/books/{book_id}/content", "content", id="ledger-content"),
    pytest.param("POST", "/books/{book_id}/links", "link", id="add-link"),
    pytest.param("DELETE", "/books/{book_id}/links/{target_book_id}", None, id="remove-link"),
    pytest.param("POST", "/books/{book_id}/note", "decision", id="add-note"),
    pytest.param("POST", "/books/{book_id}/review", "review", id="review"),
    pytest.param(
        "POST",
        "/books/{book_id}/versions/{version_id}/annotations",
        "annotation",
        id="add-annotation",
    ),
    pytest.param(
        "DELETE",
        "/books/{book_id}/versions/{version_id}/annotations/{annotation_id}",
        None,
        id="remove-annotation",
    ),
]


@pytest.mark.parametrize(("method", "route", "payload"), _GUARDED)
def test_signed_revision_rejects_mutation_without_changes(
    request, ledger_api, method, route, payload
):
    _prepare_mutation(ledger_api, method, route)
    ledger_api.sign()
    before = _snapshot(ledger_api)

    response = _mutate(ledger_api, method, route, payload)

    assert response.status_code == 409, response.text
    case_id = request.node.callspec.id
    assert response.json()["error"]["code"] == _expected_code(case_id)
    assert _snapshot(ledger_api) == before


@pytest.mark.parametrize(
    ("method", "route", "payload"),
    [param for param in _GUARDED if param.id in _CHAIN_ONLY]
    + [
        pytest.param(
            "POST", "/books/{book_id}/attachments", "upload_signed", id="record-signed-scan"
        )
    ],
)
def test_unsigned_ledger_book_refuses_generic_approval_flow(ledger_api, method, route, payload):
    _prepare_mutation(ledger_api, method, route)
    before = _snapshot(ledger_api)
    book = ledger_api.db.get(Book, ledger_api.book_id)
    state_before = book.approval_state
    steps_before = ledger_api.db.scalars(select(BookApprovalStep.id)).all()

    response = _mutate(ledger_api, method, route, payload)

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "LEDGER_BOOK_CHAIN_ONLY"
    ledger_api.db.expire_all()
    assert ledger_api.db.get(Book, ledger_api.book_id).approval_state == state_before
    assert ledger_api.db.scalars(select(BookApprovalStep.id)).all() == steps_before
    assert _snapshot(ledger_api) == before


@pytest.mark.parametrize(
    ("method", "route", "payload"),
    [
        ("PATCH", "/books/{book_id}", "metadata"),
        ("PUT", "/books/{book_id}/grade", "grade"),
        ("PUT", "/ledger/books/{book_id}/content", "content"),
    ],
    ids=["metadata", "grade", "content"],
)
def test_unsigned_revision_accepts_mutation(ledger_api, method, route, payload):
    response = _mutate(ledger_api, method, route, payload)

    assert response.status_code == 200, response.text
    ledger_api.db.expire_all()
    book = ledger_api.db.get(Book, ledger_api.book_id)
    if payload == "grade":
        assert book.grade == "secret"
    else:
        assert book.subject == "Changed subject"
    if payload == "content":
        assert response.json()["body_html"] == "<p>Changed body</p>"


def test_correction_unlocks_new_revision_without_changing_signed_content(ledger_api):
    api = ledger_api
    api.sign()
    api.actor[0] = api.creator
    signed_detail = api.client.get(f"/api/v1/ledger/books/{api.book_id}").json()

    correction = api.client.post(f"/api/v1/ledger/books/{api.book_id}/corrections")

    assert correction.status_code == 201, correction.text
    detail = correction.json()
    assert detail["selected_version_id"] != api.version_id
    assert [(r["version_no"], r["locked"], r["superseded"]) for r in detail["revisions"]] == [
        (1, True, True),
        (2, False, False),
    ]
    assert detail["revisions"][1]["trigger"] == "correction"
    assert detail["body_html"] == signed_detail["body_html"]
    response = _mutate(api, "PUT", "/ledger/books/{book_id}/content", "content")
    assert response.status_code == 200, response.text
    assert response.json()["selected_version_id"] == detail["selected_version_id"]
    assert response.json()["body_html"] == "<p>Changed body</p>"
    old = api.client.get(f"/api/v1/ledger/books/{api.book_id}?revision={api.version_id}")
    assert old.status_code == 200, old.text
    assert old.json()["body_html"] == signed_detail["body_html"]
    assert old.json()["subjects"] == signed_detail["subjects"]
    assert old.json()["content_sha256"] == signed_detail["content_sha256"]
    api.db.expire_all()
    assert api.db.get(BookVersion, api.version_id).signed_at == _SIGNED_AT


def test_correction_keeps_signed_revision_annotations_locked(ledger_api):
    api = ledger_api
    annotations = f"/api/v1/books/{api.book_id}/versions/{api.version_id}/annotations"
    api.actor[0] = api.admin
    initial = api.client.post(annotations, json=_ANNOTATION)
    assert initial.status_code == 201, initial.text
    api.sign()
    api.actor[0] = api.creator
    correction = api.client.post(f"/api/v1/ledger/books/{api.book_id}/corrections")
    assert correction.status_code == 201, correction.text
    version_id = correction.json()["selected_version_id"]
    assert version_id != api.version_id
    api.actor[0] = api.admin
    before = _snapshot(api)

    for response in (
        api.client.post(annotations, json=_ANNOTATION),
        api.client.delete(f"{annotations}/{initial.json()['id']}"),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "REVISION_LOCKED"
    assert _snapshot(api) == before

    new_annotations = f"/api/v1/books/{api.book_id}/versions/{version_id}/annotations"
    created = api.client.post(new_annotations, json=_ANNOTATION)
    assert created.status_code == 201, created.text
    assert created.json()["version_id"] == version_id
    removed = api.client.delete(f"{new_annotations}/{created.json()['id']}")
    assert removed.status_code == 204, removed.text
    signed_annotations = api.client.get(annotations)
    assert signed_annotations.status_code == 200, signed_annotations.text
    assert [row["id"] for row in signed_annotations.json()] == [initial.json()["id"]]


def test_included_papers_is_unavailable_before_the_lock_guard(ledger_api):
    api = ledger_api
    api.sign()
    api.actor[0] = api.creator
    before = _snapshot(api)

    response = api.client.put(
        f"/api/v1/books/{api.book_id}/included-papers", json={"revision": 0, "items": []}
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "INCLUDED_PAPERS_UNAVAILABLE"
    assert _snapshot(api) == before


@pytest.mark.parametrize("signed", [False, True], ids=["unsigned", "signed"])
def test_docx_regeneration_never_rewrites_a_ledger_revision(ledger_api, signed):
    api = ledger_api
    if signed:
        api.sign()
    before = _snapshot(api)
    api.actor[0] = api.admin

    response = api.client.post(
        "/api/v1/documents/generate",
        json={
            "template_id": "General Book",
            "fields": {"subject": "Hijack", "body": "x"},
            "commit": True,
            "revise_of_book_id": api.book_id,
            "classification_code": "5/1",
        },
    )

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "LEDGER_BOOK_CHAIN_ONLY"
    assert _snapshot(api) == before


def test_background_regeneration_rechecks_ledger_books(ledger_api):
    # The job runs generate_document in its own session; it must refuse even
    # without the request-time access check (record_access_user=None).
    from app.api.errors import AppError
    from app.services import document_service

    api = ledger_api
    before = _snapshot(api)

    with pytest.raises(AppError) as raised:
        document_service.generate_document(
            api.db,
            employee_id=None,
            template_id="General Book",
            fields={"subject": "Hijack", "body": "x"},
            commit=True,
            current_user=api.admin,
            revise_of_book_id=api.book_id,
            classification_code="5/1",
        )

    assert raised.value.code == "LEDGER_BOOK_CHAIN_ONLY"
    api.db.rollback()
    assert _snapshot(api) == before
    version = api.db.get(BookVersion, api.version_id)
    assert version.template_id == "Ledger Book"
