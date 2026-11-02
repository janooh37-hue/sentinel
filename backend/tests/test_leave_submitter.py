"""Submission provenance is the original logged-in filer, not the leave subject."""

from __future__ import annotations

from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import (
    AuditLog,
    Book,
    BookCategory,
    BookVersion,
    Document,
    Employee,
    Leave,
    Submitter,
    User,
)
from app.db.session import get_db
from app.main import create_app


def _leave(db: Session, day: int = 1) -> Leave:
    row = Leave(
        employee_id="G100",
        leave_type="Annual Leave",
        start_date=date(2026, 11, day),
        end_date=date(2026, 11, day),
        days=1,
        status="Approved",
    )
    db.add(row)
    db.flush()
    return row


def _record(
    db: Session,
    leave: Leave,
    creator: User | None,
    *,
    template: str = "Leave Application Form",
    sequence: int = 1,
) -> Book:
    document = Document(
        employee_id=leave.employee_id,
        leave_id=leave.id,
        template_id=template,
        ref_number=f"HR-{leave.id}-{sequence}",
        submission_id=f"submission-{leave.id}-{sequence}",
        role="primary",
        created_at=datetime(2026, 10, sequence),
    )
    db.add(document)
    db.flush()
    book = Book(
        category_id="HR",
        ref_number=document.ref_number,
        employee_id=leave.employee_id,
        created_by_user_id=creator.id if creator else None,
    )
    db.add(book)
    db.flush()
    db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            document_id=document.id,
            template_id=template,
            trigger="initial",
            fields={"_signing": {"submitter_id": 1}},
            created_by_user_id=creator.id if creator else None,
        )
    )
    db.flush()
    return book


def _client(db: Session) -> tuple[TestClient, User, User]:
    db.add_all(
        [
            Employee(id="G100", name_en="Leave subject"),
            Employee(id="G200", name_en="Original filer"),
            Employee(id="G300", name_en="Viewer and reviser"),
            Employee(id="G400", name_en="Signature representative"),
            BookCategory(
                id="HR", name_en="Human resources", name_ar="الموارد البشرية", prefix="HR"
            ),
        ]
    )
    filer = User(
        email="filer@example.test",
        password_hash="x",
        employee_id="G200",
        role="operator",
        status="active",
    )
    viewer = User(
        email="viewer@example.test",
        password_hash="x",
        employee_id="G300",
        role="admin",
        status="active",
    )
    db.add_all(
        [filer, viewer, Submitter(id=1, employee_id="G400", name="Signature representative")]
    )
    db.flush()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: viewer
    return TestClient(app), filer, viewer


def test_list_and_detail_show_original_filer_not_subject_signer_or_reviser(api_db: Session) -> None:
    client, filer, viewer = _client(api_db)
    leave = _leave(api_db)
    book = _record(api_db, leave, filer)
    book.submitted_by_user_id = viewer.id
    # Even if the earliest surviving document belongs to a later version,
    # the immutable Record creator remains the original filer.
    api_db.query(BookVersion).filter_by(book_id=book.id).one().version_no = 3
    api_db.add(
        BookVersion(
            book_id=book.id,
            version_no=4,
            template_id="Leave Application Form",
            trigger="revise",
            fields={},
            created_by_user_id=viewer.id,
        )
    )
    _record(api_db, leave, viewer, template="Duty Resumption Form", sequence=2)
    api_db.commit()
    listing = client.get("/api/v1/leaves")
    assert listing.status_code == 200
    item = listing.json()["items"][0]
    assert item["employee_id"] == "G100"
    assert item["submitted_by_g"] == "G200"
    detail = client.get(f"/api/v1/leaves/{leave.id}")
    assert detail.status_code == 200
    assert detail.json()["submitted_by_g"] == "G200"
    # A decision response must not drop provenance from React Query's detail cache.
    updated = client.patch(f"/api/v1/leaves/{leave.id}", json={"notes": "Decision note"})
    assert updated.status_code == 200
    assert updated.json()["submitted_by_g"] == "G200"


@pytest.mark.parametrize(
    "missing", ["no_record", "no_creator", "unlinked_user", "missing_user", "return_only"]
)
def test_missing_provenance_never_falls_back_to_subject_viewer_or_email(
    api_db: Session, missing: str
) -> None:
    client, filer, viewer = _client(api_db)
    leave = _leave(api_db)
    if missing == "no_record":
        leave.leave_type = "National Service"
    if missing == "unlinked_user":
        filer.employee_id = None
    if missing not in {"no_record", "return_only"}:
        book = _record(api_db, leave, None if missing == "no_creator" else filer)
        if missing == "missing_user":
            book.created_by_user_id = 999999
    if missing == "return_only":
        _record(api_db, leave, viewer, template="Duty Resumption Form")
    # Historical email text may now belong to someone else, so it is not evidence.
    api_db.add(
        AuditLog(
            action="leave.created", entity_type="leave", entity_id=str(leave.id), actor=viewer.email
        )
    )
    api_db.commit()
    assert client.get("/api/v1/leaves").json()["items"][0]["submitted_by_g"] is None
    assert client.get(f"/api/v1/leaves/{leave.id}").json()["submitted_by_g"] is None


def test_page_resolves_provenance_in_one_query(api_db: Session) -> None:
    client, filer, _viewer = _client(api_db)
    for day in range(1, 8):
        _record(api_db, _leave(api_db, day), filer)
    api_db.commit()
    queries: list[str] = []

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        if "FROM documents" in statement and "users" in statement:
            queries.append(statement)

    engine = api_db.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.get("/api/v1/leaves")
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200
    assert len(response.json()["items"]) == 7
    assert {item["submitted_by_g"] for item in response.json()["items"]} == {"G200"}
    assert len(queries) == 1


def test_new_manual_leave_keeps_stable_actor_id_after_email_changes(api_db: Session) -> None:
    client, filer, viewer = _client(api_db)
    response = client.post(
        "/api/v1/leaves",
        json={
            "employee_id": "G100",
            "leave_type": "National Service",
            "start_date": "2026-11-01",
            "end_date": "2026-11-14",
        },
    )
    assert response.status_code == 201, response.text
    leave_id = response.json()["id"]
    assert response.json()["submitted_by_g"] == "G300"
    viewer.email = "renamed@example.test"
    api_db.flush()
    filer.email = "viewer@example.test"
    api_db.commit()
    manual_leave = api_db.get(Leave, leave_id)
    assert manual_leave is not None
    _record(api_db, manual_leave, filer, template="Duty Resumption Form", sequence=2)
    api_db.commit()
    assert client.get(f"/api/v1/leaves/{leave_id}").json()["submitted_by_g"] == "G300"
    assert client.get("/api/v1/leaves").json()["items"][0]["submitted_by_g"] == "G300"
    employee_rows = client.get("/api/v1/employees/G100/leaves")
    assert employee_rows.status_code == 200, employee_rows.text
    assert employee_rows.json()[0]["submitted_by_g"] == "G300"


def test_manual_actor_without_existing_linked_user_stays_unknown(api_db: Session) -> None:
    client, filer, _viewer = _client(api_db)
    filer.employee_id = None
    for day, user_id in ((1, filer.id), (2, 999999)):
        leave = _leave(api_db, day)
        leave.leave_type = "National Service"
        api_db.add(
            AuditLog(
                action="leave.created",
                entity_type="leave",
                entity_id=str(leave.id),
                actor="viewer@example.test",
                payload=f'{{"actor_user_id": {user_id}}}',
            )
        )
    api_db.commit()
    response = client.get("/api/v1/leaves")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 2
    assert all(item["submitted_by_g"] is None for item in response.json()["items"])
