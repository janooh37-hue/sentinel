from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

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
    RolePermission,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.schemas.book import BookCreate
from app.services import book_service, notification_service, perm_service


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
    category_cap = f"books.category.{category.id}"
    expected_dynamic = service_caps | {category_cap}

    assert perm_service.dynamic_capability_ids(db_session) == expected_dynamic
    assert expected_dynamic <= perm_service.effective_caps(db_session, operator)
    assert expected_dynamic <= perm_service.effective_caps(db_session, admin)
    assert perm_service.denied_record_types(db_session, admin) == (set(), set())
    assert expected_dynamic.isdisjoint(permissions.ALL_CAPABILITIES)

    seeded = set(db_session.scalars(select(RolePermission.capability)).all())
    assert expected_dynamic.isdisjoint(seeded)

    denied_cap = "books.service.General Book"
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
    assert created.json()["capability_label"] == capability

    mirror_api.as_user(admin)
    decided = mirror_api.client.post(
        f"/api/v1/permissions/requests/{created.json()['id']}/decide",
        json={"decision": "permanent"},
    )
    assert decided.status_code == 200, decided.text
    assert capability in perm_service.effective_caps(mirror_api.db, operator)


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
            ("books.service.General Book", "deny", None),
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


def test_api_create_endpoints_reject_denied_types_but_service_flow_remains_open(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "OPEN", name_en="Open")
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

    denied_service = mirror_api.client.post(
        "/api/v1/books",
        json={
            "category_id": "OPEN",
            "subject": "General Book — denied service",
            "direction": "incoming",
        },
    )
    assert denied_service.status_code == 403
    assert _error_code(denied_service) == "RECORD_TYPE_FORBIDDEN"

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


def test_approval_queries_and_notifications_hide_denied_services(
    mirror_api: ApiHarness,
) -> None:
    _category(mirror_api.db, "APP", name_en="Approvals")
    manager = _user(
        mirror_api.db,
        role="manager",
        email="approvals-manager@test.ae",
    )
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
    assert [item["ref_number"] for item in awaiting.json()] == [visible_pending.ref_number]

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
        visible_pending.ref_number,
        visible_decided.ref_number,
    }

    actionable_refs = {
        item.label
        for item in notification_service.actionable_items(mirror_api.db, manager)
        if item.kind in {"approval", "review", "scanback"}
    }
    assert hidden_pending.ref_number not in actionable_refs
    assert hidden_scan.ref_number not in actionable_refs
    assert visible_pending.ref_number in actionable_refs
    assert visible_scan.ref_number in actionable_refs

    counts = notification_service.relevant_counts(
        mirror_api.db,
        manager,
        precomputed_leaves=0,
    )
    assert counts.approvals == 1


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
