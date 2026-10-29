"""Consumer-visible access explanations, real guard parity and atomic saves."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_optional_user
from app.db.models import (
    AuditLog,
    Book,
    BookApprovalStep,
    BookCategory,
    BookRecipient,
    BookRevisionAccess,
    BookVersion,
    Employee,
    RolePermission,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.schemas.access import Patch
from app.services import access_decision_service, auth_service, perm_service
from tests.conftest import make_user


def client(db, user):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def setup(db, *, role="operator", status="active"):
    admin = make_user(db, role="admin", email="access-admin@test.ae")
    target = make_user(db, role=role, status=status, email="access-target@test.ae")
    return admin, target, client(db, admin)


def url(target, suffix="effective-access"):
    return f"/api/v1/auth/users/{target.id}/{suffix}"


def check(c, target, kind, id, action, **body):
    return c.post(
        url(target, "check-access"),
        json={"resource": {"kind": kind, "id": id}, "action": action, **body},
    )


def test_snapshot_role_personal_sources_and_legacy_etag_agree(api_db):
    _, target, c = setup(api_db)
    perm_service.set_user_override(api_db, target.id, "books.view", "deny")
    response = c.get(url(target))
    assert response.status_code == 200, response.text
    snapshot = response.json()
    assert response.headers["cache-control"] == "no-store"
    legacy = c.get(url(target, "permissions"))
    assert legacy.headers["etag"] == response.headers["etag"]
    assert (
        legacy.json()["effective"]
        == snapshot["effective"]
        == sorted(perm_service.effective_caps(api_db, target))
    )
    assert "books.view" in snapshot["role_defaults"]
    decision = check(c, target, "capability", "books.view", "view").json()["current"]
    assert decision["authorization"] == "denied"
    sources = {
        reason["source"]["kind"]: reason
        for reason in decision["reasons"]
        if reason["capability"] == "books.view"
    }
    assert sources["role"]["applied"] is False
    assert sources["personal"]["decisive"] is True
    assert sources["personal"]["code"] == "PERSONAL_DENY"


def test_preview_and_check_overlay_never_write_and_save_returns_confirmed_state(api_db):
    _, target, c = setup(api_db)
    before = c.get(url(target)).json()
    items = [{"capability": "books.view", "effect": "deny"}]
    preview = c.post(
        url(target, "effective-access/preview"),
        json={"expected_revision": before["revision"], "items": items},
    )
    assert preview.status_code == 200, preview.text
    assert "books.view" in preview.json()["current"]["effective"]
    assert "books.view" not in preview.json()["proposed"]["effective"]
    hypothetical = check(
        c,
        target,
        "capability",
        "books.view",
        "view",
        proposed=items,
        expected_revision=before["revision"],
    )
    assert hypothetical.json()["current"]["authorization"] == "allowed"
    assert hypothetical.json()["proposed"]["authorization"] == "denied"
    assert perm_service.get_user_overrides(api_db, target.id) == {}
    assert api_db.scalar(select(func.count()).select_from(AuditLog)) == 0
    saved = c.put(
        url(target, "permissions/bulk"),
        headers={"If-Match": before["revision"]},
        json={"items": items},
    )
    assert saved.status_code == 200, saved.text
    assert "books.view" not in saved.json()["effective"]
    refreshed = c.get(url(target))
    assert saved.headers["etag"] == refreshed.headers["etag"]
    audits = api_db.scalars(select(AuditLog)).all()
    assert len(audits) == 1
    assert json.loads(audits[0].payload)["capability"] == "books.view"


@pytest.mark.parametrize("suffix", ["permissions", "permissions/bulk"])
def test_mutations_require_revision_and_reject_stale_token_without_writes(api_db, suffix):
    _, target, c = setup(api_db)
    item = {"capability": "books.view", "effect": "deny"}
    body = item if suffix == "permissions" else {"items": [item]}
    missing = c.put(url(target, suffix), json=body)
    assert missing.status_code == 428
    assert missing.headers["cache-control"] == "no-store"
    revision = c.get(url(target)).json()["revision"]
    perm_service.set_user_override(api_db, target.id, "books.edit", "deny")
    stale = c.put(url(target, suffix), headers={"If-Match": revision}, json=body)
    assert stale.status_code == 412
    assert perm_service.get_user_overrides(api_db, target.id) == {"books.edit": "deny"}
    assert api_db.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_expiry_crossing_rejects_unchanged_stored_rows(api_db, monkeypatch):
    _, target, c = setup(api_db)
    now = datetime.now(UTC)
    expiry = now.replace(tzinfo=None) + timedelta(hours=1)
    perm_service.set_user_override(api_db, target.id, "books.view", "grant", expires_at=expiry)
    current = c.get(url(target)).json()
    assert current["valid_until"] is not None

    class AfterExpiry(datetime):
        @classmethod
        def now(cls, tz=None):
            value = now + timedelta(hours=2)
            return value if tz else value.replace(tzinfo=None)

    monkeypatch.setattr(perm_service, "datetime", AfterExpiry)
    response = c.put(
        url(target, "permissions/bulk"),
        headers={"If-Match": current["revision"]},
        json={"items": [{"capability": "ledger.edit", "effect": "deny"}]},
    )
    assert response.status_code == 412
    after = c.get(url(target)).json()
    assert after["revision"] != current["revision"]
    assert after["overrides"][0]["state"] == "expired"
    assert after["valid_until"] is None
    assert "books.view" not in after["effective"]
    assert api_db.get(UserPermission, (target.id, "ledger.edit")) is None


def test_role_row_change_invalidates_revision(api_db):
    _, target, c = setup(api_db)
    revision = c.get(url(target)).json()["revision"]
    api_db.add(RolePermission(role=target.role, capability="messages.templates"))
    api_db.commit()
    response = c.post(
        url(target, "effective-access/preview"),
        json={
            "expected_revision": revision,
            "items": [{"capability": "books.view", "effect": "deny"}],
        },
    )
    assert response.status_code == 412


def test_two_sqlite_writers_with_same_token_exactly_one_wins(api_db):
    admin, target, _ = setup(api_db)
    revision = access_decision_service.snapshot(api_db, target, admin).revision
    barrier = Barrier(2)
    engine = api_db.get_bind()
    actor_id, target_id = admin.id, target.id
    api_db.rollback()

    def writer(capability):
        with Session(engine, autoflush=False, expire_on_commit=False) as db:
            actor = db.get(User, actor_id)
            barrier.wait()
            try:
                access_decision_service.save(
                    db, target_id, actor, revision, [Patch(capability=capability, effect="deny")]
                )
                return 200
            except Exception as error:
                return getattr(error, "http_status", type(error).__name__)

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(writer, ("books.view", "books.edit")))
    assert sorted(outcomes) == [200, 412]
    api_db.expire_all()
    assert len(perm_service.get_user_overrides(api_db, target_id)) == 1
    assert api_db.scalar(select(func.count()).select_from(AuditLog)) == 1


def test_audit_failure_rolls_back_every_override_and_audit(api_db, monkeypatch):
    admin, target, _ = setup(api_db)
    revision = access_decision_service.snapshot(api_db, target, admin).revision
    original = auth_service.audit_permission_change
    calls = 0

    def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("audit failed")
        return original(*args, **kwargs)

    monkeypatch.setattr(auth_service, "audit_permission_change", fail_second)
    with pytest.raises(RuntimeError, match="audit failed"):
        access_decision_service.save(
            api_db,
            target.id,
            admin,
            revision,
            [
                Patch(capability="books.view", effect="deny"),
                Patch(capability="books.edit", effect="deny"),
            ],
        )
    assert perm_service.get_user_overrides(api_db, target.id) == {}
    assert api_db.scalar(select(func.count()).select_from(AuditLog)) == 0


@pytest.mark.parametrize(
    "role,status,capability,effect,expected",
    [
        ("admin", "active", "books.view", "deny", 400),
        ("operator", "disabled", "books.view", "deny", 400),
        ("inmate_reporter", "active", "ledger.view", "grant", 403),
        ("operator", "active", "users.manage", "grant", 400),
        ("operator", "active", "not.real", "grant", 400),
    ],
)
def test_preview_and_save_share_target_and_patch_restrictions(
    api_db, role, status, capability, effect, expected
):
    _, target, c = setup(api_db, role=role, status=status)
    revision = c.get(url(target)).json()["revision"]
    items = [{"capability": capability, "effect": effect}]
    preview = c.post(
        url(target, "effective-access/preview"),
        json={"expected_revision": revision, "items": items},
    )
    save = c.put(
        url(target, "permissions/bulk"), headers={"If-Match": revision}, json={"items": items}
    )
    assert preview.status_code == save.status_code == expected
    assert perm_service.get_user_overrides(api_db, target.id) == {}


@pytest.mark.parametrize(
    "effect,expiry",
    [
        ("deny", "2099-01-01T00:00:00Z"),
        ("grant", "2000-01-01T00:00:00Z"),
        (None, "2099-01-01T00:00:00Z"),
    ],
)
def test_invalid_expiry_refuses_preview_and_save(api_db, effect, expiry):
    _, target, c = setup(api_db)
    revision = c.get(url(target)).json()["revision"]
    items = [{"capability": "books.view", "effect": effect, "expires_at": expiry}]
    assert (
        c.post(
            url(target, "effective-access/preview"),
            json={"expected_revision": revision, "items": items},
        ).status_code
        == 422
    )
    assert (
        c.put(
            url(target, "permissions/bulk"), headers={"If-Match": revision}, json={"items": items}
        ).status_code
        == 422
    )


def test_disabled_account_reports_configured_but_unusable_access(api_db):
    _, target, c = setup(api_db, status="disabled")
    response = check(c, target, "capability", "books.view", "view")
    assert response.status_code == 200
    current = response.json()["current"]
    assert current["authorization"] == "allowed"
    assert current["executable_now"] is False
    assert current["configurable"] is False
    assert any(reason["code"] == "ACCOUNT_INELIGIBLE" for reason in current["reasons"])


def test_message_template_deny_preserves_read_but_real_write_denies(api_db):
    _, target, c = setup(api_db)
    perm_service.set_user_override(api_db, target.id, "messages.templates", "deny")
    read = check(c, target, "notification_template", "violation", "view")
    edit = check(c, target, "notification_template", "violation", "edit")
    reset = check(c, target, "notification_template", "violation", "reset")
    assert read.json()["current"]["authorization"] == "allowed"
    assert read.json()["current"]["setting_capabilities"] == []
    assert (
        edit.json()["current"]["authorization"]
        == reset.json()["current"]["authorization"]
        == "denied"
    )
    assert edit.json()["current"]["setting_capabilities"] == ["messages.templates"]
    target_client = client(api_db, target)
    assert target_client.get("/api/v1/notify/templates").status_code == 200
    assert (
        target_client.post(
            "/api/v1/notify/templates/violation/render",
            json={"ar": "مرحبا {name}", "en": "Hello {name}"},
        ).status_code
        == 200
    )
    assert (
        target_client.put(
            "/api/v1/notify/templates/violation", json={"ar": "مرحبا", "en": "Hello"}
        ).status_code
        == 403
    )


def test_service_create_and_browse_are_independent_and_have_true_prerequisites(api_db):
    _, target, c = setup(api_db)
    api_db.add(BookCategory(id="HR", prefix="HR"))
    api_db.commit()
    service = "Leave Application Form"
    perm_service.set_user_override(api_db, target.id, f"books.servicerecords.{service}", "deny")
    create = check(c, target, "service", service, "create", context={"grade": "unclassified"})
    browse = check(c, target, "service", service, "read")
    assert create.status_code == 200, create.text
    assert create.json()["current"]["authorization"] == "allowed"
    assert browse.json()["current"]["authorization"] == "denied"
    assert "DIRECT_RECIPIENT_REVIEWER_READ_RETAINED" in [
        reason["code"] for reason in browse.json()["current"]["reasons"]
    ]
    perm_service.set_user_override(api_db, target.id, "documents.generate", "deny")
    blocked = check(c, target, "service", service, "create", context={"grade": "unclassified"})
    assert blocked.json()["current"]["authorization"] == "denied"
    assert any(
        reason["capability"] == "documents.generate"
        for reason in blocked.json()["current"]["reasons"]
    )
    target_client = client(api_db, target)
    assert (
        target_client.post(
            "/api/v1/documents/generate", json={"template_id": service, "fields": {}}
        ).status_code
        == 403
    )


def test_unknown_and_unsupported_checks_rejected_before_admin_bypass(api_db):
    admin, target, c = setup(api_db)
    for kind, identifier, action in [
        ("capability", "invented", "view"),
        ("capability", "books.view", "delete"),
        ("service", "invented", "create"),
        ("notification_template", "invented", "edit"),
        ("notification_template", "violation", "send"),
    ]:
        response = check(c, admin, kind, identifier, action)
        assert response.status_code == 422, response.text
        assert response.headers["cache-control"] == "no-store"
    assert check(c, target, "book", "999999", "read").status_code == 404
    assert c.get("/api/v1/auth/users/999999/effective-access").status_code == 404
    assert client(api_db, target).get(url(admin)).status_code == 403


def test_exact_record_direct_recipient_exception_and_non_disclosing_404(api_db):
    admin, target, c = setup(api_db)
    api_db.add(BookCategory(id="HR", prefix="HR"))
    api_db.flush()
    book = Book(
        category_id="HR", ref_number="HR-ACCESS", approval_state="none", created_by_user_id=admin.id
    )
    api_db.add(book)
    api_db.flush()
    api_db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            template_id="Leave Application Form",
            status="draft",
            fields={},
        )
    )
    api_db.add(
        BookRecipient(book_id=book.id, user_id=target.id, sent_by_user_id=admin.id, purpose="info")
    )
    api_db.commit()
    perm_service.set_user_override(
        api_db, target.id, "books.servicerecords.Leave Application Form", "deny"
    )
    response = check(c, target, "book", str(book.id), "read")
    assert response.status_code == 200, response.text
    current = response.json()["current"]
    assert current["authorization"] == "allowed"
    assert current["reason_tree"]["op"] == "any"
    assert any(reason["code"] == "RECORD_READ_DIRECT_RECIPIENT" for reason in current["reasons"])
    assert client(api_db, target).get(f"/api/v1/books/{book.id}").status_code == 200
    recipient = api_db.scalar(select(BookRecipient).where(BookRecipient.book_id == book.id))
    api_db.delete(recipient)
    api_db.commit()
    assert check(c, target, "book", str(book.id), "read").status_code == 404


def test_account_register_projects_linked_arabic_identity(api_db):
    _, target, c = setup(api_db)
    employee = Employee(id="ACCESS-AR", name_en="Linked Name", name_ar="اسم مرتبط")
    api_db.add(employee)
    api_db.flush()
    target.employee_id = employee.id
    api_db.commit()
    rows = c.get("/api/v1/auth/users").json()
    projected = next(row for row in rows if row["id"] == target.id)
    assert projected["name_ar"] == employee.name_ar
    assert projected["name_en"] == employee.name_en


@pytest.mark.parametrize(
    "kind,identifier,capability,read_path,read_allowed",
    [
        ("email_template", "absence:absent", "messages.templates", "/email/draft-templates", True),
        ("word_template", "library", "books.templates", "/books/word-templates", False),
        ("editor_template", "library", "editor_templates.manage", "/editor-templates", False),
    ],
)
def test_template_family_check_matches_actual_read_gate(
    api_db, kind, identifier, capability, read_path, read_allowed
):
    _, target, c = setup(api_db)
    perm_service.set_user_override(api_db, target.id, capability, "deny")
    if kind == "word_template":
        perm_service.set_user_override(api_db, target.id, "books.edit", "deny")
    response = check(c, target, kind, identifier, "view")
    assert response.status_code == 200, response.text
    assert response.json()["current"]["authorization"] == ("allowed" if read_allowed else "denied")
    assert client(api_db, target).get("/api/v1" + read_path).status_code == (
        200 if read_allowed else 403
    )


def test_reset_removes_override_instead_of_denial_and_self_preview_is_locked(api_db):
    admin, target, c = setup(api_db)
    perm_service.set_user_override(api_db, target.id, "books.view", "deny")
    revision = c.get(url(target)).json()["revision"]
    items = [{"capability": "books.view", "effect": None}]
    preview = c.post(
        url(target, "effective-access/preview"),
        json={"expected_revision": revision, "items": items},
    )
    assert preview.status_code == 200, preview.text
    assert "books.view" in preview.json()["proposed"]["effective"]
    saved = c.put(
        url(target, "permissions/bulk"), headers={"If-Match": revision}, json={"items": items}
    )
    assert saved.status_code == 200, saved.text
    assert "books.view" not in saved.json()["overrides"]
    self_revision = c.get(url(admin)).json()["revision"]
    assert (
        c.post(
            url(admin, "effective-access/preview"),
            json={"expected_revision": self_revision, "items": items},
        ).status_code
        == 400
    )


def test_expired_opt_in_grant_and_post_sweep_deny_are_explained_distinctly(api_db):
    from app.core.permissions import OPT_IN_SERVICE_IDS

    _, target, c = setup(api_db)
    capability = f"books.service.{sorted(OPT_IN_SERVICE_IDS)[0]}"
    api_db.add(
        UserPermission(
            user_id=target.id,
            capability=capability,
            effect="grant",
            expires_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1),
        )
    )
    api_db.commit()
    before = c.get(url(target)).json()
    assert capability not in before["effective"]
    assert before["overrides"][0]["state"] == "expired"
    assert before["overrides"][0]["effect"] == "grant"
    assert perm_service.sweep_expired_grants(api_db) == 1
    after = c.get(url(target)).json()
    assert after["overrides"][0]["effect"] == "deny"
    assert after["overrides"][0]["state"] == "active"
    assert before["revision"] != after["revision"]


def test_pending_record_metadata_edit_and_next_revision_have_different_gates(api_db):
    _, target, c = setup(api_db, role="manager")
    api_db.add(BookCategory(id="HR", prefix="HR"))
    api_db.flush()
    book = Book(
        category_id="HR",
        ref_number="HR-WORKFLOW",
        approval_state="pending",
        created_by_user_id=target.id,
    )
    api_db.add(book)
    api_db.flush()
    api_db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            template_id="Leave Application Form",
            status="pending",
            fields={},
        )
    )
    api_db.commit()
    metadata = check(c, target, "book", str(book.id), "edit")
    next_revision = check(c, target, "book", str(book.id), "create")
    assert metadata.status_code == next_revision.status_code == 200
    assert metadata.json()["current"]["authorization"] == "allowed"
    assert next_revision.json()["current"]["authorization"] == "denied"
    assert any(
        reason["code"] == "BOOK_NOT_REVISABLE"
        for reason in next_revision.json()["current"]["reasons"]
    )
    before_revision = next(
        reason["params"]["resource_revision"]
        for reason in metadata.json()["current"]["reasons"]
        if "resource_revision" in reason["params"]
    )
    account_revision = metadata.json()["snapshot"]["revision"]
    book.approval_state = "returned"
    api_db.commit()
    ready = check(c, target, "book", str(book.id), "create")
    assert ready.json()["current"]["authorization"] == "allowed"
    assert ready.json()["snapshot"]["revision"] == account_revision
    assert (
        next(
            reason["params"]["resource_revision"]
            for reason in ready.json()["current"]["reasons"]
            if "resource_revision" in reason["params"]
        )
        != before_revision
    )


def test_summary_does_not_create_template_directory_or_load_book_records(
    api_db, monkeypatch, tmp_path
):
    from app.config import get_settings
    from app.services import book_service, book_template_service

    _, target, c = setup(api_db)
    settings = get_settings()
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    def forbid(*args, **kwargs):
        raise AssertionError("Summary must not evaluate business records")

    monkeypatch.setattr(book_service, "_resolve_book_read_access", forbid)
    monkeypatch.setattr(book_template_service, "templates_dir", forbid)
    assert c.get(url(target)).status_code == 200
    assert not (tmp_path / "book_templates").exists()


def test_retained_reviewer_exact_revision_check_matches_real_read_without_receipts(api_db):
    admin, target, c = setup(api_db)
    api_db.add(BookCategory(id="HR", prefix="HR"))
    api_db.flush()
    book = Book(
        category_id="HR",
        ref_number="HR-RETAINED",
        grade="top_secret",
        distribution="named",
        approval_state="approved",
        created_by_user_id=admin.id,
    )
    api_db.add(book)
    api_db.flush()
    v1 = BookVersion(
        book_id=book.id,
        version_no=1,
        template_id="Leave Application Form",
        status="approved",
        fields={},
    )
    v2 = BookVersion(
        book_id=book.id,
        version_no=2,
        template_id="Leave Application Form",
        status="approved",
        fields={},
    )
    api_db.add_all([v1, v2])
    api_db.flush()
    retained = BookRevisionAccess(
        version_id=v1.id,
        user_id=target.id,
        kind="reviewer",
        state="reviewed",
        decided_at=datetime.now(UTC).replace(tzinfo=None),
    )
    step = BookApprovalStep(
        book_id=book.id,
        version_id=v1.id,
        step_order=0,
        stage_label="Review",
        assignee_user_id=target.id,
        state="reviewed",
        kind="reviewer",
    )
    api_db.add_all([retained, step])
    api_db.commit()
    perm_service.set_user_override(api_db, target.id, "books.view", "deny")
    request = {
        "resource": {"kind": "book", "id": str(book.id), "revision_id": v1.id},
        "action": "read",
    }
    own = c.post(url(target, "check-access"), json=request)
    assert own.status_code == 200, own.text
    assert own.json()["current"]["authorization"] == "allowed"
    assert any(
        reason["code"] == "RECORD_READ_ASSIGNED_OR_RETAINED_REVISION"
        for reason in own.json()["current"]["reasons"]
    )
    api_db.refresh(step)
    assert step.seen_at is None
    assert api_db.scalar(select(func.count()).select_from(AuditLog)) == 0
    request["resource"]["revision_id"] = v2.id
    assert c.post(url(target, "check-access"), json=request).status_code == 404
    consumer = client(api_db, target)
    assert (
        consumer.get(f"/api/v1/books/{book.id}?version_id={v1.id}&mark_read=false").status_code
        == 200
    )
    assert (
        consumer.get(f"/api/v1/books/{book.id}?version_id={v2.id}&mark_read=false").status_code
        == 403
    )


@pytest.mark.parametrize(
    "kind,identifier,path",
    [
        ("notification_template", "violation", "/api/v1/notify/templates"),
        ("email_template", "absence:absent", "/api/v1/email/draft-templates"),
        ("word_template", "library", "/api/v1/books/word-templates"),
        ("editor_template", "library", "/api/v1/editor-templates"),
    ],
)
def test_reporter_template_diagnostics_match_real_authenticated_route_gate(
    api_db, kind, identifier, path
):
    admin, target, _ = setup(api_db, role="inmate_reporter")

    def authenticated_client(user):
        app = create_app()
        app.dependency_overrides[get_db] = lambda: api_db
        # Keep get_current_user itself live: its fixed-role route restriction
        # is the policy under test, not a capability-only substitute.
        app.dependency_overrides[get_optional_user] = lambda: user
        return TestClient(app)

    diagnostic = check(authenticated_client(admin), target, kind, identifier, "view")
    actual = authenticated_client(target).get(path)
    assert diagnostic.status_code == 200, diagnostic.text
    assert actual.status_code == 403, actual.text
    code = actual.json()["error"]["code"]
    assert code == "INMATE_REPORTER_ROUTE_FORBIDDEN"
    decision = diagnostic.json()["current"]
    assert decision["authorization"] == "denied"
    assert decision["executable_now"] is False
    assert any(
        reason["code"] == code and reason["applied"] and reason["decisive"]
        for reason in decision["reasons"]
    )
    assert not any(
        warning["code"] == "TEMPLATES_REMAIN_VISIBLE" for warning in decision["warnings"]
    )


def test_catalog_library_labels_and_missing_arabic_are_explicit(api_db, monkeypatch):
    from dataclasses import replace

    from app.services import capability_catalog_service

    _, target, c = setup(api_db)
    original = capability_catalog_service.list_catalog

    def catalog_with_missing_arabic(db):
        return tuple(
            replace(entry, label_ar=None, description_ar=None)
            if entry.id == "books.view"
            else entry
            for entry in original(db)
        )

    monkeypatch.setattr(capability_catalog_service, "list_catalog", catalog_with_missing_arabic)
    response = c.get(url(target))
    assert response.status_code == 200, response.text
    rows = response.json()["items"]
    labels = {
        row["resource"]["kind"]: row["label"] for row in rows if row["resource"]["id"] == "library"
    }
    assert labels["word_template"] == {"en": "Word template library", "ar": "مكتبة قوالب وورد"}
    assert labels["editor_template"] == {
        "en": "Editor template library",
        "ar": "مكتبة قوالب المحرّر",
    }
    capability = next(
        row
        for row in rows
        if row["resource"] == {"kind": "capability", "id": "books.view", "revision_id": None}
    )
    warning = next(
        warning
        for warning in capability["actions"][0]["warnings"]
        if warning["code"] == "MISSING_ARABIC_TRANSLATION"
    )
    assert warning["params"] == {"locale": "ar", "fields": ["label", "description"]}


def test_word_template_content_timestamp_does_not_invalidate_policy_revision(api_db, monkeypatch):
    from app.services import book_template_service

    admin, target, _ = setup(api_db)
    first = book_template_service.TemplateInfo(name="first.docx", modified_at=datetime(2026, 1, 1))
    second = book_template_service.TemplateInfo(
        name="second.docx", modified_at=datetime(2026, 1, 2)
    )
    rows = [first, second]
    monkeypatch.setattr(book_template_service, "list_templates", lambda **kwargs: rows)
    before = access_decision_service.snapshot(api_db, target, admin).revision
    first.modified_at = datetime(2026, 10, 29)
    rows.reverse()
    after = access_decision_service.snapshot(api_db, target, admin).revision
    assert before == after


def test_proposed_record_read_loss_is_a_denied_impact_not_a_missing_record(api_db):
    admin, target, c = setup(api_db, role="manager")
    api_db.add(BookCategory(id="HR", prefix="HR"))
    api_db.flush()
    book = Book(category_id="HR", ref_number="HR-PROPOSED-LOSS", approval_state="none", created_by_user_id=admin.id)
    api_db.add(book)
    api_db.flush()
    api_db.add(BookVersion(book_id=book.id, version_no=1, template_id="Leave Application Form", status="pending", fields={}, created_by_user_id=admin.id))
    api_db.commit()
    response = check(c, target, "book", str(book.id), "read", proposed=[{"capability": "books.view", "effect": "deny"}])
    assert response.status_code == 200, response.text
    assert response.json()["current"]["authorization"] == "allowed"
    assert response.json()["proposed"]["authorization"] == "denied"
    assert response.json()["proposed"]["executable_now"] is False
    assert len(response.json()["impacts"]) == 1
    assert perm_service.get_user_overrides(api_db, target.id) == {}
    perm_service.set_user_override(api_db, target.id, "books.view", "deny")
    assert check(c, target, "book", str(book.id), "read").status_code == 404


def test_reporter_existing_category_create_and_own_revision_match_real_authority(api_db):
    from app.services import action_guard_service, book_service, document_service

    _, target, c = setup(api_db, role="inmate_reporter")
    employee = Employee(id="REPORTER-ACCESS", name_en="Synthetic Reporter")
    api_db.add_all([employee, BookCategory(id="INV", prefix="INV")])
    api_db.flush()
    target.employee_id = employee.id
    book = Book(category_id="INV", ref_number="INV-ACCESS-REVISE", approval_state="none", created_by_user_id=target.id)
    api_db.add(book)
    api_db.flush()
    version = BookVersion(book_id=book.id, version_no=1, template_id="Inmate Conduct Violations", status="pending", fields={"reporter_id": employee.id}, created_by_user_id=target.id)
    api_db.add(version)
    api_db.commit()
    # These are the production generation/revision guards, with no rendering,
    # generated files, mocked capabilities or substituted allow verdict.
    document_service.authorize_interactive_generation(api_db, target, "Inmate Conduct Violations")
    action_guard_service.book_revise_decision(api_db, target, book).require()
    assert book_service.require_revise_access(api_db, target, book).id == version.id
    new_record = check(c, target, "service", "Inmate Conduct Violations", "create", context={"grade": "unclassified"})
    revise = check(c, target, "book", str(book.id), "create")
    assert new_record.status_code == revise.status_code == 200
    assert new_record.json()["current"]["authorization"] == "allowed"
    assert revise.json()["current"]["authorization"] == "allowed"
    assert revise.json()["current"]["setting_capabilities"] == []
    assert "books.edit" not in perm_service.effective_caps(api_db, target)
    assert api_db.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_duty_transfer_explains_conditional_record_gates_without_denying_initial_placement(api_db):
    from app.services.action_guard_service import duty_transfer_decision

    _, target, c = setup(api_db, role="manager")
    api_db.add(BookCategory(id="GS", prefix="GS"))
    api_db.commit()
    for capability in ("documents.generate", "documents.duty_transfer"):
        perm_service.set_user_override(api_db, target.id, capability, "grant")
    conditional = ["books.category.GS", "books.service.General Book", "books.category.12/1"]
    for capability in conditional:
        perm_service.set_user_override(api_db, target.id, capability, "deny")
    caps = perm_service.effective_caps(api_db, target)
    assert duty_transfer_decision(caps, initial_placement=True).allowed
    assert not duty_transfer_decision(caps, initial_placement=False).allowed
    response = check(c, target, "capability", "documents.duty_transfer", "manage")
    assert response.status_code == 200, response.text
    decision = response.json()["current"]
    assert decision["authorization"] == "needs_context"
    assert decision["executable_now"] is None
    assert decision["required_context"] == ["employee_assignment"]
    warning = next(warning for warning in decision["warnings"] if warning["code"] == "CONDITIONAL_PREREQUISITE_BLOCKED")
    assert warning["capabilities"] == conditional
    assert warning["params"]["condition"] == "existing_assignment"
    assert decision["reason_tree"]["children"][1]["op"] == "any"
    assert any(reason["code"] == "INITIAL_PLACEMENT_BYPASSES_RECORD_TYPE" for reason in decision["reasons"])
