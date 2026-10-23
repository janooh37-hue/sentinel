from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS
from app.db.models import (
    AppSetting,
    BookCategory,
    Department,
    DepartmentMember,
    DepartmentService,
    Employee,
    Leave,
    User,
    Violation,
)
from app.db.session import get_db
from app.main import create_app


@pytest.fixture()
def scoped_dashboard(api_db):
    root = Department(name_en="People", name_ar="الأفراد")
    outside = Department(name_en="Outside", name_ar="خارج")
    api_db.add_all([root, outside])
    api_db.flush()
    child = Department(name_en="Child", name_ar="فرع", parent_id=root.id)
    api_db.add(child)
    api_db.flush()
    employees = [
        Employee(id="IN", name_en="Inside", department_id=root.id),
        Employee(id="CHILD", name_en="Child", department_id=child.id, status="Loaned"),
        Employee(id="OUT", name_en="Outside", department_id=outside.id),
        Employee(id="OWN", name_en="Owner", department_id=outside.id),
        Employee(id="NULL", name_en="Unassigned"),
    ]
    api_db.add_all(employees)
    api_db.flush()
    user = User(
        email="scope-dashboard@test.ae",
        password_hash="x",
        role="manager",
        status="active",
        employee_id="OWN",
    )
    api_db.add(user)
    api_db.flush()
    api_db.add_all(
        [
            DepartmentMember(user_id=user.id, department_id=root.id, role="head", is_primary=True),
            AppSetting(key="settings.department_scoping_enabled", value="true"),
        ]
    )
    today = date.today()
    for employee in employees:
        api_db.add(
            Leave(
                employee_id=employee.id,
                leave_type="Annual Leave",
                start_date=today - timedelta(days=1),
                end_date=today + timedelta(days=2),
                days=4,
                status="Approved",
            )
        )
        api_db.add(Violation(employee_id=employee.id, violation_type="Warning", date=today))
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
                "role": "head",
                "is_primary": True,
            }
        ],
    }
    for department_id, employee_ids in (
        (root.id, {"IN", "CHILD"}),
        (child.id, {"CHILD"}),
        (outside.id, set()),
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
