"""ORG-tree API contracts."""

from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import (
    AuditLog,
    Employee,
    TimesheetDesignation,
    TimesheetRosterAssignment,
    User,
    UserPermission,
)
from app.db.session import get_db
from app.main import create_app


def _employee(
    employee_id: str,
    *,
    name: str,
    supervisor_id: str | None = None,
) -> Employee:
    return Employee(
        id=employee_id,
        name_en=name,
        name_ar=f"{name} Arabic",
        position="Guard",
        position_ar="حارس",
        department="Operations",
        duty_unit="North",
        duty_post="Gate 1",
        status="Active",
        supervisor_id=supervisor_id,
    )


def _user(db: Session, *, email: str, role: str = "operator") -> User:
    user = User(email=email, password_hash="x", role=role, status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def test_list_org_tree_returns_all_employees_and_denies_missing_view(api_db: Session) -> None:
    supervisor = _employee("G-002", name="Supervisor")
    report = _employee("G-001", name="Report", supervisor_id=supervisor.id)
    api_db.add_all([supervisor, report])
    api_db.commit()

    viewer = _user(api_db, email="tree-viewer@test.ae")
    response = _client(api_db, viewer).get("/api/v1/org-tree/")

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "id": "G-001",
            "name_en": "Report",
            "name_ar": "Report Arabic",
            "position": "Guard",
            "position_ar": "حارس",
            "department": "Operations",
            "duty_unit": "North",
            "duty_post": "Gate 1",
            "status": "Active",
            "supervisor_id": "G-002",
            "designation_en": None,
            "designation_ar": None,
            "rank_order": None,
        },
        {
            "id": "G-002",
            "name_en": "Supervisor",
            "name_ar": "Supervisor Arabic",
            "position": "Guard",
            "position_ar": "حارس",
            "department": "Operations",
            "duty_unit": "North",
            "duty_post": "Gate 1",
            "status": "Active",
            "supervisor_id": None,
            "designation_en": None,
            "designation_ar": None,
            "rank_order": None,
        },
    ]

    denied = _user(api_db, email="tree-denied@test.ae")
    api_db.add(UserPermission(user_id=denied.id, capability="employees.view", effect="deny"))
    api_db.commit()
    forbidden = _client(api_db, denied).get("/api/v1/org-tree/")
    assert forbidden.status_code == 403


def test_list_org_tree_returns_current_effective_designation_rank(api_db: Session) -> None:
    employee = _employee("G-001", name="Employee")
    current = TimesheetDesignation(
        name_en="Security Supervisor",
        name_ar="مشرف",
        rank_order=6,
        sheet="main",
        active=True,
    )
    future = TimesheetDesignation(
        name_en="Ass. Director",
        name_ar="نائب عام مدير الحراسات الأمنية",
        rank_order=2,
        sheet="main",
        active=True,
    )
    api_db.add_all([employee, current, future])
    api_db.flush()
    month_start = date.today().replace(day=1)
    next_month = date(
        month_start.year + month_start.month // 12,
        month_start.month % 12 + 1,
        1,
    )
    api_db.add_all(
        [
            TimesheetRosterAssignment(
                employee_id=employee.id,
                designation_id=current.id,
                effective_from=month_start,
            ),
            TimesheetRosterAssignment(
                employee_id=employee.id,
                designation_id=future.id,
                effective_from=next_month,
            ),
        ]
    )
    api_db.commit()

    viewer = _user(api_db, email="tree-rank-viewer@test.ae")
    response = _client(api_db, viewer).get("/api/v1/org-tree/")

    assert response.status_code == 200, response.text
    assert response.json()[0] == {
        "id": "G-001",
        "name_en": "Employee",
        "name_ar": "Employee Arabic",
        "position": "Guard",
        "position_ar": "حارس",
        "department": "Operations",
        "duty_unit": "North",
        "duty_post": "Gate 1",
        "status": "Active",
        "supervisor_id": None,
        "designation_en": "Security Supervisor",
        "designation_ar": "مشرف",
        "rank_order": 6,
    }


def test_set_supervisor_returns_current_effective_designation_rank(api_db: Session) -> None:
    employee = _employee("G-001", name="Employee")
    supervisor = _employee("G-002", name="Supervisor")
    designation = TimesheetDesignation(
        name_en="Security Supervisor",
        name_ar="مشرف",
        rank_order=6,
        sheet="main",
        active=True,
    )
    api_db.add_all([employee, supervisor, designation])
    api_db.flush()
    api_db.add(
        TimesheetRosterAssignment(
            employee_id=employee.id,
            designation_id=designation.id,
            effective_from=date.today().replace(day=1),
        )
    )
    api_db.commit()
    editor = _user(api_db, email="tree-rank-editor@test.ae", role="manager")

    response = _client(api_db, editor).patch(
        f"/api/v1/org-tree/{employee.id}/supervisor",
        json={"supervisor_id": supervisor.id},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["designation_en"], body["designation_ar"], body["rank_order"]) == (
        "Security Supervisor",
        "مشرف",
        6,
    )


def test_set_supervisor_returns_cleared_current_designation(api_db: Session) -> None:
    employee = _employee("G-001", name="Employee")
    supervisor = _employee("G-002", name="Supervisor")
    designation = TimesheetDesignation(
        name_en="Security Supervisor",
        name_ar="مشرف",
        rank_order=6,
        sheet="main",
        active=True,
    )
    api_db.add_all([employee, supervisor, designation])
    api_db.flush()
    api_db.add_all(
        [
            TimesheetRosterAssignment(
                employee_id=employee.id,
                designation_id=designation.id,
                effective_from=date(2020, 1, 1),
            ),
            TimesheetRosterAssignment(
                employee_id=employee.id,
                designation_id=None,
                effective_from=date.today().replace(day=1),
            ),
        ]
    )
    api_db.commit()
    editor = _user(api_db, email="tree-clear-editor@test.ae", role="manager")

    response = _client(api_db, editor).patch(
        f"/api/v1/org-tree/{employee.id}/supervisor",
        json={"supervisor_id": supervisor.id},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["designation_en"], body["designation_ar"], body["rank_order"]) == (
        None,
        None,
        None,
    )


def test_set_supervisor_links_employee_and_records_one_audit_row(api_db: Session) -> None:
    employee = _employee("G-001", name="Employee")
    supervisor = _employee("G-002", name="Supervisor")
    api_db.add_all([employee, supervisor])
    api_db.commit()
    editor = _user(api_db, email="tree-editor@test.ae", role="manager")

    response = _client(api_db, editor).patch(
        f"/api/v1/org-tree/{employee.id}/supervisor",
        json={"supervisor_id": supervisor.id},
    )

    assert response.status_code == 200, response.text
    assert response.json()["supervisor_id"] == supervisor.id
    audits = api_db.scalars(
        select(AuditLog).where(AuditLog.action == "org_tree.supervisor.changed")
    ).all()
    assert len(audits) == 1
    assert audits[0].actor == editor.email
    assert audits[0].entity_type == "employee"
    assert audits[0].entity_id == employee.id
    assert audits[0].payload == '{"before": null, "after": "G-002"}'


def test_set_supervisor_null_unlinks_employee(api_db: Session) -> None:
    supervisor = _employee("G-002", name="Supervisor")
    employee = _employee("G-001", name="Employee", supervisor_id=supervisor.id)
    api_db.add_all([supervisor, employee])
    api_db.commit()
    editor = _user(api_db, email="tree-unlink@test.ae", role="manager")

    response = _client(api_db, editor).patch(
        f"/api/v1/org-tree/{employee.id}/supervisor",
        json={"supervisor_id": None},
    )

    assert response.status_code == 200, response.text
    assert response.json()["supervisor_id"] is None
    assert api_db.get(Employee, employee.id).supervisor_id is None


def test_set_supervisor_rejects_self_link(api_db: Session) -> None:
    employee = _employee("G-001", name="Employee")
    api_db.add(employee)
    api_db.commit()
    editor = _user(api_db, email="tree-self@test.ae", role="manager")

    response = _client(api_db, editor).patch(
        f"/api/v1/org-tree/{employee.id}/supervisor",
        json={"supervisor_id": employee.id},
    )

    assert response.status_code == 400
    assert response.json()["error"]["message"] == "An employee cannot supervise themselves"


def test_set_supervisor_rejects_unknown_employee(api_db: Session) -> None:
    editor = _user(api_db, email="tree-missing-employee@test.ae", role="manager")

    response = _client(api_db, editor).patch(
        "/api/v1/org-tree/G-404/supervisor",
        json={"supervisor_id": None},
    )

    assert response.status_code == 404
    assert response.json()["error"]["message"] == "Employee not found"


def test_set_supervisor_rejects_unknown_supervisor(api_db: Session) -> None:
    employee = _employee("G-001", name="Employee")
    api_db.add(employee)
    api_db.commit()
    editor = _user(api_db, email="tree-missing-supervisor@test.ae", role="manager")

    response = _client(api_db, editor).patch(
        f"/api/v1/org-tree/{employee.id}/supervisor",
        json={"supervisor_id": "G-404"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["message"] == "Supervisor not found"


def test_set_supervisor_rejects_cycle(api_db: Session) -> None:
    manager = _employee("G-001", name="Manager")
    report = _employee("G-002", name="Report", supervisor_id=manager.id)
    api_db.add_all([manager, report])
    api_db.commit()
    editor = _user(api_db, email="tree-cycle@test.ae", role="manager")

    response = _client(api_db, editor).patch(
        f"/api/v1/org-tree/{manager.id}/supervisor",
        json={"supervisor_id": report.id},
    )

    assert response.status_code == 409
    assert response.json()["error"]["message"] == "Report already reports to Manager"


def test_set_supervisor_denies_viewer_without_edit(api_db: Session) -> None:
    employee = _employee("G-001", name="Employee")
    supervisor = _employee("G-002", name="Supervisor")
    api_db.add_all([employee, supervisor])
    api_db.commit()
    viewer = _user(api_db, email="tree-readonly@test.ae")

    response = _client(api_db, viewer).patch(
        f"/api/v1/org-tree/{employee.id}/supervisor",
        json={"supervisor_id": supervisor.id},
    )

    assert response.status_code == 403
    assert api_db.get(Employee, employee.id).supervisor_id is None
