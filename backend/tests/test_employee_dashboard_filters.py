from datetime import date

from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db.models import Employee, User, Violation
from app.db.session import get_db
from app.main import create_app
from app.services import employee_service


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
