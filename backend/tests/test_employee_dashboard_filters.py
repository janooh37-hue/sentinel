from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.core import clock
from app.db.models import Employee, Leave, User, Violation
from app.db.session import get_db
from app.main import create_app
from app.services import dashboard_service, employee_service, perm_service


def test_employee_dashboard_filters_compose_and_do_not_duplicate_employees(api_db):
    db = api_db
    user = User(email="employees@x.ae", password_hash="x", role="admin", status="active")
    db.add_all(
        [
            user,
            Employee(
                id="G1",
                name_en="Mohammed Farsi",
                status="Active",
                pending_status="Resigned",
                end_date=date(2026, 10, 30),
            ),
            Employee(id="G2", name_en="Mohammed Farsi", status="Loaned"),
            Employee(id="G3", name_en="Mohammed Farsi", status="Active"),
        ]
    )
    db.flush()
    db.add_all(
        [
            Violation(
                employee_id=employee_id,
                violation_type="type",
                date=date(2026, 10, 23),
                status=status,
            )
            for employee_id, status in [
                ("G1", "Open"),
                ("G1", "Open"),
                ("G2", "Open"),
                ("G3", "Closed"),
            ]
        ]
    )
    db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    for params, expected in [
        ({"status": "Active"}, {"G1", "G3"}),
        ({"status": "Loaned"}, {"G2"}),
        ({"pending": True}, {"G1"}),
        ({"open_violations": True}, {"G1", "G2"}),
        ({"status": "Active", "pending": True, "open_violations": True}, {"G1"}),
    ]:
        response = client.get("/api/v1/employees", params=params)
        assert response.status_code == 200, response.text
        assert {row["id"] for row in response.json()["items"]} == expected
        assert response.json()["total"] == len(expected)
    # Exact search has no hit; its fuzzy fallback must retain the same scope.
    rows, total = employee_service.list_employees(
        db, q="Mohamad Farsi", status="Active", open_violations=True
    )
    assert [row.id for row in rows] == ["G1"]
    assert total == 1


def test_presence_working_and_on_leave_match_dashboard_headcounts(api_db, monkeypatch):
    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            # Dubai is already on the next calendar day.
            return datetime(2026, 10, 23, 21, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(clock, "datetime", FixedDatetime)
    today = date(2026, 10, 24)
    db = api_db
    user = User(email="presence@x.ae", password_hash="x", role="admin", status="active")
    db.add(user)
    for index in range(1, 11):
        db.add(
            Employee(
                id=f"G{index}",
                name_en="Mohammed Farsi",
                status="Loaned" if index == 8 else "Resigned" if index == 9 else "Active",
            )
        )
    db.flush()
    for employee_id, start, end, status, deleted in [
        ("G2", today - timedelta(days=3), today, "Approved", False),
        ("G3", today, today + timedelta(days=3), "Approved", False),
        ("G4", today, today, "Approved", True),
        ("G5", today, today, "Pending", False),
        ("G6", today - timedelta(days=3), today - timedelta(days=1), "Approved", False),
        ("G7", today + timedelta(days=1), today + timedelta(days=3), "Approved", False),
        ("G8", today, today, "Approved", False),
        ("G10", today, today, "Approved", False),
        ("G10", today - timedelta(days=1), today + timedelta(days=1), "Approved", False),
    ]:
        db.add(
            Leave(
                employee_id=employee_id,
                leave_type="Annual Leave",
                start_date=start,
                end_date=end,
                status=status,
                deleted_at=datetime(2026, 10, 23) if deleted else None,
            )
        )
    db.add(Violation(employee_id="G2", violation_type="type", date=today, status="Open"))
    db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    totals = dashboard_service._compute_totals(db, today=today)
    for params, expected, total in [
        ({"working": True}, {f"G{i}" for i in range(1, 11) if i != 9}, totals.employees_active),
        ({"present": True}, {"G1", "G4", "G5", "G6", "G7"}, totals.present_today),
        ({"on_leave": True}, {"G2", "G3", "G10"}, totals.on_leave_today),
        ({"working": True, "present": True}, {"G1", "G4", "G5", "G6", "G7"}, totals.present_today),
        ({"working": True, "on_leave": True}, {"G2", "G3", "G10"}, totals.on_leave_today),
        ({"present": True, "on_leave": True}, set(), 0),
        ({"present": True, "status": "Loaned"}, set(), 0),
        ({"present": True, "open_violations": True}, set(), 0),
        ({"on_leave": True, "open_violations": True}, {"G2"}, 1),
    ]:
        response = client.get("/api/v1/employees", params=params)
        assert response.status_code == 200, response.text
        assert {row["id"] for row in response.json()["items"]} == expected
        assert response.json()["total"] == total == len(expected)
    paged = client.get("/api/v1/employees", params={"working": True, "limit": 2, "offset": 1})
    assert paged.json()["total"] == totals.employees_active
    assert len(paged.json()["items"]) == 2
    for filters, expected in [
        ({"present": True}, {"G1", "G4", "G5", "G6", "G7"}),
        ({"on_leave": True}, {"G2", "G3", "G10"}),
        ({"working": True}, {f"G{i}" for i in range(1, 11) if i != 9}),
    ]:
        rows, total = employee_service.list_employees(db, q="Mohamad Farsi", **filters)
        assert {row.id for row in rows} == expected
        assert total == len(expected)


@pytest.mark.parametrize(
    ("params", "capability"),
    [
        ({"open_violations": True}, "violations.view"),
        ({"present": True}, "leaves.view"),
        ({"on_leave": True}, "leaves.view"),
        ({"present": True, "open_violations": True}, "violations.view"),
        ({"present": True, "open_violations": True}, "leaves.view"),
    ],
)
def test_employee_dashboard_filters_require_source_capability(api_db, params, capability):
    user = User(email="filtered-employees@x.ae", password_hash="x", role="manager", status="active")
    api_db.add(user)
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    allowed = client.get("/api/v1/employees", params=params)
    assert allowed.status_code == 200, allowed.text

    perm_service.set_user_override(api_db, user.id, capability, "deny")
    denied = client.get("/api/v1/employees", params=params)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "FORBIDDEN"
    assert denied.json()["error"]["details"]["capability"] == capability

    unfiltered = client.get("/api/v1/employees")
    assert unfiltered.status_code == 200, unfiltered.text
    disabled = client.get(
        "/api/v1/employees",
        params={"open_violations": False, "present": False, "on_leave": False},
    )
    assert disabled.status_code == 200, disabled.text
