"""Department Records scope intersects (never replaces) ADR 0006 access."""

from __future__ import annotations

import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.api.deps import get_current_user
from app.api.errors import NotFoundError
from app.db.models import (
    AuditLog,
    Book,
    BookApprovalStep,
    BookCategory,
    BookRecipient,
    BookRevisionAccess,
    BookVersion,
    Document,
    Employee,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app
from app.services import book_service, department_service, perm_service
from app.services import department_scope_service as scopes
from tests.conftest import make_user
from tests.department_fixtures import department as make_department
from tests.department_fixtures import employee, exception, grant, link, recompute


@pytest.fixture()
def records(api_db):
    db = api_db
    employee(db, "ROOT-HEAD")
    employee(db, "OTHER-HEAD")
    employee(db, "CHILD-HEAD", supervisor="ROOT-HEAD")
    for name, supervisor in (
        ("viewer", "ROOT-HEAD"),
        ("peer", "ROOT-HEAD"),
        ("other", "OTHER-HEAD"),
        ("child", "CHILD-HEAD"),
        ("unassigned", None),
    ):
        employee(db, name, supervisor=supervisor)
    root = make_department(db, "Root", "ROOT-HEAD", name_ar="الجذر")
    other = make_department(db, "Other", "OTHER-HEAD", name_ar="آخر")
    child = make_department(db, "Child", "CHILD-HEAD", name_ar="فرع")
    db.add(BookCategory(id="HR", prefix="HR"))
    users = {
        name: link(db, make_user(db, role="operator", email=f"{name}@scope.ae"), name)
        for name in ("viewer", "peer", "other", "child", "unassigned")
    }
    grant(db, root.id, users["viewer"], "viewer")
    books = {}
    for name in ("peer", "other", "child", "unassigned", "viewer"):
        row = Book(
            category_id="HR",
            ref_number=f"HR-{name}",
            subject=f"Scope {name}",
            created_by_user_id=users[name].id,
        )
        db.add(row)
        db.flush()
        books[name] = row
    db.commit()
    department_service.set_scoping(db, True, actor="admin@scope.ae")
    return db, users, books, root, other, child


def visible(db, user):
    clause = book_service.user_visibility_clause(db, user)
    stmt = select(Book.id)
    return set(db.scalars(stmt.where(clause) if clause is not None else stmt))


def test_viewers_see_department_but_not_subdepartments_or_null_records(records):
    db, users, books, *_ = records
    assert visible(db, users["viewer"]) == {books["peer"].id, books["viewer"].id}
    for name, book in books.items():
        if name in ("peer", "viewer"):
            assert book_service.resolve_book_read_access(db, users["viewer"], book).full_access
        else:
            with pytest.raises(NotFoundError):
                book_service.resolve_book_read_access(db, users["viewer"], book)


@pytest.mark.parametrize("role", ["head", "deputy"])
def test_heads_and_deputies_see_subtree(records, role):
    db, users, books, root, *_ = records
    if role == "head":
        link(db, users["viewer"], root.head_employee_id)
    department_service.replace_people(
        db,
        root.id,
        [users["viewer"].id] if role == "deputy" else [],
        [],
        actor="admin@scope.ae",
    )
    assert visible(db, users["viewer"]) == {books[name].id for name in ("peer", "viewer", "child")}


def test_plain_staff_see_only_their_own_records_not_department_peers(records):
    db, users, books, *_ = records
    assert visible(db, users["peer"]) == {books["peer"].id}
    assert book_service.resolve_book_read_access(db, users["peer"], books["peer"]).full_access
    with pytest.raises(NotFoundError):
        book_service.resolve_book_read_access(db, users["peer"], books["viewer"])


def test_supervisor_sees_records_created_by_users_in_their_branch(records):
    db, users, books, root, _other, child = records
    supervisor = users["unassigned"]
    db.get(Employee, "peer").supervisor_id = supervisor.employee_id
    db.get(Employee, "CHILD-HEAD").supervisor_id = supervisor.employee_id
    recompute(db)
    scope = scopes.resolve_department_scope(db, supervisor)
    assert scope.kind == "branch"
    assert scope.department_ids == frozenset()
    assert books["peer"].department_id == root.id
    assert books["child"].department_id == child.id
    expected = {books[name].id for name in ("unassigned", "peer", "child")}
    assert visible(db, supervisor) == expected
    for book in books.values():
        assert scopes.book_in_scope(db, supervisor, book) == (book.id in expected)
        if book.id in expected:
            assert book_service.resolve_book_read_access(db, supervisor, book).full_access
        else:
            with pytest.raises(NotFoundError):
                book_service.resolve_book_read_access(db, supervisor, book)


def test_personal_and_secret_still_narrow_department_access(records):
    db, users, books, *_ = records
    peer = books["peer"]
    peer.confidentiality = "personal"
    db.commit()
    assert peer.id not in visible(db, users["viewer"])
    with pytest.raises(NotFoundError):
        book_service.resolve_book_read_access(db, users["viewer"], peer)
    peer.confidentiality = "secret"
    db.commit()
    assert peer.id not in visible(db, users["viewer"])
    db.add(UserPermission(user_id=users["viewer"].id, capability="books.secret", effect="grant"))
    db.commit()
    scopes.invalidate_department_scope(db, users["viewer"].id)
    assert peer.id in visible(db, users["viewer"])
    assert book_service.resolve_book_read_access(db, users["viewer"], peer).full_access


def test_active_recipient_and_submitter_keep_cross_department_access(records):
    db, users, books, *_ = records
    book = books["other"]
    recipient = BookRecipient(
        book_id=book.id,
        user_id=users["viewer"].id,
        sent_by_user_id=users["other"].id,
        purpose="info",
    )
    db.add(recipient)
    db.commit()
    assert book.id in visible(db, users["viewer"])
    assert book_service.resolve_book_read_access(db, users["viewer"], book).full_access
    recipient.revoked_at = datetime.now()
    db.commit()
    assert book.id not in visible(db, users["viewer"])
    with pytest.raises(NotFoundError):
        book_service.resolve_book_read_access(db, users["viewer"], book)
    book.submitted_by_user_id = users["viewer"].id
    db.commit()
    assert book.id in visible(db, users["viewer"])


@pytest.mark.parametrize("kind", ["approver", "reviewer"])
def test_assignee_and_retained_revision_keep_cross_department_access(records, kind):
    db, users, books, *_ = records
    book = books["other"]
    version = BookVersion(book_id=book.id, version_no=1)
    db.add(version)
    db.flush()
    step = BookApprovalStep(
        book_id=book.id,
        version_id=version.id,
        step_order=0,
        stage_label="Review",
        assignee_user_id=users["viewer"].id,
        state="pending",
        kind=kind,
    )
    db.add(step)
    db.commit()
    assert book.id in visible(db, users["viewer"])
    book_service.resolve_book_read_access(db, users["viewer"], book)
    step.state = "approved"
    step.decided_at = datetime.now()
    db.commit()
    assert book.id not in visible(db, users["viewer"])
    grant = BookRevisionAccess(
        version_id=version.id,
        user_id=users["viewer"].id,
        kind=kind,
        state="approved",
        decided_at=datetime.now(),
    )
    db.add(grant)
    db.commit()
    assert book.id in visible(db, users["viewer"])
    grant.revoked_at = datetime.now()
    db.commit()
    assert book.id not in visible(db, users["viewer"])


def test_switch_off_restores_visibility_and_backfill_is_counted_and_idempotent(records):
    db, users, books, root, *_ = records
    grant(db, books["other"].department_id, users["peer"], "deputy")
    department_service.set_scoping(db, False, actor="admin@scope.ae")
    assert visible(db, users["viewer"]) == {book.id for book in books.values()}
    db.execute(
        update(Book)
        .where(Book.id.in_([books["peer"].id, books["other"].id]))
        .values(department_id=None)
    )
    db.commit()
    result = department_service.set_scoping(db, True, actor="admin@scope.ae")
    assert result.records_backfilled == 2
    assert books["peer"].department_id == root.id
    assert books["unassigned"].department_id is None
    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "department_scoping.enabled")
        .order_by(AuditLog.id.desc())
    )
    assert json.loads(audit.payload)["records_backfilled"] == 2
    assert department_service.set_scoping(db, True, actor="admin@scope.ae").records_backfilled == 0
    assert department_service.set_scoping(db, False, actor="admin@scope.ae").records_backfilled == 0


@pytest.mark.parametrize("extra_role", ["deputy", "viewer"])
def test_services_use_user_department_union_not_subtree_and_preserve_record_caps(
    records, extra_role
):
    db, users, _books, root, other, child = records
    user = users["peer"]
    before = perm_service.effective_caps(db, user)
    assert not any(cap.startswith("books.service.") for cap in before)
    assert any(cap.startswith("books.servicerecords.") for cap in before)
    department_service.replace_services(db, root.id, ["General Book"], actor="admin@scope.ae")
    department_service.replace_services(db, child.id, ["Report"], actor="admin@scope.ae")
    department_service.replace_people(
        db, root.id, [user.id], [users["viewer"].id], actor="admin@scope.ae"
    )
    assert scopes.resolve_department_scope(db, user).department_ids == frozenset(
        {root.id, child.id}
    )
    assert scopes.user_department_ids(db, user) == frozenset({root.id})
    caps = perm_service.effective_caps(db, user)
    assert {cap for cap in caps if cap.startswith("books.service.")} == {
        "books.service.General Book"
    }
    assert {cap for cap in caps if cap.startswith("books.servicerecords.")} == {
        cap for cap in before if cap.startswith("books.servicerecords.")
    }
    department_service.replace_services(db, other.id, ["Report"], actor="admin@scope.ae")
    department_service.replace_people(
        db,
        other.id,
        [user.id] if extra_role == "deputy" else [],
        [user.id] if extra_role == "viewer" else [],
        actor="admin@scope.ae",
    )
    assert scopes.user_department_ids(db, user) == frozenset({root.id, other.id})
    assert {
        cap for cap in perm_service.effective_caps(db, user) if cap.startswith("books.service.")
    } == {"books.service.General Book", "books.service.Report"}
    perm_service.set_user_override(
        db,
        user.id,
        "books.service.Report",
        "deny",
        actor=make_user(db, role="admin", email="caps-admin@scope.ae"),
    )
    assert "books.service.Report" not in perm_service.effective_caps(db, user)


def test_organization_and_switch_off_keep_services_self_scope_has_none(records):
    db, users, *_ = records
    user = users["unassigned"]
    assert not any(
        cap.startswith("books.service.") for cap in perm_service.effective_caps(db, user)
    )
    department_service.set_scoping(db, False, actor="admin@scope.ae")
    all_caps = perm_service.effective_caps(db, user)
    assert "books.service.General Book" in all_caps
    db.add(UserPermission(user_id=user.id, capability="departments.all", effect="grant"))
    db.commit()
    department_service.set_scoping(db, True, actor="admin@scope.ae")
    assert perm_service.effective_caps(db, user) == all_caps | {"departments.all"}


def test_mapper_stamps_creator_employee_preserves_explicit_and_does_not_restamp(records):
    db, users, books, root, other, _child = records
    assert books["peer"].department_id == root.id
    assert books["unassigned"].department_id is None
    grant(db, other.id, users["peer"], "deputy")
    grant(db, other.id, users["unassigned"], "viewer")
    derived = Book(category_id="HR", ref_number="DERIVED", created_by_user_id=users["peer"].id)
    outside = Book(
        category_id="HR", ref_number="OUTSIDE", created_by_user_id=users["unassigned"].id
    )
    explicit = Book(
        category_id="HR",
        ref_number="EXPLICIT",
        created_by_user_id=users["peer"].id,
        department_id=other.id,
    )
    anonymous = Book(category_id="HR", ref_number="ANONYMOUS")
    db.add_all([derived, outside, explicit, anonymous])
    db.commit()
    assert derived.department_id == root.id
    assert outside.department_id is None
    assert explicit.department_id == other.id
    assert anonymous.department_id is None
    exception(db, users["peer"].employee_id, other.id)
    assert db.get(Employee, users["peer"].employee_id).department_id == other.id
    books["peer"].subject = "Edited after transfer"
    db.commit()
    assert books["peer"].department_id == root.id
    assert derived.department_id == root.id


def test_records_after_employee_transfer_stamp_the_new_department(records):
    db, users, books, root, other, _child = records
    exception(db, users["peer"].employee_id, other.id)
    new_book = Book(
        category_id="HR", ref_number="AFTER-TRANSFER", created_by_user_id=users["peer"].id
    )
    db.add(new_book)
    db.commit()
    assert books["peer"].department_id == root.id
    assert new_book.department_id == other.id


def test_api_list_facets_detail_and_word_hide_out_of_scope(records):
    db, users, books, root, *_ = records
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: users["viewer"]
    db.add(UserPermission(user_id=users["viewer"].id, capability="books.edit", effect="grant"))
    db.commit()
    scopes.invalidate_department_scope(db, users["viewer"].id)
    with TestClient(app) as client:
        listing = client.get("/api/v1/books")
        assert listing.status_code == 200, listing.text
        items = listing.json()["items"]
        assert {item["id"] for item in items} == {books["peer"].id, books["viewer"].id}
        assert all(
            item["department_id"] == root.id
            and item["department_name_en"] == "Root"
            and item["department_name_ar"] == "الجذر"
            for item in items
        )
        assert client.get("/api/v1/books/facets").json()["total"] == 2
        assert client.get("/api/v1/books", params={"q": "Scope other"}).json()["items"] == []
        for name in ("other", "child", "unassigned"):
            for suffix in ("", "/word-sessions/status"):
                response = client.get(f"/api/v1/books/{books[name].id}{suffix}")
                assert response.status_code == 404, response.text
            response = client.post(f"/api/v1/books/{books[name].id}/word-sessions")
            assert response.status_code == 404, response.text
        detail = client.get(f"/api/v1/books/{books['peer'].id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["department_name_en"] == "Root"


def test_document_employee_dashboard_and_ledger_projections_hide_foreign_books(records):
    from datetime import date

    from app.db.models import Employee, LedgerEntry
    from app.services import dashboard_service, document_service
    from app.services.ledger_service import DRAFT_TAG

    db, users, books, *_ = records
    db.add(Employee(id="DOC", name_en="Documents Employee"))
    db.flush()
    documents = {}
    for name in ("peer", "other", "unassigned"):
        book = books[name]
        document = Document(
            template_id="General Book",
            ref_number=book.ref_number,
            employee_id="DOC",
            submission_id=f"scope-{name}",
        )
        db.add(document)
        db.flush()
        db.add(
            BookVersion(
                book_id=book.id, version_no=1, document_id=document.id, template_id="General Book"
            )
        )
        documents[name] = document
        for draft in (False, True):
            db.add(
                LedgerEntry(
                    entry_date=date.today(),
                    direction="outgoing",
                    channel="letter",
                    counterparty="Scope",
                    subject=name,
                    tags=[DRAFT_TAG] if draft else [],
                    related_book_id=book.id,
                    # Dashboard drafts are owner-scoped.
                    owner_user_id=users["viewer"].id,
                )
            )
    db.commit()
    user = users["viewer"]
    clause = book_service.document_visibility_clause(db, user)
    assert set(db.scalars(select(Document.id).where(clause))) == {documents["peer"].id}
    employee_clause = document_service.live_record_document_clause(db, user)
    assert set(db.scalars(select(Document.id).where(employee_clause))) == {documents["peer"].id}
    totals = dashboard_service._compute_totals(
        db, today=date.today(), user=user, scope=scopes.resolve_department_scope(db, user)
    )
    assert totals.forms_this_month == 1
    assert totals.book_draft_count == 2
    assert totals.draft_count == 1
    assert [item.id for item in dashboard_service._recent_documents(db, user=user)] == [
        documents["peer"].id
    ]
    assert [item.subject for item in dashboard_service._recent_ledger(db, user=user)] == ["peer"]


def test_creation_paths_stamp_creator_employee_department(api_db, tmp_path, monkeypatch):
    from app.config import Settings
    from app.services import document_service
    from tests.test_books_created_by import _client, _generate_general_book, _generate_leave
    from tests.test_word_book_routes import _client as word_client

    db = api_db
    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda path: None)
    employee(db, "CREATOR-HEAD")
    employee(db, "CREATOR", supervisor="CREATOR-HEAD")
    employee(db, "G-1001")
    department = make_department(db, "Creators", "CREATOR-HEAD", name_ar="المنشئون")
    db.add_all([BookCategory(id="GS", prefix="GS"), BookCategory(id="HR", prefix="HR")])
    db.commit()
    creator = link(db, make_user(db, role="admin", email="stamping@scope.ae"), "CREATOR")
    db.commit()
    book_ids = [_generate_general_book(db, creator), _generate_leave(db, creator)]
    with _client(db, creator) as client:
        response = client.post(
            "/api/v1/books",
            json={"category_id": "GS", "subject": "Manual", "direction": "outgoing"},
        )
        assert response.status_code == 201, response.text
        book_ids.append(response.json()["id"])
    with word_client(db, creator, monkeypatch, tmp_path) as client:
        response = client.post(
            "/api/v1/books/word-sessions", json={"classification_code": "5/1", "subject": "Word"}
        )
        assert response.status_code == 201, response.text
        book_ids.append(response.json()["book_id"])
    assert [db.get(Book, book_id).department_id for book_id in book_ids] == [department.id] * 4
