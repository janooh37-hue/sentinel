"""Public employee projections inherit subsystem and exact-revision read policy."""

from datetime import date, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.config import get_settings
from app.db.models import (
    Absence,
    Book,
    BookApprovalStep,
    BookCategory,
    BookRevisionAccess,
    BookVersion,
    Document,
    Employee,
    Leave,
    OutboundMessage,
    UserPermission,
    Violation,
)
from app.db.session import get_db
from app.main import create_app
from tests.conftest import make_user


@pytest.fixture()
def records(api_db, monkeypatch, tmp_path):
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    reader = make_user(api_db, email="projection-reader@test.ae")
    admin = make_user(api_db, role="admin", email="projection-admin@test.ae")
    employee = Employee(id="G-PROJECTION", name_en="Projection Employee", status="Active")
    leave = Leave(
        employee_id=employee.id,
        leave_type="Annual Leave",
        start_date=date(2026, 10, 1),
        end_date=date(2026, 10, 2),
        days=2,
        status="Approved",
    )
    violation = Violation(
        employee_id=employee.id,
        violation_type="Late Arrival",
        date=date(2026, 10, 20),
        description="PROTECTED-VIOLATION-MARKER",
        status="Open",
    )
    api_db.add_all([employee, leave, violation, BookCategory(id="HR", prefix="HR")])
    api_db.commit()
    actor = {"user": reader}
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: actor["user"]
    with TestClient(app) as client:
        yield SimpleNamespace(
            db=api_db,
            reader=reader,
            admin=admin,
            employee=employee,
            leave=leave,
            violation=violation,
            actor=actor,
            client=client,
            root=tmp_path,
        )
    get_settings.cache_clear()


def _state(records):
    tables = (
        Book,
        BookVersion,
        Document,
        Leave,
        Absence,
        OutboundMessage,
        Violation,
        BookRevisionAccess,
        BookApprovalStep,
    )
    rows = tuple(
        (
            model.__tablename__,
            tuple(tuple(row) for row in records.db.execute(select(model.__table__))),
        )
        for model in tables
    )
    files = tuple((path.name, path.read_bytes()) for path in sorted(records.root.glob("*.docx")))
    return rows, files


def test_violation_deny_hides_detail_counts_and_both_activity_queries(records):
    records.db.add(
        UserPermission(
            user_id=records.reader.id,
            capability="violations.view",
            effect="deny",
        )
    )
    records.db.commit()
    before = _state(records)
    try:
        dedicated = records.client.get(f"/api/v1/employees/{records.employee.id}/violations")
        assert dedicated.status_code == 403
        detail = records.client.get(f"/api/v1/employees/{records.employee.id}/detail")
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["recent_violations"] == []
        assert body["stats"]["violations"] == 0
        assert all(row["kind"] != "violation" for row in body["recent_activity"])
        for extra in ({}, {"kind": "violation"}):
            response = records.client.get(
                "/api/v1/employees/activity",
                params={"employee_id": records.employee.id, **extra},
            )
            assert response.status_code == 200, response.text
            items = response.json()["items"]
            assert all(row["kind"] != "violation" for row in items)
            assert response.json()["total"] == (0 if extra else 1)
            assert [row["source_id"] for row in items] == ([] if extra else [records.leave.id])
        records.actor["user"] = records.admin
        detail = records.client.get(f"/api/v1/employees/{records.employee.id}/detail").json()
        assert detail["stats"]["violations"] == 1
        assert detail["recent_violations"][0]["description"] == "PROTECTED-VIOLATION-MARKER"
        response = records.client.get(
            "/api/v1/employees/activity",
            params={"employee_id": records.employee.id, "kind": "violation"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1
        assert response.json()["items"][0]["detail"] == "PROTECTED-VIOLATION-MARKER"
    finally:
        assert _state(records) == before


@pytest.mark.parametrize("denied_capability", ["employees.view", "leaves.view"])
def test_employee_leave_and_absence_reads_require_both_capabilities(records, denied_capability):
    empty = Employee(id="G-EMPTY-PRIVATE", name_en="Empty Employee", status="Active")
    records.db.add_all(
        [
            empty,
            UserPermission(user_id=records.reader.id, capability=denied_capability, effect="deny"),
        ]
    )
    records.db.commit()
    before = _state(records)
    try:
        for employee_id in (records.employee.id, empty.id, "G-NOT-FOUND"):
            for section in ("leaves", "leave-balance", "absences", "absences/episodes"):
                response = records.client.get(f"/api/v1/employees/{employee_id}/{section}")
                assert response.status_code == 403, response.text
    finally:
        assert _state(records) == before


def test_leave_deny_masks_aggregate_facts_but_preserves_employee_and_message_history(records):
    current_year = date.today().year
    records.leave.start_date = date(current_year, 10, 1)
    records.leave.end_date = date(current_year, 10, 2)
    absence = Absence(
        employee_id=records.employee.id,
        date=date(current_year, 10, 3),
        note="PROTECTED-ABSENCE-MARKER",
    )
    message = OutboundMessage(
        employee_id=records.employee.id,
        event_type="leave",
        event_ref=str(records.leave.id),
        language="en",
        phone="0500000000",
        channel="sms",
        status="sent",
        body="Retained employee message history",
        provider_msg_id="existing-provider-id",
    )
    records.db.add_all(
        [
            absence,
            message,
            UserPermission(user_id=records.reader.id, capability="leaves.view", effect="deny"),
            UserPermission(user_id=records.reader.id, capability="employees.notify", effect="deny"),
        ]
    )
    records.db.commit()
    before = _state(records)
    try:
        response = records.client.get(f"/api/v1/employees/{records.employee.id}/detail")
        assert response.status_code == 200, response.text
        detail = response.json()
        assert detail["employee"]["id"] == records.employee.id
        assert detail["stats"]["leaves_taken_days"] is None
        assert detail["stats"]["leaves_allowed_days"] is None
        assert detail["stats"]["absence_days"] is None
        assert detail["recent_leaves"] == []
        assert detail["recent_absences"] == []
        assert {row["kind"] for row in detail["recent_activity"]} == {"violation"}
        assert detail["stats"]["violations"] == 1
        assert detail["recent_violations"][0]["id"] == records.violation.id
        assert detail["recent_sms"][0]["id"] == message.id
        assert detail["recent_sms"][0]["body"] == message.body
        assert detail["recent_sms"][0]["provider_msg_id"] == message.provider_msg_id
        assert detail["recent_sms"][0]["phone"] == message.phone
        assert records.client.get(f"/api/v1/employees/{records.employee.id}").status_code == 200

        for params in ({}, {"kind": "leave"}, {"employee_id": records.employee.id}):
            response = records.client.get("/api/v1/employees/activity", params=params)
            assert response.status_code == 200, response.text
            body = response.json()
            assert all(row["kind"] != "leave" for row in body["items"])
            assert body["total"] == (0 if params.get("kind") == "leave" else 1)

        records.actor["user"] = records.admin
        response = records.client.get(f"/api/v1/employees/{records.employee.id}/detail")
        assert response.status_code == 200, response.text
        detail = response.json()
        assert detail["stats"]["leaves_taken_days"] == 2
        assert detail["stats"]["leaves_allowed_days"] == 30
        assert detail["stats"]["absence_days"] == 1
        assert detail["recent_leaves"][0]["id"] == records.leave.id
        assert detail["recent_absences"][0]["id"] == absence.id
        assert {row["kind"] for row in detail["recent_activity"]} == {
            "leave",
            "absence",
            "violation",
        }
    finally:
        assert _state(records) == before


def test_authorized_empty_leave_history_is_not_forbidden(records):
    empty = Employee(id="G-EMPTY-LEAVES", name_en="Empty Employee", status="Active")
    records.db.add(empty)
    records.db.commit()
    for section in ("leaves", "absences"):
        response = records.client.get(f"/api/v1/employees/{empty.id}/{section}")
        assert response.status_code == 200, response.text
        assert response.json() == []
    response = records.client.get(f"/api/v1/employees/{empty.id}/absences/episodes")
    assert response.status_code == 200, response.text
    assert response.json()["episodes"] == []
    response = records.client.get(f"/api/v1/employees/{empty.id}/leave-balance")
    assert response.status_code == 200, response.text
    assert response.json()["annual_taken"] == 0
    response = records.client.get(f"/api/v1/employees/{empty.id}/detail")
    assert response.status_code == 200, response.text
    detail = response.json()
    assert detail["stats"]["leaves_taken_days"] == 0
    assert detail["stats"]["leaves_allowed_days"] == 30
    assert detail["stats"]["absence_days"] == 0
    assert detail["recent_leaves"] == []
    assert detail["recent_absences"] == []


def _revision(records, book, number):
    documents = []
    for role in ("primary", "companion"):
        path = records.root / f"{book.id}-{number}-{role}.docx"
        path.write_bytes(f"unchanged {number} {role}".encode())
        document = Document(
            employee_id=records.employee.id,
            leave_id=records.leave.id,
            violation_id=records.violation.id,
            template_id="Leave Application Form",
            ref_number=book.ref_number,
            submission_id=f"submission-{book.id}-{number}",
            role=role,
            docx_path=path.name,
            created_at=datetime(2026, 10, 20, number),
        )
        records.db.add(document)
        documents.append(document)
    records.db.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=number,
        template_id="Leave Application Form",
        document_id=documents[0].id,
        status="approved",
        fields={},
        created_by_user_id=records.admin.id,
    )
    records.db.add(version)
    records.db.flush()
    return version, documents


@pytest.mark.parametrize("restriction", ["named", "secret", "deleted", "revision"])
def test_document_metadata_uses_exact_owning_revision_on_every_employee_route(records, restriction):
    book = Book(
        category_id="HR",
        ref_number="HR-PROJECTION",
        subject="Protected Record",
        employee_id=records.employee.id,
        created_by_user_id=records.admin.id,
        grade="secret" if restriction == "secret" else "unclassified",
        distribution="named" if restriction == "named" else "organization",
        approval_state="approved",
    )
    records.db.add(book)
    records.db.flush()
    v1, readable = _revision(records, book, 1)
    _, protected = _revision(records, book, 2)
    if restriction == "revision":
        records.db.add_all(
            [
                UserPermission(user_id=records.reader.id, capability="books.view", effect="deny"),
                BookRevisionAccess(
                    version_id=v1.id,
                    user_id=records.reader.id,
                    kind="reviewer",
                    state="reviewed",
                    decided_at=datetime(2026, 10, 20),
                ),
            ]
        )
    else:
        protected = readable + protected
        readable = []
    if restriction == "deleted":
        book.deleted_at = datetime(2026, 10, 21)
    records.db.commit()
    all_documents = readable + protected
    before = _state(records)
    try:
        for user, expected in ((records.reader, readable), (records.admin, all_documents)):
            records.actor["user"] = user
            expected_ids = {document.id for document in expected}
            for document in all_documents:
                response = records.client.get(f"/api/v1/documents/{document.id}")
                assert (response.status_code == 200) == (document.id in expected_ids), response.text
            for section in ("leaves", "violations"):
                response = records.client.get(f"/api/v1/employees/{records.employee.id}/{section}")
                assert response.status_code == 200, response.text
                assert {doc["id"] for doc in response.json()[0]["linked_documents"]} == expected_ids
            response = records.client.get(f"/api/v1/employees/{records.employee.id}/detail")
            assert response.status_code == 200, response.text
            detail = response.json()
            assert detail["stats"]["documents"] == len(expected_ids)
            assert {doc["id"] for doc in detail["recent_documents"]} == expected_ids
            # A deleted Record stays listed for readers, but is never a link target.
            deleted = restriction == "deleted"
            assert {
                (doc["book_id"], doc["approval_state"]) for doc in detail["recent_documents"]
            } <= {(None, None) if deleted else (book.id, "approved")}
            assert {
                doc["id"] for doc in detail["recent_leaves"][0]["linked_documents"]
            } == expected_ids
            assert {
                doc["id"] for doc in detail["recent_violations"][0]["linked_documents"]
            } == expected_ids
            assert {
                row["ref_id"] for row in detail["recent_activity"] if row["kind"] == "document"
            } == expected_ids
            # Activity rows link to their Record, so deleted Records are omitted.
            activity_ids = set() if restriction == "deleted" else expected_ids
            response = records.client.get(
                "/api/v1/employees/activity",
                params={"employee_id": records.employee.id, "kind": "document", "limit": 1},
            )
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["total"] == len(activity_ids)
            assert len(body["items"]) == min(1, len(activity_ids))
            assert {row["source_id"] for row in body["items"]} <= activity_ids
            assert all(row["target_id"] == book.id for row in body["items"])
    finally:
        assert _state(records) == before
