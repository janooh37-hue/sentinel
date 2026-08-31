from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import AppError
from app.core import permissions
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
from app.db.models import (
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Document,
    RolePermission,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.schemas.book import BookCreate
from app.schemas.permit import PermitCreate
from app.services import (
    book_service,
    document_service,
    included_papers_service,
    notification_service,
    perm_service,
    permit_service,
)


@dataclass
class ApiHarness:
    db: Session
    actor: User
    client: TestClient

    def as_user(self, user: User) -> None:
        self.actor = user


@pytest.fixture()
def mirror_api(api_db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[ApiHarness]:
    admin = User(
        email="mirror-admin@test.ae",
        password_hash="x",
        role="admin",
        status="active",
        display_name="Mirror Admin",
    )
    api_db.add(admin)
    api_db.commit()
    api_db.refresh(admin)

    app = create_app()
    holder: dict[str, User] = {"actor": admin}
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: holder["actor"]

    with TestClient(app, raise_server_exceptions=True) as client:
        harness = ApiHarness(api_db, admin, client)

        def switch(user: User) -> None:
            holder["actor"] = user
            harness.actor = user

        monkeypatch.setattr(harness, "as_user", switch)
        yield harness


def _user(db: Session, *, role: str, email: str) -> User:
    row = User(email=email, password_hash="x", role=role, status="active")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _category(
    db: Session,
    category_id: str,
    *,
    name_en: str | None = None,
    name_ar: str | None = None,
) -> BookCategory:
    row = BookCategory(
        id=category_id,
        prefix=category_id,
        name_en=name_en,
        name_ar=name_ar,
        requires_approval=False,
    )
    db.add(row)
    db.commit()
    return row


def _book(
    db: Session,
    *,
    ref_number: str,
    category_id: str,
    service_id: str,
    state: str = "none",
    user_id: int | None = None,
    submitted_by_user_id: int | None = None,
    created_at: datetime | None = None,
) -> Book:
    row = Book(
        ref_number=ref_number,
        category_id=category_id,
        subject=f"{service_id} — {ref_number}",
        direction="outgoing",
        approval_state=state,
        submitted_by_user_id=submitted_by_user_id,
        created_at=created_at or datetime.now(),
    )
    db.add(row)
    db.flush()
    version = BookVersion(
        book_id=row.id,
        version_no=1,
        template_id=service_id,
        fields={},
        status=state,
        created_by_user_id=user_id,
    )
    db.add(version)
    db.commit()
    db.refresh(row)
    return row


def _assign_pending_step(db: Session, book: Book, user: User) -> None:
    version = db.scalar(select(BookVersion).where(BookVersion.book_id == book.id))
    assert version is not None
    db.add(
        BookApprovalStep(
            book_id=book.id,
            version_id=version.id,
            step_order=0,
            stage_label="Approve",
            assignee_user_id=user.id,
            state="pending",
            kind="approver",
        )
    )
    db.commit()


def _assign_decided_step(db: Session, book: Book, user: User) -> None:
    version = db.scalar(select(BookVersion).where(BookVersion.book_id == book.id))
    assert version is not None
    db.add(
        BookApprovalStep(
            book_id=book.id,
            version_id=version.id,
            step_order=0,
            stage_label="Approve",
            assignee_user_id=user.id,
            state="approved",
            kind="approver",
            decided_at=datetime.now(),
        )
    )
    db.commit()


def _error_code(response) -> str:
    return response.json()["error"]["code"]


def test_expiry_capability_is_static_and_operator_default() -> None:
    expiry = next(cap for cap in permissions.CAPABILITIES if cap.id == "expiry.view")
    assert expiry.domain == "expiry"
    assert "expiry.view" in permissions.ROLE_DEFAULTS["operator"]
    assert "expiry.view" in permissions.ROLE_DEFAULTS["manager"]


def test_dynamic_capabilities_are_implicit_defaults_and_never_seeded(
    db_session: Session,
) -> None:
    category = _category(db_session, "MIR", name_en="Mirror")
    operator = _user(db_session, role="operator", email="dynamic-op@test.ae")
    admin = _user(db_session, role="admin", email="dynamic-admin@test.ae")

    service_caps = {
        f"books.service.{service_id}" for service_id in (*SERVICE_IDS, OTHER_SERVICE_ID)
    }
    service_record_caps = {
        f"books.servicerecords.{service_id}"
        for service_id in (*SERVICE_IDS, OTHER_SERVICE_ID)
    }
    category_cap = f"books.category.{category.id}"
    expected_dynamic = service_caps | service_record_caps | {category_cap}

    assert perm_service.dynamic_capability_ids(db_session) == expected_dynamic
    assert expected_dynamic <= perm_service.effective_caps(db_session, operator)
    assert expected_dynamic <= perm_service.effective_caps(db_session, admin)
    assert perm_service.denied_record_types(db_session, admin) == (set(), set())
    assert expected_dynamic.isdisjoint(permissions.ALL_CAPABILITIES)

    seeded = set(db_session.scalars(select(RolePermission.capability)).all())
    assert expected_dynamic.isdisjoint(seeded)

    denied_cap = "books.servicerecords.General Book"
    perm_service.set_user_override(db_session, operator.id, denied_cap, "deny", actor=admin)
    assert denied_cap not in perm_service.effective_caps(db_session, operator)
    denied_services, denied_categories = perm_service.denied_record_types(db_session, operator)
    assert denied_services == {"General Book"}
    assert denied_categories == set()


def test_override_validation_accepts_dynamic_ids_and_rejects_unknown(
    db_session: Session,
) -> None:
    _category(db_session, "MIR")
    operator = _user(db_session, role="operator", email="override-op@test.ae")
    admin = _user(db_session, role="admin", email="override-admin@test.ae")

    perm_service.set_user_overrides(
        db_session,
        operator.id,
        [
            ("books.service.General Book", "deny", None),
            ("books.category.MIR", "deny", None),
        ],
        actor=admin,
    )
    assert perm_service.get_user_overrides(db_session, operator.id) == {
        "books.service.General Book": "deny",
        "books.category.MIR": "deny",
    }

    with pytest.raises(AppError) as exc_info:
        perm_service.set_user_override(
            db_session,
            operator.id,
            "books.service.Nope",
            "deny",
            actor=admin,
        )
    assert exc_info.value.code == "UNKNOWN_CAPABILITY"


def test_single_expiring_dynamic_grant_requires_existing_deny(
    db_session: Session,
) -> None:
    operator = _user(db_session, role="operator", email="single-temp-op@test.ae")
    admin = _user(db_session, role="admin", email="single-temp-admin@test.ae")
    capability = "books.service.General Book"
    expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=2)

    with pytest.raises(AppError) as exc_info:
        perm_service.set_user_override(
            db_session,
            operator.id,
            capability,
            "grant",
            actor=admin,
            expires_at=expires_at,
        )

    assert exc_info.value.code == "TEMPORARY_GRANT_REQUIRES_DENY"
    assert db_session.get(UserPermission, (operator.id, capability)) is None


def test_bulk_expiring_dynamic_grant_requires_deny_before_any_write(
    db_session: Session,
) -> None:
    operator = _user(db_session, role="operator", email="bulk-temp-op@test.ae")
    admin = _user(db_session, role="admin", email="bulk-temp-admin@test.ae")
    capability = "books.service.General Book"
    expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=2)

    with pytest.raises(AppError) as exc_info:
        perm_service.set_user_overrides(
            db_session,
            operator.id,
            [
                ("leaves.edit", "grant", None),
                (capability, "grant", expires_at),
            ],
            actor=admin,
        )

    assert exc_info.value.code == "TEMPORARY_GRANT_REQUIRES_DENY"
    assert db_session.get(UserPermission, (operator.id, "leaves.edit")) is None
    assert db_session.get(UserPermission, (operator.id, capability)) is None


def test_auth_catalog_and_user_defaults_include_dynamic_capabilities(
    mirror_api: ApiHarness,
) -> None:
    category = _category(
        mirror_api.db,
        "OPS",
        name_en="Operations",
        name_ar="العمليات",
    )
    operator = _user(
        mirror_api.db,
        role="operator",
        email="catalog-op@test.ae",
    )

    response = mirror_api.client.get("/api/v1/auth/capabilities")
    assert response.status_code == 200, response.text
    catalog = {item["id"]: item for item in response.json()}
    service_items = [item for item in catalog.values() if item["domain"] == "services"]
    assert len(service_items) == len(SERVICE_IDS) + 1
    assert catalog["books.service.General Book"]["label"] == "General Book"
    assert catalog["books.service.other"]["label"] == "Other"
    assert catalog["books.service.General Book"]["default_roles"] == [
        "operator",
        "manager",
        "admin",
    ]
    assert catalog[f"books.category.{category.id}"] == {
        "id": f"books.category.{category.id}",
        "domain": "categories",
        "label": "Operations",
        "description": "العمليات",
        "default_roles": ["operator", "manager", "admin"],
    }

    detail = mirror_api.client.get(f"/api/v1/auth/users/{operator.id}/permissions")
    assert detail.status_code == 200, detail.text
    payload = detail.json()
    assert "books.service.General Book" in payload["role_defaults"]
    assert f"books.category.{category.id}" in payload["role_defaults"]
    assert "books.service.General Book" in payload["effective"]


def test_dynamic_permission_request_can_be_approved_to_restore_access(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    operator = _user(
        mirror_api.db,
        role="operator",
        email="request-op@test.ae",
    )
    admin = mirror_api.actor
    capability = "books.service.General Book"
    perm_service.set_user_override(
        mirror_api.db,
        operator.id,
        capability,
        "deny",
        actor=admin,
    )
    notified_labels: list[str] = []
    monkeypatch.setattr(
        "app.services.admin_notify.notify_admins_new_request",
        lambda _db, _user, label, _request_id: notified_labels.append(label),
    )

    mirror_api.as_user(operator)
    created = mirror_api.client.post(
        "/api/v1/permissions/requests",
        json={"capability": capability},
    )
    assert created.status_code == 201, created.text
    assert created.json()["capability_label"] == "General Book"
    assert notified_labels == ["General Book"]

    mirror_api.as_user(admin)
    decided = mirror_api.client.post(
        f"/api/v1/permissions/requests/{created.json()['id']}/decide",
        json={"decision": "permanent"},
    )
    assert decided.status_code == 200, decided.text
    assert capability in perm_service.effective_caps(mirror_api.db, operator)


def test_creation_cap_deny_does_not_hide_existing_service_records(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "OPEN", name_en="Open")
    visible = _book(
        mirror_api.db,
        ref_number="OPEN-1",
        category_id="OPEN",
        service_id="General Book",
    )
    operator = _user(
        mirror_api.db,
        role="operator",
        email="creation-only-deny-op@test.ae",
    )
    perm_service.set_user_override(
        mirror_api.db,
        operator.id,
        "books.service.General Book",
        "deny",
        actor=mirror_api.actor,
    )
    mirror_api.as_user(operator)

    listed = mirror_api.client.get("/api/v1/books")
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 1
    assert [item["ref_number"] for item in listed.json()["items"]] == [
        visible.ref_number
    ]

    facets = mirror_api.client.get("/api/v1/books/facets")
    assert facets.status_code == 200, facets.text
    assert facets.json()["total"] == 1
    assert [item["id"] for item in facets.json()["services"]] == ["General Book"]

    detail = mirror_api.client.get(f"/api/v1/books/{visible.id}")
    assert detail.status_code == 200, detail.text


def test_record_type_denies_hide_list_query_facets_categories_and_details(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "OPEN", name_en="Open")
    _category(mirror_api.db, "HIDDEN", name_en="Hidden")
    hidden_service = _book(
        mirror_api.db,
        ref_number="OPEN-1",
        category_id="OPEN",
        service_id="General Book",
    )
    visible = _book(
        mirror_api.db,
        ref_number="OPEN-2",
        category_id="OPEN",
        service_id="Report",
    )
    hidden_category = _book(
        mirror_api.db,
        ref_number="HIDDEN-1",
        category_id="HIDDEN",
        service_id="Warning Form",
    )
    operator = _user(
        mirror_api.db,
        role="operator",
        email="visibility-op@test.ae",
    )
    admin = mirror_api.actor
    perm_service.set_user_overrides(
        mirror_api.db,
        operator.id,
        [
            ("books.servicerecords.General Book", "deny", None),
            ("books.category.HIDDEN", "deny", None),
        ],
        actor=admin,
    )
    mirror_api.as_user(operator)

    listed = mirror_api.client.get("/api/v1/books")
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 1
    assert [item["ref_number"] for item in listed.json()["items"]] == [visible.ref_number]

    searched = mirror_api.client.get("/api/v1/books", params={"q": "General"})
    assert searched.status_code == 200, searched.text
    assert searched.json()["total"] == 0
    assert searched.json()["items"] == []

    facets = mirror_api.client.get("/api/v1/books/facets")
    assert facets.status_code == 200, facets.text
    assert facets.json()["total"] == 1
    assert [item["id"] for item in facets.json()["services"]] == ["Report"]

    categories = mirror_api.client.get("/api/v1/book-categories")
    assert categories.status_code == 200, categories.text
    assert [item["id"] for item in categories.json()] == ["OPEN"]

    for row in (hidden_service, hidden_category):
        detail = mirror_api.client.get(f"/api/v1/books/{row.id}")
        assert detail.status_code == 403
        assert _error_code(detail) == "RECORD_TYPE_FORBIDDEN"

        by_ref = mirror_api.client.get(f"/api/v1/books/by-ref/{row.ref_number}")
        assert by_ref.status_code == 403
        assert _error_code(by_ref) == "RECORD_TYPE_FORBIDDEN"

    allowed_detail = mirror_api.client.get(f"/api/v1/books/{visible.id}")
    assert allowed_detail.status_code == 200, allowed_detail.text


def test_api_create_endpoints_use_stored_record_classification(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "OPEN", name_en="Open")
    _category(mirror_api.db, "GS", name_en="General Services")
    _category(mirror_api.db, "HIDDEN", name_en="Hidden")
    manager = _user(
        mirror_api.db,
        role="manager",
        email="create-manager@test.ae",
    )
    admin = mirror_api.actor
    perm_service.set_user_overrides(
        mirror_api.db,
        manager.id,
        [
            ("books.service.General Book", "deny", None),
            ("books.service.Report", "deny", None),
            ("books.category.HIDDEN", "deny", None),
        ],
        actor=admin,
    )
    mirror_api.as_user(manager)

    denied_category = mirror_api.client.post(
        "/api/v1/books",
        json={
            "category_id": "HIDDEN",
            "subject": "Warning Form — hidden category",
            "direction": "incoming",
        },
    )
    assert denied_category.status_code == 403
    assert _error_code(denied_category) == "RECORD_TYPE_FORBIDDEN"

    subject_guessed_service_does_not_apply = mirror_api.client.post(
        "/api/v1/books",
        json={
            "category_id": "OPEN",
            "subject": "General Book — denied guessed service",
            "direction": "incoming",
        },
    )
    assert subject_guessed_service_does_not_apply.status_code == 201, (
        subject_guessed_service_does_not_apply.text
    )

    unknown_category = mirror_api.client.post(
        "/api/v1/books",
        json={
            "category_id": "MISSING",
            "subject": "Warning Form — missing category",
            "direction": "incoming",
        },
    )
    assert unknown_category.status_code == 404
    assert _error_code(unknown_category) == "BOOK_CATEGORY_NOT_FOUND"

    unknown_denied_service = mirror_api.client.post(
        "/api/v1/books",
        json={
            "category_id": "MISSING",
            "subject": "General Book — missing category and denied service",
            "direction": "incoming",
        },
    )
    assert unknown_denied_service.status_code == 404
    assert _error_code(unknown_denied_service) == "BOOK_CATEGORY_NOT_FOUND"

    general_word = mirror_api.client.post(
        "/api/v1/books/word-sessions",
        json={"subject": "Denied general book"},
    )
    assert general_word.status_code == 403
    assert _error_code(general_word) == "RECORD_TYPE_FORBIDDEN"

    report_word = mirror_api.client.post(
        "/api/v1/books/word-sessions",
        json={
            "subject": "Denied report",
            "signer_employee_id": "G-404",
        },
    )
    assert report_word.status_code == 403
    assert _error_code(report_word) == "RECORD_TYPE_FORBIDDEN"

    generated_alias = mirror_api.client.post(
        "/api/v1/documents/generate",
        json={"template_id": "Security Permit", "fields": {}},
    )
    assert generated_alias.status_code == 403
    assert _error_code(generated_alias) == "RECORD_TYPE_FORBIDDEN"

    system_row = book_service.create_book(
        mirror_api.db,
        BookCreate(
            category_id="HIDDEN",
            subject="General Book — trusted system flow",
            direction="incoming",
        ),
    )
    assert system_row.category_id == "HIDDEN"


def test_assigned_pending_approvals_bypass_record_type_denies_but_history_does_not(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _category(mirror_api.db, "APP", name_en="Approvals")
    manager = _user(
        mirror_api.db,
        role="manager",
        email="approvals-manager@test.ae",
    )
    signature_path = tmp_path / "manager-signature.png"
    signature_path.write_bytes(b"signature")
    manager.signature_path = str(signature_path)
    signed_pdf_path = tmp_path / "signed.pdf"
    signed_pdf_path.write_bytes(b"%PDF-signed")
    monkeypatch.setattr(
        document_service,
        "render_signed_pdf",
        lambda *_args, **_kwargs: str(signed_pdf_path),
    )
    monkeypatch.setattr(
        included_papers_service,
        "publish_signed_package",
        lambda *_args, **_kwargs: str(signed_pdf_path),
    )
    mirror_api.db.commit()
    admin = mirror_api.actor
    hidden_pending = _book(
        mirror_api.db,
        ref_number="APP-HIDDEN-PENDING",
        category_id="APP",
        service_id="General Book",
        state="pending",
        user_id=manager.id,
        submitted_by_user_id=manager.id,
    )
    visible_pending = _book(
        mirror_api.db,
        ref_number="APP-VISIBLE-PENDING",
        category_id="APP",
        service_id="Report",
        state="pending",
        user_id=manager.id,
        submitted_by_user_id=manager.id,
    )
    _assign_pending_step(mirror_api.db, hidden_pending, manager)
    _assign_pending_step(mirror_api.db, visible_pending, manager)
    hidden_decided = _book(
        mirror_api.db,
        ref_number="APP-HIDDEN-DECIDED",
        category_id="APP",
        service_id="General Book",
        state="approved",
        user_id=manager.id,
        submitted_by_user_id=manager.id,
    )
    visible_decided = _book(
        mirror_api.db,
        ref_number="APP-VISIBLE-DECIDED",
        category_id="APP",
        service_id="Report",
        state="approved",
        user_id=manager.id,
        submitted_by_user_id=manager.id,
    )
    _assign_decided_step(mirror_api.db, hidden_decided, manager)
    _assign_decided_step(mirror_api.db, visible_decided, manager)
    old = datetime.now() - timedelta(hours=48)
    hidden_scan = _book(
        mirror_api.db,
        ref_number="APP-HIDDEN-SCAN",
        category_id="APP",
        service_id="General Book",
        state="awaiting_scan",
        user_id=manager.id,
        submitted_by_user_id=manager.id,
        created_at=old,
    )
    visible_scan = _book(
        mirror_api.db,
        ref_number="APP-VISIBLE-SCAN",
        category_id="APP",
        service_id="Report",
        state="awaiting_scan",
        user_id=manager.id,
        submitted_by_user_id=manager.id,
        created_at=old,
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.service.General Book",
        "deny",
        actor=admin,
    )
    mirror_api.as_user(manager)

    awaiting = mirror_api.client.get("/api/v1/books/awaiting")
    assert awaiting.status_code == 200, awaiting.text
    assert {item["ref_number"] for item in awaiting.json()} == {
        hidden_pending.ref_number,
        visible_pending.ref_number,
    }

    scans = mirror_api.client.get(
        "/api/v1/books/awaiting-scan",
        params={"scope": "mine"},
    )
    assert scans.status_code == 200, scans.text
    assert [item["ref_number"] for item in scans.json()] == [visible_scan.ref_number]

    sent = mirror_api.client.get(
        "/api/v1/books/approval-log",
        params={"scope": "sent"},
    )
    assert sent.status_code == 200, sent.text
    assert {item["ref_number"] for item in sent.json()["items"]} == {
        visible_pending.ref_number,
        visible_decided.ref_number,
        visible_scan.ref_number,
    }

    received = mirror_api.client.get(
        "/api/v1/books/approval-log",
        params={"scope": "received"},
    )
    assert received.status_code == 200, received.text
    assert {item["ref_number"] for item in received.json()["items"]} == {
        hidden_pending.ref_number,
        visible_pending.ref_number,
        visible_decided.ref_number,
    }

    actionable_refs = {
        item.label
        for item in notification_service.actionable_items(mirror_api.db, manager)
        if item.kind in {"approval", "review", "scanback"}
    }
    assert hidden_pending.ref_number in actionable_refs
    assert hidden_scan.ref_number not in actionable_refs
    assert visible_pending.ref_number in actionable_refs
    assert visible_scan.ref_number in actionable_refs

    counts = notification_service.relevant_counts(
        mirror_api.db,
        manager,
        precomputed_leaves=0,
    )
    assert counts.approvals == 2

    assigned_detail = mirror_api.client.get(f"/api/v1/books/{hidden_pending.id}")
    assert assigned_detail.status_code == 200, assigned_detail.text

    decided = mirror_api.client.post(f"/api/v1/books/{hidden_pending.id}/sign")
    assert decided.status_code == 200, decided.text
    assert decided.json()["approval_state"] == "approved"

    hidden_after_decision = mirror_api.client.get(f"/api/v1/books/{hidden_pending.id}")
    assert hidden_after_decision.status_code == 403
    assert _error_code(hidden_after_decision) == "RECORD_TYPE_FORBIDDEN"


def test_approve_only_assignee_can_open_and_sign_denied_record(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _category(mirror_api.db, "ASSIGNED", name_en="Assigned reviews")
    _category(mirror_api.db, "OPEN", name_en="Open records")
    reviewer = _user(
        mirror_api.db,
        role="manager",
        email="approve-only-reviewer@test.ae",
    )
    signature_path = tmp_path / "approve-only-signature.png"
    signature_path.write_bytes(b"signature")
    reviewer.signature_path = str(signature_path)
    signed_pdf_path = tmp_path / "approve-only-signed.pdf"
    signed_pdf_path.write_bytes(b"%PDF-signed")
    monkeypatch.setattr(
        document_service,
        "render_signed_pdf",
        lambda *_args, **_kwargs: str(signed_pdf_path),
    )
    monkeypatch.setattr(
        included_papers_service,
        "publish_signed_package",
        lambda *_args, **_kwargs: str(signed_pdf_path),
    )
    mirror_api.db.commit()

    assigned = _book(
        mirror_api.db,
        ref_number="ASSIGNED-PENDING",
        category_id="ASSIGNED",
        service_id="General Book",
        state="pending",
        user_id=reviewer.id,
        submitted_by_user_id=reviewer.id,
    )
    _assign_pending_step(mirror_api.db, assigned, reviewer)
    unassigned = _book(
        mirror_api.db,
        ref_number="ASSIGNED-UNASSIGNED",
        category_id="ASSIGNED",
        service_id="General Book",
        state="pending",
        user_id=reviewer.id,
        submitted_by_user_id=reviewer.id,
    )
    visible_unassigned = _book(
        mirror_api.db,
        ref_number="OPEN-UNASSIGNED",
        category_id="OPEN",
        service_id="Report",
        state="pending",
        user_id=reviewer.id,
        submitted_by_user_id=reviewer.id,
    )
    perm_service.set_user_overrides(
        mirror_api.db,
        reviewer.id,
        [
            ("books.view", "deny", None),
            ("books.category.ASSIGNED", "deny", None),
        ],
        actor=mirror_api.actor,
    )
    mirror_api.as_user(reviewer)

    received_pending = mirror_api.client.get(
        "/api/v1/books/approval-log",
        params={"scope": "received"},
    )
    assert received_pending.status_code == 200, received_pending.text
    assert [item["ref_number"] for item in received_pending.json()["items"]] == [
        assigned.ref_number
    ]

    sent = mirror_api.client.get(
        "/api/v1/books/approval-log",
        params={"scope": "sent"},
    )
    assert sent.status_code == 403
    assert _error_code(sent) == "FORBIDDEN"

    global_list = mirror_api.client.get("/api/v1/books")
    assert global_list.status_code == 403
    assert _error_code(global_list) == "FORBIDDEN"

    awaiting = mirror_api.client.get("/api/v1/books/awaiting")
    assert awaiting.status_code == 200, awaiting.text
    assert [item["ref_number"] for item in awaiting.json()] == [assigned.ref_number]

    unassigned_detail = mirror_api.client.get(f"/api/v1/books/{unassigned.id}")
    assert unassigned_detail.status_code == 403
    assert _error_code(unassigned_detail) == "FORBIDDEN"

    visible_unassigned_detail = mirror_api.client.get(f"/api/v1/books/{visible_unassigned.id}")
    assert visible_unassigned_detail.status_code == 403
    assert _error_code(visible_unassigned_detail) == "FORBIDDEN"

    assigned_detail = mirror_api.client.get(f"/api/v1/books/{assigned.id}")
    assert assigned_detail.status_code == 200, assigned_detail.text

    signed = mirror_api.client.post(f"/api/v1/books/{assigned.id}/sign")
    assert signed.status_code == 200, signed.text
    assert signed.json()["approval_state"] == "approved"

    after_decision = mirror_api.client.get(f"/api/v1/books/{assigned.id}")
    assert after_decision.status_code == 403
    assert _error_code(after_decision) == "FORBIDDEN"

    received_after_decision = mirror_api.client.get(
        "/api/v1/books/approval-log",
        params={"scope": "received"},
    )
    assert received_after_decision.status_code == 200, received_after_decision.text
    assert received_after_decision.json()["items"] == []


def test_old_version_pending_assignment_does_not_bypass_record_type_denial(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "REV", name_en="Revisions")
    manager = _user(
        mirror_api.db,
        role="manager",
        email="old-revision-manager@test.ae",
    )
    revised = _book(
        mirror_api.db,
        ref_number="REV-OLD-ASSIGNMENT",
        category_id="REV",
        service_id="General Book",
        state="pending",
        user_id=manager.id,
        submitted_by_user_id=manager.id,
    )
    _assign_pending_step(mirror_api.db, revised, manager)
    mirror_api.db.add(
        BookVersion(
            book_id=revised.id,
            version_no=2,
            template_id="General Book",
            fields={},
            status="pending",
            created_by_user_id=mirror_api.actor.id,
        )
    )
    mirror_api.db.commit()

    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.service.General Book",
        "deny",
        actor=mirror_api.actor,
    )
    mirror_api.as_user(manager)

    awaiting = mirror_api.client.get("/api/v1/books/awaiting")
    assert awaiting.status_code == 200, awaiting.text
    assert revised.ref_number not in {item["ref_number"] for item in awaiting.json()}

    detail = mirror_api.client.get(f"/api/v1/books/{revised.id}")
    assert detail.status_code == 403
    assert _error_code(detail) == "RECORD_TYPE_FORBIDDEN"


def test_dashboard_book_totals_hide_denied_record_types(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "DASH", name_en="Dashboard")
    _book(
        mirror_api.db,
        ref_number="DASH-HIDDEN",
        category_id="DASH",
        service_id="General Book",
    )
    _book(
        mirror_api.db,
        ref_number="DASH-VISIBLE",
        category_id="DASH",
        service_id="Report",
    )
    operator = _user(
        mirror_api.db,
        role="operator",
        email="dashboard-op@test.ae",
    )
    perm_service.set_user_override(
        mirror_api.db,
        operator.id,
        "books.service.General Book",
        "deny",
        actor=mirror_api.actor,
    )
    mirror_api.as_user(operator)

    response = mirror_api.client.get("/api/v1/dashboard/summary")
    assert response.status_code == 200, response.text
    assert response.json()["totals"]["book_draft_count"] == 1


def test_dynamic_once_grant_reverts_to_deny_after_expiry_and_sweep(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    operator = _user(
        mirror_api.db,
        role="operator",
        email="once-expiry-op@test.ae",
    )
    admin = mirror_api.actor
    capability = "books.service.General Book"
    perm_service.set_user_override(
        mirror_api.db,
        operator.id,
        capability,
        "deny",
        actor=admin,
    )
    monkeypatch.setattr(
        "app.services.admin_notify.notify_admins_new_request",
        lambda *_args, **_kwargs: None,
    )

    mirror_api.as_user(operator)
    created = mirror_api.client.post(
        "/api/v1/permissions/requests",
        json={"capability": capability},
    )
    assert created.status_code == 201, created.text

    mirror_api.as_user(admin)
    decided = mirror_api.client.post(
        f"/api/v1/permissions/requests/{created.json()['id']}/decide",
        json={"decision": "once", "window": "2h"},
    )
    assert decided.status_code == 200, decided.text
    assert capability in perm_service.effective_caps(mirror_api.db, operator)

    row = mirror_api.db.get(UserPermission, (operator.id, capability))
    assert row is not None
    row.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=1)
    mirror_api.db.commit()
    operator._effective_caps_cache = None

    assert capability not in perm_service.effective_caps(mirror_api.db, operator)
    assert perm_service.sweep_expired_grants(mirror_api.db) == 1
    mirror_api.db.expire(row)
    assert row.effect == "deny"
    assert row.expires_at is None
    operator._effective_caps_cache = None
    assert capability not in perm_service.effective_caps(mirror_api.db, operator)


def test_expired_dynamic_once_grant_can_be_requested_and_approved_again(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    operator = _user(
        mirror_api.db,
        role="operator",
        email="once-rerequest-op@test.ae",
    )
    admin = mirror_api.actor
    capability = "books.service.General Book"
    perm_service.set_user_override(
        mirror_api.db,
        operator.id,
        capability,
        "deny",
        actor=admin,
    )
    monkeypatch.setattr(
        "app.services.admin_notify.notify_admins_new_request",
        lambda *_args, **_kwargs: None,
    )

    mirror_api.as_user(operator)
    first = mirror_api.client.post(
        "/api/v1/permissions/requests",
        json={"capability": capability},
    )
    assert first.status_code == 201, first.text
    mirror_api.as_user(admin)
    first_decision = mirror_api.client.post(
        f"/api/v1/permissions/requests/{first.json()['id']}/decide",
        json={"decision": "once", "window": "2h"},
    )
    assert first_decision.status_code == 200, first_decision.text

    row = mirror_api.db.get(UserPermission, (operator.id, capability))
    assert row is not None
    row.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=1)
    mirror_api.db.commit()
    operator._effective_caps_cache = None
    assert capability not in perm_service.effective_caps(mirror_api.db, operator)

    mirror_api.as_user(operator)
    second = mirror_api.client.post(
        "/api/v1/permissions/requests",
        json={"capability": capability},
    )
    assert second.status_code == 201, second.text
    mirror_api.as_user(admin)
    second_decision = mirror_api.client.post(
        f"/api/v1/permissions/requests/{second.json()['id']}/decide",
        json={"decision": "once", "window": "week"},
    )
    assert second_decision.status_code == 200, second_decision.text
    assert capability in perm_service.effective_caps(mirror_api.db, operator)


def test_bulk_replaces_unswept_expired_dynamic_grant(
    db_session: Session,
) -> None:
    operator = _user(db_session, role="operator", email="bulk-expired-op@test.ae")
    admin = _user(db_session, role="admin", email="bulk-expired-admin@test.ae")
    capability = "books.service.General Book"
    first_expiry = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=2)
    perm_service.set_user_override(
        db_session,
        operator.id,
        capability,
        "deny",
        actor=admin,
    )
    perm_service.set_user_override(
        db_session,
        operator.id,
        capability,
        "grant",
        actor=admin,
        expires_at=first_expiry,
    )
    row = db_session.get(UserPermission, (operator.id, capability))
    assert row is not None
    row.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=1)
    db_session.commit()
    operator._effective_caps_cache = None
    assert capability not in perm_service.effective_caps(db_session, operator)

    second_expiry = datetime.now(UTC).replace(tzinfo=None) + timedelta(days=7)
    perm_service.set_user_overrides(
        db_session,
        operator.id,
        [(capability, "grant", second_expiry)],
        actor=admin,
    )

    db_session.expire(row)
    assert row.effect == "grant"
    assert row.expires_at == second_expiry
    operator._effective_caps_cache = None
    assert capability in perm_service.effective_caps(db_session, operator)


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/api/v1/documents/generate",
            {"template_id": "Salary Transfer Request", "fields": {}},
        ),
        (
            "/api/v1/documents/inmate-violations/approved-imports",
            {
                "token": "0" * 32,
                "report_date": "2026-08-28",
                "inmate_names": ["Test Inmate"],
                "subject": "Approved violation",
            },
        ),
        ("/api/v1/books/word-sessions", {"subject": "No view"}),
        (
            "/api/v1/books",
            {"category_id": "OPEN", "subject": "No view", "direction": "incoming"},
        ),
    ],
)
def test_record_creating_routes_require_books_view(
    mirror_api: ApiHarness,
    path: str,
    payload: dict[str, object],
) -> None:
    _category(mirror_api.db, "OPEN", name_en="Open")
    manager = _user(
        mirror_api.db,
        role="manager",
        email=f"no-view-{path.replace('/', '-')}@test.ae",
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.view",
        "deny",
        actor=mirror_api.actor,
    )
    mirror_api.as_user(manager)

    response = mirror_api.client.post(path, json=payload)

    assert response.status_code == 403, response.text
    assert _error_code(response) == "FORBIDDEN"


def test_direct_book_creation_checks_other_not_subject_guess(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "OPEN", name_en="Open")
    manager = _user(
        mirror_api.db,
        role="manager",
        email="direct-other@test.ae",
    )
    admin = mirror_api.actor
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.service.other",
        "deny",
        actor=admin,
    )
    mirror_api.as_user(manager)

    denied_other = mirror_api.client.post(
        "/api/v1/books",
        json={
            "category_id": "OPEN",
            "subject": "Report — subject must not classify a versioned direct book",
            "direction": "incoming",
        },
    )
    assert denied_other.status_code == 403
    assert _error_code(denied_other) == "RECORD_TYPE_FORBIDDEN"

    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.service.other",
        None,
        actor=admin,
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.service.Report",
        "deny",
        actor=admin,
    )

    allowed_other = mirror_api.client.post(
        "/api/v1/books",
        json={
            "category_id": "OPEN",
            "subject": "Report — denied subject guess is irrelevant",
            "direction": "incoming",
        },
    )
    assert allowed_other.status_code == 201, allowed_other.text


def test_word_session_creation_checks_gs_category(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "GS", name_en="General Services")
    manager = _user(
        mirror_api.db,
        role="manager",
        email="word-category@test.ae",
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.category.GS",
        "deny",
        actor=mirror_api.actor,
    )
    mirror_api.as_user(manager)

    response = mirror_api.client.post(
        "/api/v1/books/word-sessions",
        json={"subject": "Denied GS"},
    )

    assert response.status_code == 403, response.text
    assert _error_code(response) == "RECORD_TYPE_FORBIDDEN"


def test_generate_checks_target_category_and_companion_as_other(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "HR", name_en="Human Resources")
    manager = _user(
        mirror_api.db,
        role="manager",
        email="generate-types@test.ae",
    )
    admin = mirror_api.actor
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.category.HR",
        "deny",
        actor=admin,
    )
    mirror_api.as_user(manager)

    denied_category = mirror_api.client.post(
        "/api/v1/documents/generate",
        json={"template_id": "Salary Transfer Request", "fields": {}},
    )
    assert denied_category.status_code == 403
    assert _error_code(denied_category) == "RECORD_TYPE_FORBIDDEN"

    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.category.HR",
        None,
        actor=admin,
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.service.other",
        "deny",
        actor=admin,
    )

    companion_as_other = mirror_api.client.post(
        "/api/v1/documents/generate",
        json={"template_id": "Leave Undertaking", "fields": {}},
    )
    assert companion_as_other.status_code == 403
    assert _error_code(companion_as_other) == "RECORD_TYPE_FORBIDDEN"


@pytest.mark.parametrize(
    "denied_capability",
    ["books.category.NAT", "books.service.Inmate Conduct Violations"],
)
def test_approved_violation_commit_checks_record_type(
    mirror_api: ApiHarness,
    denied_capability: str,
) -> None:
    _category(mirror_api.db, "NAT", name_en="Naturalization")
    manager = _user(
        mirror_api.db,
        role="manager",
        email=f"approved-import-{denied_capability.rsplit('.', 1)[-1]}@test.ae",
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        denied_capability,
        "deny",
        actor=mirror_api.actor,
    )
    mirror_api.as_user(manager)

    response = mirror_api.client.post(
        "/api/v1/documents/inmate-violations/approved-imports",
        json={
            "token": "0" * 32,
            "report_date": "2026-08-28",
            "inmate_names": ["Test Inmate"],
            "subject": "Approved violation",
        },
    )

    assert response.status_code == 403, response.text
    assert _error_code(response) == "RECORD_TYPE_FORBIDDEN"


def test_denied_record_type_blocks_id_addressed_book_mutations_and_files(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "OPS", name_en="Operations")
    hidden = _book(
        mirror_api.db,
        ref_number="OPS-HIDDEN",
        category_id="OPS",
        service_id="General Book",
    )
    hidden.attachment_paths = ["book_attachments/hidden.pdf"]
    mirror_api.db.commit()
    version = mirror_api.db.scalar(select(BookVersion).where(BookVersion.book_id == hidden.id))
    assert version is not None
    manager = _user(
        mirror_api.db,
        role="manager",
        email="id-guard@test.ae",
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.service.General Book",
        "deny",
        actor=mirror_api.actor,
    )
    mirror_api.as_user(manager)

    responses = [
        mirror_api.client.patch(
            f"/api/v1/books/{hidden.id}",
            json={"subject": "Forbidden update"},
        ),
        mirror_api.client.get(f"/api/v1/books/{hidden.id}/attachments/0"),
        mirror_api.client.get(f"/api/v1/books/{hidden.id}/versions/{version.id}/fields"),
    ]

    for response in responses:
        assert response.status_code == 403, response.text
        assert _error_code(response) == "RECORD_TYPE_FORBIDDEN"


def test_denied_linked_document_blocks_metadata_and_download(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from app.api.v1 import documents as documents_api

    _category(mirror_api.db, "OPS", name_en="Operations")
    pdf_path = tmp_path / "hidden.pdf"
    pdf_path.write_bytes(b"%PDF-hidden")
    document = Document(
        template_id="General Book",
        ref_number="OPS-DOC",
        pdf_path=pdf_path.name,
        submission_id="hidden-doc",
        role="primary",
    )
    companion_path = tmp_path / "hidden-companion.pdf"
    companion_path.write_bytes(b"%PDF-hidden-companion")
    companion = Document(
        template_id="Leave Undertaking",
        ref_number="OPS-DOC",
        pdf_path=companion_path.name,
        submission_id=document.submission_id,
        role="companion",
    )
    mirror_api.db.add(companion)
    mirror_api.db.add(document)
    mirror_api.db.flush()
    hidden = _book(
        mirror_api.db,
        ref_number="OPS-DOC",
        category_id="OPS",
        service_id="General Book",
    )
    version = mirror_api.db.scalar(select(BookVersion).where(BookVersion.book_id == hidden.id))
    assert version is not None
    version.document_id = document.id
    mirror_api.db.commit()
    monkeypatch.setattr(
        documents_api,
        "get_settings",
        lambda: SimpleNamespace(data_dir=tmp_path),
    )
    manager = _user(
        mirror_api.db,
        role="manager",
        email="document-guard@test.ae",
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.category.OPS",
        "deny",
        actor=mirror_api.actor,
    )
    mirror_api.as_user(manager)

    responses = [
        mirror_api.client.get(f"/api/v1/documents/{document.id}"),
        mirror_api.client.get(f"/api/v1/documents/{document.id}/download"),
        mirror_api.client.get(f"/api/v1/documents/{companion.id}"),
        mirror_api.client.get(f"/api/v1/documents/{companion.id}/download"),
    ]

    for response in responses:
        assert response.status_code == 403, response.text
        assert _error_code(response) == "RECORD_TYPE_FORBIDDEN"


def test_pending_assignees_can_read_linked_documents_until_their_decision(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from app.api.v1 import documents as documents_api

    _category(mirror_api.db, "REVIEW", name_en="Assigned reviews")
    unsigned_pdf = tmp_path / "assigned-unsigned.pdf"
    unsigned_pdf.write_bytes(b"%PDF-unsigned")
    locked_pdf = tmp_path / "assigned-locked.pdf"
    locked_pdf.write_bytes(b"%PDF-locked")

    def linked_document(
        *,
        ref_number: str,
        pdf_path: Path,
        signed_path: Path | None = None,
    ) -> tuple[Document, Book, BookVersion]:
        document = Document(
            template_id="General Book",
            ref_number=ref_number,
            pdf_path=pdf_path.name,
            submission_id=ref_number.lower(),
            role="primary",
        )
        mirror_api.db.add(document)
        mirror_api.db.flush()
        book = _book(
            mirror_api.db,
            ref_number=ref_number,
            category_id="REVIEW",
            service_id="General Book",
            state="pending",
        )
        version = mirror_api.db.scalar(select(BookVersion).where(BookVersion.book_id == book.id))
        assert version is not None
        version.document_id = document.id
        version.signed_pdf_path = signed_path.name if signed_path is not None else None
        if signed_path is not None:
            version.status = "approved"
        mirror_api.db.commit()
        return document, book, version

    unsigned_document, signer_book, _ = linked_document(
        ref_number="REVIEW-SIGN",
        pdf_path=unsigned_pdf,
    )
    locked_document, reviewer_book, reviewer_version = linked_document(
        ref_number="REVIEW-ADVISE",
        pdf_path=unsigned_pdf,
        signed_path=locked_pdf,
    )
    companion_pdf = tmp_path / "assigned-companion.pdf"
    companion_pdf.write_bytes(b"%PDF-companion")
    companion_document = Document(
        template_id="Leave Undertaking",
        ref_number=unsigned_document.ref_number,
        pdf_path=companion_pdf.name,
        submission_id=unsigned_document.submission_id,
        role="companion",
    )
    mirror_api.db.add(companion_document)
    mirror_api.db.commit()
    assignee = _user(
        mirror_api.db,
        role="manager",
        email="linked-document-assignee@test.ae",
    )
    _assign_pending_step(mirror_api.db, signer_book, assignee)
    mirror_api.db.add(
        BookApprovalStep(
            book_id=reviewer_book.id,
            version_id=reviewer_version.id,
            step_order=0,
            stage_label="Review",
            assignee_user_id=assignee.id,
            state="pending",
            kind="reviewer",
        )
    )
    mirror_api.db.commit()
    perm_service.set_user_overrides(
        mirror_api.db,
        assignee.id,
        [
            ("books.view", "deny", None),
            ("documents.generate", "deny", None),
            ("books.category.REVIEW", "deny", None),
        ],
        actor=mirror_api.actor,
    )
    monkeypatch.setattr(
        documents_api,
        "get_settings",
        lambda: SimpleNamespace(data_dir=tmp_path),
    )
    mirror_api.as_user(assignee)

    unsigned_metadata = mirror_api.client.get(f"/api/v1/documents/{unsigned_document.id}")
    unsigned_download = mirror_api.client.get(f"/api/v1/documents/{unsigned_document.id}/download")
    locked_download = mirror_api.client.get(f"/api/v1/documents/{locked_document.id}/download")
    companion_metadata = mirror_api.client.get(f"/api/v1/documents/{companion_document.id}")
    companion_download = mirror_api.client.get(
        f"/api/v1/documents/{companion_document.id}/download"
    )

    assert unsigned_metadata.status_code == 200, unsigned_metadata.text
    assert unsigned_metadata.json()["id"] == unsigned_document.id
    assert unsigned_download.status_code == 200, unsigned_download.text
    assert unsigned_download.content == b"%PDF-unsigned"
    assert locked_download.status_code == 200, locked_download.text
    assert locked_download.content == b"%PDF-locked"
    assert companion_metadata.status_code == 200, companion_metadata.text
    assert companion_metadata.json()["id"] == companion_document.id
    assert companion_download.status_code == 200, companion_download.text
    assert companion_download.content == b"%PDF-companion"

    for step in mirror_api.db.scalars(
        select(BookApprovalStep).where(
            BookApprovalStep.book_id.in_([signer_book.id, reviewer_book.id])
        )
    ):
        step.state = "approved"
        step.decided_at = datetime.now()
    mirror_api.db.commit()

    responses_after_decision = [
        mirror_api.client.get(f"/api/v1/documents/{unsigned_document.id}"),
        mirror_api.client.get(f"/api/v1/documents/{locked_document.id}/download"),
        mirror_api.client.get(f"/api/v1/documents/{companion_document.id}"),
        mirror_api.client.get(f"/api/v1/documents/{companion_document.id}/download"),
    ]
    for response in responses_after_decision:
        assert response.status_code == 403, response.text
        assert _error_code(response) == "FORBIDDEN"


def test_dashboard_document_stats_exclude_denied_service_and_category(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "OPEN", name_en="Open")
    _category(mirror_api.db, "HIDDEN", name_en="Hidden")

    def add_document(
        ref: str,
        *,
        category_id: str,
        service_id: str,
    ) -> Document:
        document = Document(
            template_id=service_id,
            ref_number=ref,
            submission_id=ref,
            role="primary",
            created_at=datetime.now(),
        )
        mirror_api.db.add(document)
        mirror_api.db.flush()
        book = _book(
            mirror_api.db,
            ref_number=ref,
            category_id=category_id,
            service_id=service_id,
        )
        version = mirror_api.db.scalar(select(BookVersion).where(BookVersion.book_id == book.id))
        assert version is not None
        version.document_id = document.id
        mirror_api.db.commit()
        return document

    hidden_service = add_document(
        "DOC-HIDDEN-SERVICE",
        category_id="OPEN",
        service_id="General Book",
    )
    hidden_category = add_document(
        "DOC-HIDDEN-CATEGORY",
        category_id="HIDDEN",
        service_id="Report",
    )
    hidden_category_companion = Document(
        template_id="Leave Undertaking",
        ref_number=hidden_category.ref_number,
        submission_id=hidden_category.submission_id,
        role="companion",
        created_at=datetime.now(),
    )
    mirror_api.db.add(hidden_category_companion)
    mirror_api.db.commit()
    visible = add_document(
        "DOC-VISIBLE",
        category_id="OPEN",
        service_id="Report",
    )
    manager = _user(
        mirror_api.db,
        role="manager",
        email="dashboard-docs@test.ae",
    )
    perm_service.set_user_overrides(
        mirror_api.db,
        manager.id,
        [
            ("books.service.General Book", "deny", None),
            ("books.category.HIDDEN", "deny", None),
        ],
        actor=mirror_api.actor,
    )
    mirror_api.as_user(manager)

    response = mirror_api.client.get("/api/v1/dashboard/summary")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["totals"]["forms_this_month"] == 1
    assert [item["id"] for item in payload["recent_documents"]] == [visible.id]
    assert hidden_service.id != visible.id
    assert hidden_category.id != visible.id
    assert hidden_category_companion.id != visible.id


@pytest.mark.parametrize("source", ["record_document", "record_attachment"])
def test_generation_attachment_sources_require_source_book_access_but_allow_assignee(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    source: str,
) -> None:
    from app.api.v1.documents import GenerateAttachmentSpec

    _category(mirror_api.db, "SOURCE", name_en="Source records")
    primary_path = tmp_path / "source-primary.pdf"
    primary_path.write_bytes(b"%PDF-source")
    attachment_path = tmp_path / "source-scan.pdf"
    attachment_path.write_bytes(b"%PDF-scan")
    primary = Document(
        template_id="Report",
        ref_number="SOURCE-DOC",
        pdf_path=primary_path.name,
        submission_id="source-doc",
        role="primary",
    )
    mirror_api.db.add(primary)
    mirror_api.db.flush()
    source_book = _book(
        mirror_api.db,
        ref_number="SOURCE-BOOK",
        category_id="SOURCE",
        service_id="Report",
        state="pending",
    )
    source_version = mirror_api.db.scalar(
        select(BookVersion).where(BookVersion.book_id == source_book.id)
    )
    assert source_version is not None
    source_version.document_id = primary.id
    source_book.attachment_paths = [attachment_path.name]
    mirror_api.db.commit()

    manager = _user(
        mirror_api.db,
        role="manager",
        email=f"{source}-source-guard@test.ae",
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.category.SOURCE",
        "deny",
        actor=mirror_api.actor,
    )
    settings = SimpleNamespace(data_dir=tmp_path)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(book_service, "get_settings", lambda: settings)
    spec = GenerateAttachmentSpec(
        source=source,
        book_id=source_book.id,
        attachment_index=0 if source == "record_attachment" else None,
    )

    with pytest.raises(AppError) as denied:
        document_service._resolve_attachment_sources(
            mirror_api.db,
            [spec],
            record_access_user=manager,
        )
    assert denied.value.code == "RECORD_TYPE_FORBIDDEN"

    _assign_pending_step(mirror_api.db, source_book, manager)
    mirror_api.db.expire_all()
    resolved = document_service._resolve_attachment_sources(
        mirror_api.db,
        [spec],
        record_access_user=manager,
    )
    assert resolved == [
        (
            spec,
            primary_path if source == "record_document" else attachment_path,
        )
    ]


def test_generate_revision_preflights_edit_and_source_row_access(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import documents as documents_api

    _category(mirror_api.db, "GS", name_en="General Services")
    _category(mirror_api.db, "SOURCE", name_en="Source records")
    source_book = _book(
        mirror_api.db,
        ref_number="SOURCE-REVISION",
        category_id="SOURCE",
        service_id="General Book",
    )
    manager = _user(
        mirror_api.db,
        role="manager",
        email="revision-source-guard@test.ae",
    )
    admin = mirror_api.actor
    monkeypatch.setattr(documents_api, "_run_generation", lambda *_args, **_kwargs: None)
    mirror_api.as_user(manager)
    payload = {
        "template_id": "General Book",
        "fields": {},
        "commit": True,
        "revise_of_book_id": source_book.id,
    }

    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.edit",
        "deny",
        actor=admin,
    )
    without_edit = mirror_api.client.post("/api/v1/documents/generate", json=payload)
    assert without_edit.status_code == 403, without_edit.text
    assert _error_code(without_edit) == "FORBIDDEN"

    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.edit",
        None,
        actor=admin,
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.category.SOURCE",
        "deny",
        actor=admin,
    )
    before_versions = len(source_book.versions)
    denied_source = mirror_api.client.post("/api/v1/documents/generate", json=payload)
    assert denied_source.status_code == 403, denied_source.text
    assert _error_code(denied_source) == "RECORD_TYPE_FORBIDDEN"
    mirror_api.db.refresh(source_book)
    assert len(source_book.versions) == before_versions


def test_permit_edit_regenerates_version_without_record_capabilities(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from app.config import Settings

    _category(mirror_api.db, "GS", name_en="General Services")
    monkeypatch.setattr(
        document_service,
        "get_settings",
        lambda: Settings(data_dir=tmp_path / "data"),
    )
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda _path: None)

    manager = _user(
        mirror_api.db,
        role="manager",
        email="permit-regeneration-without-records@test.ae",
    )
    permit = permit_service.create_permit(
        mirror_api.db,
        PermitCreate(
            company="ACME",
            access_areas={
                "al_wathba_1": ["green"],
                "al_wathba_2": [],
                "work_residence": False,
            },
            start_date=datetime.now().date(),
            validity={"value": 2, "unit": "month"},
            people=[
                {
                    "name": "Ali",
                    "uae_id": "784-1",
                    "nationality": "مصر",
                    "role": "Electrician",
                }
            ],
            vehicles=[],
        ),
        actor=manager.email,
    )
    assert permit.book_id is not None
    book = mirror_api.db.get(Book, permit.book_id)
    assert book is not None and len(book.versions) == 1
    book.versions[-1].fields = {}
    mirror_api.db.commit()

    admin = mirror_api.actor
    for capability in ("books.view", "books.edit"):
        perm_service.set_user_override(
            mirror_api.db,
            manager.id,
            capability,
            "deny",
            actor=admin,
        )
    assert perm_service.has_capability(mirror_api.db, manager, "permits.edit")
    assert not perm_service.has_capability(mirror_api.db, manager, "books.view")
    assert not perm_service.has_capability(mirror_api.db, manager, "books.edit")

    mirror_api.as_user(manager)
    response = mirror_api.client.post(
        f"/api/v1/permits/{permit.id}/vehicles",
        json={"plate_no": "A 1"},
    )

    assert response.status_code == 201, response.text
    mirror_api.db.expire(book, ["versions"])
    assert [version.version_no for version in book.versions] == [1, 2]


@pytest.mark.parametrize("source", ["record_document", "record_attachment"])
def test_generate_attachment_source_preflight_uses_assignment_aware_row_guard(
    mirror_api: ApiHarness,
    monkeypatch: pytest.MonkeyPatch,
    source: str,
) -> None:
    from app.api.v1 import documents as documents_api

    _category(mirror_api.db, "GS", name_en="General Services")
    _category(mirror_api.db, "SOURCE", name_en="Source records")
    source_book = _book(
        mirror_api.db,
        ref_number=f"SOURCE-{source}",
        category_id="SOURCE",
        service_id="Report",
        state="pending",
    )
    manager = _user(
        mirror_api.db,
        role="manager",
        email=f"{source}-route-guard@test.ae",
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.category.SOURCE",
        "deny",
        actor=mirror_api.actor,
    )
    monkeypatch.setattr(documents_api, "_run_generation", lambda *_args, **_kwargs: None)
    mirror_api.as_user(manager)
    payload = {
        "template_id": "General Book",
        "fields": {},
        "commit": True,
        "attachments": [
            {
                "source": source,
                "book_id": source_book.id,
                "attachment_index": 0 if source == "record_attachment" else None,
            }
        ],
    }

    denied = mirror_api.client.post("/api/v1/documents/generate", json=payload)
    assert denied.status_code == 403, denied.text
    assert _error_code(denied) == "RECORD_TYPE_FORBIDDEN"

    _assign_pending_step(mirror_api.db, source_book, manager)
    mirror_api.db.expire_all()
    allowed = mirror_api.client.post("/api/v1/documents/generate", json=payload)
    assert allowed.status_code == 202, allowed.text


def test_scanback_requires_view_and_edit_for_endpoint_and_push(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "SCAN", name_en="Scan back")
    manager = _user(
        mirror_api.db,
        role="manager",
        email="scanback-view-gate@test.ae",
    )
    stranded = _book(
        mirror_api.db,
        ref_number="SCAN-NO-VIEW",
        category_id="SCAN",
        service_id="Report",
        state="awaiting_scan",
        user_id=manager.id,
        submitted_by_user_id=manager.id,
        created_at=datetime.now() - timedelta(hours=48),
    )
    perm_service.set_user_override(
        mirror_api.db,
        manager.id,
        "books.view",
        "deny",
        actor=mirror_api.actor,
    )
    mirror_api.as_user(manager)

    response = mirror_api.client.get(
        "/api/v1/books/awaiting-scan",
        params={"scope": "mine"},
    )
    assert response.status_code == 403, response.text
    assert _error_code(response) == "FORBIDDEN"
    assert all(
        item.kind != "scanback" or item.item_key != f"book:{stranded.id}"
        for item in notification_service.actionable_items(mirror_api.db, manager)
    )


def test_expiry_routes_require_expiry_view_independent_of_employees_view(
    mirror_api: ApiHarness,
) -> None:
    operator = _user(
        mirror_api.db,
        role="operator",
        email="expiry-gate@test.ae",
    )
    admin = mirror_api.actor
    perm_service.set_user_override(
        mirror_api.db,
        operator.id,
        "expiry.view",
        "deny",
        actor=admin,
    )
    mirror_api.as_user(operator)

    for path in ("/api/v1/expiry", "/api/v1/expiry/summary"):
        denied = mirror_api.client.get(path)
        assert denied.status_code == 403, denied.text
        assert _error_code(denied) == "FORBIDDEN"

    perm_service.set_user_override(
        mirror_api.db,
        operator.id,
        "expiry.view",
        None,
        actor=admin,
    )
    perm_service.set_user_override(
        mirror_api.db,
        operator.id,
        "employees.view",
        "deny",
        actor=admin,
    )

    for path in ("/api/v1/expiry", "/api/v1/expiry/summary"):
        allowed = mirror_api.client.get(path)
        assert allowed.status_code == 200, allowed.text


def test_dynamic_capability_labels_use_category_name_and_bare_service(
    db_session: Session,
) -> None:
    _category(db_session, "OPS", name_en="Operations")

    assert perm_service.dynamic_capability_label(db_session, "books.category.OPS") == "Operations"
    assert (
        perm_service.dynamic_capability_label(
            db_session,
            "books.service.General Book",
        )
        == "General Book"
    )

    assert (
        perm_service.dynamic_capability_label(
            db_session,
            "books.servicerecords.General Book",
        )
        == "Records: General Book"
    )
