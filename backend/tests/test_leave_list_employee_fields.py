"""GET /api/v1/leaves carries each employee's working status and duty unit.

The leave report filters by staff (our staff vs loaned, ملحق) and totals days
by duty unit straight from the list rows, so each leave must report its own
employee's values, not a default.
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Employee, Leave, User
from app.db.session import get_db
from app.main import create_app
from tests.conftest import make_user


def test_list_rows_carry_the_employee_status_and_duty_unit(api_db: Session) -> None:
    api_db.add(Employee(id="E1", name_en="Our Staff", status="Active", duty_unit="السرية الأولى"))
    api_db.add(Employee(id="E2", name_en="On Loan", status="Loaned", duty_unit=None))
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
    assert {
        i["employee_id"]: (i["employee_status"], i["employee_duty_unit"]) for i in r.json()["items"]
    } == {
        "E1": ("Active", "السرية الأولى"),
        "E2": ("Loaned", None),
    }


def test_leave_overlap_and_end_date_filters_are_inclusive_and_compose(api_db: Session) -> None:
    db = api_db
    user = User(email="leave-filters@x.ae", password_hash="x", role="admin", status="active")
    db.add_all([user, Employee(id="G1", name_en="Employee", status="Active")])
    db.flush()
    ids = {}
    for label, start, end, status, deleted in [
        ("ends_today", date(2026, 10, 1), date(2026, 10, 24), "Approved", False),
        ("starts_today", date(2026, 10, 24), date(2026, 10, 31), "Approved", False),
        ("spans_today", date(2026, 10, 22), date(2026, 10, 26), "Approved", False),
        ("future", date(2026, 10, 25), date(2026, 10, 30), "Approved", False),
        ("past", date(2026, 10, 1), date(2026, 10, 23), "Approved", False),
        ("pending", date(2026, 10, 24), date(2026, 10, 24), "Pending", False),
        ("deleted", date(2026, 10, 24), date(2026, 10, 24), "Approved", True),
    ]:
        row = Leave(
            employee_id="G1",
            leave_type="Annual Leave",
            start_date=start,
            end_date=end,
            status=status,
            deleted_at=datetime(2026, 10, 24) if deleted else None,
        )
        db.add(row)
        db.flush()
        ids[label] = row.id
    db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    for params, labels in [
        ({"on_date": "2026-10-24"}, {"ends_today", "starts_today", "spans_today"}),
        ({"end_from": "2026-10-24"}, {"ends_today", "starts_today", "spans_today", "future"}),
        ({"end_to": "2026-10-24"}, {"ends_today", "past"}),
        (
            {"end_from": "2026-10-24", "end_to": "2026-10-31"},
            {"ends_today", "starts_today", "spans_today", "future"},
        ),
        ({"end_from": "2026-10-24", "end_to": "2026-10-24"}, {"ends_today"}),
        ({"on_date": "2026-10-24", "end_to": "2026-10-26"}, {"ends_today", "spans_today"}),
        # Existing from/to still mean start day, rather than silently changing.
        ({"on_date": "2026-10-24", "from_date": "2026-10-24"}, {"starts_today"}),
    ]:
        response = client.get("/api/v1/leaves", params={"status": "Approved", **params})
        assert response.status_code == 200, response.text
        assert {row["id"] for row in response.json()["items"]} == {ids[label] for label in labels}
        assert response.json()["total"] == len(labels)
    unscoped = client.get("/api/v1/leaves", params={"on_date": "2026-10-24"})
    assert ids["pending"] in {row["id"] for row in unscoped.json()["items"]}
    deleted = client.get(
        "/api/v1/leaves", params={"on_date": "2026-10-24", "include_deleted": True}
    )
    assert ids["deleted"] in {row["id"] for row in deleted.json()["items"]}
    paged = client.get(
        "/api/v1/leaves", params={"on_date": "2026-10-24", "status": "Approved", "limit": 1}
    )
    assert paged.json()["total"] == 3
    assert len(paged.json()["items"]) == 1
    for field in ["on_date", "end_from", "end_to"]:
        assert client.get("/api/v1/leaves", params={field: "not-a-date"}).status_code == 422
