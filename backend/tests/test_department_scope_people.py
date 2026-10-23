"""Department visibility at the leave, absence, expiry and org-tree API seams."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import (
    Absence,
    Leave,
    User,
    UserPermission,
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
def people(api_db: Session):
    today = date.today()
    employees = [
        employee(
            api_db,
            employee_id,
            supervisor,
            status="Active",
            passport_expiry=today + timedelta(days=7),
        )
        for employee_id, supervisor in [
            ("VISIBLE", None),
            ("CHILD", "VISIBLE"),
            ("HIDDEN", None),
            ("OWN", "HIDDEN"),
            ("REPORT", "OWN"),
            ("GRANDREPORT", "REPORT"),
            ("UNASSIGNED", None),
        ]
    ]
    root = department(api_db, "Operations", "VISIBLE", name_ar="العمليات")
    child = department(api_db, "Team", "CHILD", name_ar="الفريق")
    other = department(api_db, "Other", "HIDDEN", name_ar="أخرى")
    # Branch visibility ignores department boundaries, including a NULL exception.
    exception(api_db, "REPORT", None)
    exception(api_db, "GRANDREPORT", child.id)
    user = User(
        email="scope-people@test.ae",
        password_hash="x",
        role="manager",
        status="active",
    )
    api_db.add(user)
    link(api_db, user, "OWN")
    grant(api_db, root.id, user, "deputy")
    enable_scoping(api_db)
    api_db.add_all(
        [
            UserPermission(user_id=user.id, capability=capability, effect="grant")
            for capability in [
                "leaves.view",
                "leaves.create",
                "leaves.edit",
                "leaves.delete",
                "employees.view",
                "employees.edit",
                "expiry.view",
            ]
        ]
    )
    for person in employees:
        api_db.add(
            Leave(
                employee_id=person.id,
                leave_type="Annual Leave",
                status="Approved",
                start_date=today - timedelta(days=5),
                end_date=today - timedelta(days=2),
                days=4,
            )
        )
        api_db.add(Absence(employee_id=person.id, date=today - timedelta(days=10)))
    api_db.commit()
    hidden_leave = next(row for row in api_db.query(Leave).all() if row.employee_id == "HIDDEN")
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app), root.id, child.id, other.id, hidden_leave.id


@pytest.mark.parametrize(
    "path,collection,id_key",
    [
        ("/leaves", "items", "employee_id"),
        ("/absences/episodes", "rows", "employee_id"),
        ("/expiry", None, "employee_id"),
        ("/org-tree/", None, "id"),
    ],
)
def test_people_lists_scope_and_descendant_filters(people, path, collection, id_key):
    client, root, child, other, _ = people
    for department_id, expected in [
        (None, {"VISIBLE", "CHILD", "OWN", "REPORT", "GRANDREPORT"}),
        (root, {"VISIBLE", "CHILD", "GRANDREPORT"}),
        (child, {"CHILD", "GRANDREPORT"}),
        (other, {"OWN"}),
        (999999, set()),
    ]:
        response = client.get(
            f"/api/v1{path}",
            params={}
            if department_id is None
            else {
                "department_id": department_id,
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        rows = body[collection] if collection else body
        assert {row[id_key] for row in rows} == expected
        if collection == "items":
            assert body["total"] == len(expected)


@pytest.mark.parametrize(
    "path,key",
    [
        ("/leaves/awaiting-return/count", "count"),
        ("/expiry/summary", "urgent"),
    ],
)
def test_people_counts_scope_and_descendant_filters(people, path, key):
    client, root, child, other, _ = people
    for department_id, expected in [(None, 5), (root, 3), (child, 2), (other, 1), (999999, 0)]:
        response = client.get(
            f"/api/v1{path}",
            params={}
            if department_id is None
            else {
                "department_id": department_id,
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()[key] == expected
        if key == "urgent":
            assert response.json() == {"expired": 0, "critical": expected, "urgent": expected}


@pytest.mark.parametrize(
    "method,suffix,kwargs",
    [
        ("get", "", {}),
        ("patch", "", {"json": {"notes": "Changed"}}),
        ("delete", "", {}),
        ("post", "/amend", {"json": {"end_date": "2026-12-01", "reason": "Change"}}),
        ("post", "/return", {"json": {"resumption_date": "2026-12-01"}}),
        ("get", "/certificate", {}),
        (
            "post",
            "/certificate",
            {"files": {"file": ("certificate.pdf", b"pdf", "application/pdf")}},
        ),
    ],
)
def test_every_leave_object_route_hides_outside_like_missing(people, method, suffix, kwargs):
    client, _, _, _, hidden_leave = people
    hidden = getattr(client, method)(f"/api/v1/leaves/{hidden_leave}{suffix}", **kwargs)
    missing = getattr(client, method)(f"/api/v1/leaves/999999{suffix}", **kwargs)
    assert hidden.status_code == missing.status_code == 404
    assert hidden.json()["error"]["code"] == missing.json()["error"]["code"] == "LEAVE_NOT_FOUND"


@pytest.mark.parametrize("employee_id", ["HIDDEN", "UNASSIGNED", "MISSING"])
def test_leave_creation_hides_outside_body_employee(people, employee_id):
    client, *_ = people
    response = client.post(
        "/api/v1/leaves",
        json={
            "employee_id": employee_id,
            "leave_type": "National Service",
            "start_date": "2026-12-01",
            "end_date": "2026-12-05",
        },
    )
    assert response.status_code == 404, response.text


@pytest.mark.parametrize(
    "employee_id,supervisor_id",
    [
        ("HIDDEN", None),
        ("MISSING", None),
        ("VISIBLE", "HIDDEN"),
        ("VISIBLE", "UNASSIGNED"),
        ("VISIBLE", "MISSING"),
    ],
)
def test_org_tree_hides_outside_employee_and_supervisor(people, employee_id, supervisor_id):
    client, *_ = people
    response = client.patch(
        f"/api/v1/org-tree/{employee_id}/supervisor", json={"supervisor_id": supervisor_id}
    )
    assert response.status_code == 404, response.text


def test_org_tree_allows_visible_supervisor_and_clearing(people):
    client, *_ = people
    for supervisor_id in ["OWN", None]:
        response = client.patch(
            "/api/v1/org-tree/VISIBLE/supervisor", json={"supervisor_id": supervisor_id}
        )
        assert response.status_code == 200, response.text
        assert response.json()["supervisor_id"] == supervisor_id
