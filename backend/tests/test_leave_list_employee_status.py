"""GET /api/v1/leaves carries each employee's working status.

The leave report's Staff filter (our staff vs loaned, ملحق) reads it from the
list rows, so a leave must report its own employee's status, not a default.
"""

from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Employee, Leave
from app.db.session import get_db
from app.main import create_app
from tests.conftest import make_user


def test_list_rows_carry_the_employee_status(api_db: Session) -> None:
    api_db.add(Employee(id="E1", name_en="Our Staff", status="Active"))
    api_db.add(Employee(id="E2", name_en="On Loan", status="Loaned"))
    for emp in ("E1", "E2"):
        api_db.add(
            Leave(
                employee_id=emp,
                leave_type="Sick Leave",
                start_date=date(2026, 3, 1),
                end_date=date(2026, 3, 2),
                status="Approved",
            )
        )
    api_db.commit()

    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: make_user(api_db, role="admin")
    r = TestClient(app).get("/api/v1/leaves")

    assert r.status_code == 200
    assert {i["employee_id"]: i["employee_status"] for i in r.json()["items"]} == {
        "E1": "Active",
        "E2": "Loaned",
    }
