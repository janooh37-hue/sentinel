from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
from app.db.models import (
    BookCategory,
    DepartmentService,
    Employee,
    Leave,
    User,
    Violation,
)
from app.db.session import get_db
from app.main import create_app
from tests.department_fixtures import (
    department,
    employee,
    enable_scoping,
    exception,
    grant,
    link,
)


@pytest.fixture()
def scoped_dashboard(api_db):
    employees = [
        employee(api_db, "IN", name_en="Inside"),
        employee(api_db, "CHILD", supervisor="IN", name_en="Child", status="Loaned"),
        employee(api_db, "OUT", name_en="Outside"),
        employee(api_db, "OWN", supervisor="OUT", name_en="Owner"),
        employee(api_db, "NULL", name_en="Unassigned"),
    ]
    root = department(api_db, "People", "IN", name_ar="الأفراد")
    child = department(api_db, "Child", "CHILD", name_ar="فرع")
    outside = department(api_db, "Outside", "OUT", name_ar="خارج")
    assert child.parent_id == root.id
    user = User(
        email="scope-dashboard@test.ae",
        password_hash="x",
        role="manager",
        status="active",
        employee_id="OWN",
    )
    api_db.add(user)
    api_db.flush()
    link(api_db, user, "OWN")
    grant(api_db, root.id, user, "deputy")
    enable_scoping(api_db)
    today = date.today()
    for person in employees:
        api_db.add(
            Leave(
                employee_id=person.id,
                leave_type="Annual Leave",
                start_date=today - timedelta(days=1),
                end_date=today + timedelta(days=2),
                days=4,
                status="Approved",
            )
        )
        api_db.add(Violation(employee_id=person.id, violation_type="Warning", date=today))
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        yield api_db, client, user, root, child, outside
    app.dependency_overrides.clear()


def test_dashboard_people_scope_metadata_and_department_narrowing(scoped_dashboard):
    db, client, user, root, child, outside = scoped_dashboard
    response = client.get("/api/v1/dashboard/summary")
    assert response.status_code == 200
    data = response.json()
    assert {
        key: data["totals"][key]
        for key in (
            "employees_active",
            "our_staff",
            "loaned",
            "on_leave_today",
            "present_today",
            "open_violations_count",
        )
    } == {
        "employees_active": 3,
        "our_staff": 2,
        "loaned": 1,
        "on_leave_today": 2,
        "present_today": 0,
        "open_violations_count": 3,
    }
    assert {item["employee_id"] for item in data["on_leave_today"]} == {"IN", "CHILD", "OWN"}
    assert {item["employee_id"] for item in data["upcoming_leave_ends"]} == {"IN", "CHILD", "OWN"}
    assert data["department_scope"] == {
        "kind": "department",
        "departments": [
            {
                "department_id": root.id,
                "name_en": root.name_en,
                "name_ar": root.name_ar,
                "role": "deputy",
            },
            {
                "department_id": outside.id,
                "name_en": outside.name_en,
                "name_ar": outside.name_ar,
                "role": "member",
            },
        ],
    }
    for department_id, employee_ids in (
        (root.id, {"IN", "CHILD"}),
        (child.id, {"CHILD"}),
        (outside.id, {"OWN"}),
    ):
        narrowed = client.get("/api/v1/dashboard/summary", params={"department_id": department_id})
        assert narrowed.status_code == 200
        body = narrowed.json()
        assert body["totals"]["employees_active"] == len(employee_ids)
        assert body["totals"]["open_violations_count"] == len(employee_ids)
        assert {item["employee_id"] for item in body["on_leave_today"]} == employee_ids
        assert body["department_scope"] == data["department_scope"]
    user.role = "admin"
    user._effective_caps_cache = None
    user._department_scope_cache = None
    db.commit()
    organization = client.get(
        "/api/v1/dashboard/summary", params={"department_id": child.id}
    ).json()
    assert organization["totals"]["employees_active"] == 1
    assert organization["department_scope"]["kind"] == "organization"


@pytest.mark.parametrize(
    "has_reports,expected_kind,expected_ids",
    [(False, "self", {"OWN"}), (True, "branch", {"OWN", "NULL"})],
)
def test_dashboard_scope_kind_tracks_supervisor_branch(
    scoped_dashboard, has_reports, expected_kind, expected_ids
):
    from sqlalchemy import delete

    from app.db.models import DepartmentMember

    db, client, user, _, _, _ = scoped_dashboard
    db.execute(delete(DepartmentMember).where(DepartmentMember.user_id == user.id))
    if has_reports:
        db.get(Employee, "NULL").supervisor_id = "OWN"
        # A report outside all departments still belongs to the supervisor's
        # visible branch.
        exception(db, "NULL", None)
    user._department_scope_cache = None
    user._effective_caps_cache = None
    db.commit()
    response = client.get("/api/v1/dashboard/summary")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["department_scope"]["kind"] == expected_kind
    assert body["totals"]["employees_active"] == len(expected_ids)
    assert body["totals"]["open_violations_count"] == len(expected_ids)
    assert {row["employee_id"] for row in body["on_leave_today"]} == expected_ids


def test_notification_leave_counts_only_include_visible_people(scoped_dashboard):
    from app.services import notification_service

    db, _, user, _, _, _ = scoped_dashboard
    for employee_id in ("IN", "CHILD", "OWN", "OUT", "NULL"):
        db.add(
            Leave(
                employee_id=employee_id,
                leave_type="Annual Leave",
                start_date=date.today(),
                end_date=date.today(),
                days=1,
                status="Pending",
            )
        )
    db.commit()
    assert notification_service.relevant_counts(db, user).leaves == 3


@pytest.mark.parametrize("route", ["/api/v1/intake", "/api/v1/extractions"])
def test_intake_and_extraction_cannot_match_outside_employee(scoped_dashboard, route):
    db, client, _, _, _, _ = scoped_dashboard
    outside = db.get(Employee, "OUT")
    outside.name_en = "LAYLA HASSAN"
    outside.uae_id_no = "784-1990-1234567-1"
    db.commit()
    raw = (
        Path(__file__).resolve().parent / "fixtures/scan_triage/external-multi-signal.pdf"
    ).read_bytes()
    response = client.post(route, files={"file": ("identity.pdf", raw, "application/pdf")})
    assert response.status_code == 200, response.text
    assert response.json()["matched_employee_id"] is None
    assert response.json()["matched_employee_name_en"] is None


def test_scan_inbox_candidates_use_owners_department_scope(scoped_dashboard, tmp_path, monkeypatch):
    from app.services import scan_inbox_service

    db, _, user, _, _, _ = scoped_dashboard
    outside = db.get(Employee, "OUT")
    outside.name_en = "LAYLA AHMED"
    db.commit()
    monkeypatch.setattr(
        scan_inbox_service, "get_settings", lambda: SimpleNamespace(data_dir=tmp_path)
    )
    raw = (
        Path(__file__).resolve().parent / "fixtures/scan_triage/external-multi-signal.pdf"
    ).read_bytes()
    source = tmp_path / "identity.pdf"
    source.write_bytes(raw)
    item = scan_inbox_service.enqueue_email_attachment(
        db,
        ledger_entry_id=None,
        owner_user_id=user.id,
        rel_path="identity.pdf",
        filename="identity.pdf",
        data=raw,
        is_inline=False,
    )
    db.commit()
    assert scan_inbox_service.drain_pending(db) == 1
    assert item.state == "unrouted"
    assert item.proposed_employee_id is None
    assert item.candidates == []


def test_document_generation_hides_outside_and_missing_employees(scoped_dashboard, monkeypatch):
    from sqlalchemy.orm import sessionmaker

    from app.api.v1 import documents

    db, client, _, root, _, _ = scoped_dashboard
    db.add(BookCategory(id="HR", name_en="People", name_ar="الأفراد", prefix="HR"))
    # Department scoping offers no services until the department has a list (D10).
    db.add_all(
        DepartmentService(department_id=root.id, service_id=service_id)
        for service_id in (*SERVICE_IDS, OTHER_SERVICE_ID)
    )
    db.commit()
    monkeypatch.setattr(documents, "SessionLocal", sessionmaker(bind=db.get_bind()))
    for employee_id in ("OUT", "MISSING"):
        response = client.post(
            "/api/v1/documents/generate",
            json={
                "employee_id": employee_id,
                "template_id": "scope-test-unknown-template",
            },
        )
        assert response.status_code == 404, response.text
        assert response.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"
    optional_employee = client.post(
        "/api/v1/documents/generate",
        json={
            "template_id": "scope-test-unknown-template",
        },
    )
    assert optional_employee.status_code == 202, optional_employee.text
