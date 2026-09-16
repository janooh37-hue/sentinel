"""GET /books/{id}/versions/{id}/signed-document, GET/POST revision-access —
exact-version signed artifact delivery and administrative retained-access
revocation (approvals-flow step 3)."""

from __future__ import annotations

from datetime import UTC, datetime

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
    BookRevisionAccess,
    BookVersion,
    User,
)
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import book_service, perm_service


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()
    eng = create_engine(
        f"sqlite:///{tmp_path / 't.db'}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TS = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TS)
    db = TS()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()
        eng.dispose()
        get_settings.cache_clear()


def _user(db: Session, email: str, role: str = "operator") -> User:
    u = User(email=email, password_hash="x", role=role, status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def test_signed_document_serves_version_artifact_without_generated_document(api_db, tmp_path):
    """A scan-back signed artifact stored only on the version (no Document row)
    must still be reachable, exact-version-scoped, through the new endpoint."""
    (tmp_path / "book_attachments").mkdir(exist_ok=True)
    (tmp_path / "book_attachments" / "signed-v1.pdf").write_bytes(b"%PDF-VERSION-ONLY-SIGNED")
    api_db.add(BookCategory(id="HR", prefix="HR"))
    api_db.flush()
    book = Book(category_id="HR", ref_number="HR-1", approval_state="approved")
    api_db.add(book)
    api_db.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        status="approved",
        document_id=None,
        signed_pdf_path="book_attachments/signed-v1.pdf",
    )
    api_db.add(version)
    api_db.commit()

    client = _client(api_db, _user(api_db, "reader@x.ae"))
    response = client.get(f"/api/v1/books/{book.id}/versions/{version.id}/signed-document")
    assert response.status_code == 200, response.text
    assert response.content == b"%PDF-VERSION-ONLY-SIGNED"

    missing = client.get(f"/api/v1/books/{book.id}/versions/{version.id + 1}/signed-document")
    assert missing.status_code == 404


def test_restricted_reviewer_reaches_only_own_revision_signed_artifact(api_db, tmp_path):
    """A completed v1 reviewer with no books.view reads v1's signed artifact
    through the version-scoped endpoint, and cannot reach v2's."""
    from app.db.models import UserPermission

    (tmp_path / "book_attachments").mkdir(exist_ok=True)
    (tmp_path / "book_attachments" / "v1.pdf").write_bytes(b"%PDF-V1")
    (tmp_path / "book_attachments" / "v2.pdf").write_bytes(b"%PDF-V2-SECRET")
    api_db.add(BookCategory(id="HR", prefix="HR"))
    api_db.flush()
    reviewer = _user(api_db, "restricted-reviewer@x.ae")
    api_db.add(UserPermission(user_id=reviewer.id, capability="books.view", effect="deny"))
    book = Book(category_id="HR", ref_number="HR-2", approval_state="approved")
    api_db.add(book)
    api_db.flush()
    v1 = BookVersion(
        book_id=book.id, version_no=1, status="approved",
        signed_pdf_path="book_attachments/v1.pdf",
    )
    book.versions.append(v1)
    api_db.flush()
    step = BookApprovalStep(
        book_id=book.id, version_id=v1.id, step_order=0, stage_label="Review",
        assignee_user_id=reviewer.id, kind="reviewer", state="reviewed",
        decided_at=datetime.now(UTC).replace(tzinfo=None),
    )
    v1.approval_steps.append(step)
    api_db.flush()
    book_service.retain_revision_access(api_db, v1, step)
    v2 = BookVersion(
        book_id=book.id, version_no=2, status="approved",
        signed_pdf_path="book_attachments/v2.pdf",
    )
    book.versions.append(v2)
    api_db.commit()

    client = _client(api_db, reviewer)
    own = client.get(f"/api/v1/books/{book.id}/versions/{v1.id}/signed-document")
    assert own.status_code == 200, own.text
    assert own.content == b"%PDF-V1"

    other = client.get(f"/api/v1/books/{book.id}/versions/{v2.id}/signed-document")
    assert other.status_code == 403
    assert other.json()["error"]["code"] != "RECORD_TYPE_FORBIDDEN"


def test_revoke_revision_access_requires_admin_reason_and_is_idempotent(api_db, tmp_path):
    from app.db.models import UserPermission

    (tmp_path / "book_attachments").mkdir(exist_ok=True)
    (tmp_path / "book_attachments" / "v1.pdf").write_bytes(b"%PDF-RETAINED")
    reviewer = _user(api_db, "reviewer@x.ae")
    api_db.add(UserPermission(user_id=reviewer.id, capability="books.view", effect="deny"))
    editor = _user(api_db, "editor@x.ae", role="manager")
    admin = _user(api_db, "revoke-admin@x.ae", role="admin")
    api_db.add(BookCategory(id="HR", prefix="HR"))
    api_db.flush()
    book = Book(category_id="HR", ref_number="HR-3", approval_state="approved")
    api_db.add(book)
    api_db.flush()
    version = BookVersion(
        book_id=book.id, version_no=1, status="approved",
        signed_pdf_path="book_attachments/v1.pdf",
    )
    book.versions.append(version)
    api_db.flush()
    step = BookApprovalStep(
        book_id=book.id, version_id=version.id, step_order=1, stage_label="Review",
        assignee_user_id=reviewer.id, kind="reviewer", state="reviewed",
        decided_at=datetime.now(UTC).replace(tzinfo=None),
    )
    version.approval_steps.append(step)
    api_db.flush()
    book_service.retain_revision_access(api_db, version, step)
    api_db.commit()
    grant = api_db.scalar(select(BookRevisionAccess))
    assert grant is not None and grant.revoked_at is None

    reader_client = _client(api_db, reviewer)
    before_revoke = reader_client.get(
        f"/api/v1/books/{book.id}/versions/{version.id}/signed-document"
    )
    assert before_revoke.status_code == 200, before_revoke.text

    editor_client = _client(api_db, editor)
    denied = editor_client.post(
        f"/api/v1/books/{book.id}/revision-access/{grant.id}/revoke", json={"reason": "test"},
    )
    assert denied.status_code == 403

    admin_client = _client(api_db, admin)
    blank = admin_client.post(
        f"/api/v1/books/{book.id}/revision-access/{grant.id}/revoke", json={"reason": "  "},
    )
    assert blank.status_code == 422

    first = admin_client.post(
        f"/api/v1/books/{book.id}/revision-access/{grant.id}/revoke",
        json={"reason": "Departed employee"},
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert len(body) == 1
    assert body[0]["revoked_by_user_id"] == admin.id
    assert body[0]["revocation_reason"] == "Departed employee"
    api_db.refresh(grant)
    first_revoked_at = grant.revoked_at
    assert first_revoked_at is not None

    audit = api_db.scalar(
        select(AuditLog).where(AuditLog.action == "book_revision_access_revoked")
    )
    assert audit is not None and str(book.id) == audit.entity_id

    second = admin_client.post(
        f"/api/v1/books/{book.id}/revision-access/{grant.id}/revoke",
        json={"reason": "Different reason, should not overwrite"},
    )
    assert second.status_code == 200, second.text
    api_db.refresh(grant)
    assert grant.revoked_at == first_revoked_at
    assert grant.revocation_reason == "Departed employee"
    assert (
        api_db.scalar(
            select(AuditLog).where(AuditLog.action == "book_revision_access_revoked")
        )
        is not None
    )
    remaining_audits = list(
        api_db.scalars(select(AuditLog).where(AuditLog.action == "book_revision_access_revoked"))
    )
    assert len(remaining_audits) == 1

    reader_client = _client(api_db, reviewer)
    after_revoke = reader_client.get(
        f"/api/v1/books/{book.id}/versions/{version.id}/signed-document"
    )
    assert after_revoke.status_code == 403


def test_revoke_revokes_every_role_grant_for_same_user_and_revision(api_db):
    """One person holding BOTH approver and reviewer grants on one revision:
    revoking one responsibility revokes the other too."""
    dual = _user(api_db, "dual-role@x.ae", role="manager")
    admin = _user(api_db, "dual-admin@x.ae", role="admin")
    api_db.add(BookCategory(id="HR", prefix="HR"))
    api_db.flush()
    book = Book(category_id="HR", ref_number="HR-4", approval_state="approved")
    api_db.add(book)
    api_db.flush()
    version = BookVersion(book_id=book.id, version_no=1, status="approved")
    book.versions.append(version)
    api_db.flush()
    now = datetime.now(UTC).replace(tzinfo=None)
    approver_step = BookApprovalStep(
        book_id=book.id, version_id=version.id, step_order=0, stage_label="Approve",
        assignee_user_id=dual.id, kind="approver", state="approved", decided_at=now,
    )
    reviewer_step = BookApprovalStep(
        book_id=book.id, version_id=version.id, step_order=1, stage_label="Review",
        assignee_user_id=dual.id, kind="reviewer", state="reviewed", decided_at=now,
    )
    version.approval_steps.extend([approver_step, reviewer_step])
    api_db.flush()
    book_service.retain_revision_access(api_db, version, approver_step)
    book_service.retain_revision_access(api_db, version, reviewer_step)
    api_db.commit()
    grants = list(api_db.scalars(select(BookRevisionAccess)))
    assert len(grants) == 2

    admin_client = _client(api_db, admin)
    response = admin_client.post(
        f"/api/v1/books/{book.id}/revision-access/{grants[0].id}/revoke",
        json={"reason": "Role change"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body) == 2
    assert all(row["revoked_at"] is not None for row in body)
