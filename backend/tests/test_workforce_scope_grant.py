"""Attendance capabilities authorize actions; explicit scope widens employee visibility."""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from app.services import perm_service
from tests.factories.attendance import build_attendance_day
from tests.test_workforce_api_permissions import _client, _scope, _user


@pytest.mark.parametrize("grant_via_api", [False, True], ids=["stored-scope", "scope-api"])
def test_organization_scope_widens_attendance_day_for_non_admin(
    api_db: Session, grant_via_api: bool
) -> None:
    operational_date = date(2026, 8, 19)
    fixture = build_attendance_day(
        api_db, operational_date=operational_date, posts=[("Gate 1", 1), ("Gate 2", 1)]
    )
    own_employee, other_employee = fixture.employees
    reviewer = _user(api_db, email="attendance-reviewer@test.ae", employee_id=own_employee.id)
    for capability in ("workforce.people.view", "workforce.attendance.review"):
        perm_service.set_user_override(api_db, reviewer.id, capability, "grant")
    client = _client(api_db, reviewer)
    params = {"operational_date": operational_date.isoformat()}

    before = client.get("/api/v1/workforce/attendance/day", params=params)
    assert before.status_code == 200, before.text
    assert {row["employee_id"] for row in before.json()["items"]} == {own_employee.id}

    if grant_via_api:
        administrator = _client(api_db, fixture.admin)
        path = f"/api/v1/workforce/access/users/{reviewer.id}/scopes"
        current = administrator.get(path)
        assert current.status_code == 200, current.text
        assert current.json()["scopes"] == []
        granted = administrator.put(
            path,
            json={"scopes": [{"scope_kind": "organization"}]},
            headers={"If-Match": current.headers["etag"]},
        )
        assert granted.status_code == 200, granted.text
    else:
        _scope(api_db, reviewer, kind="organization")

    after = client.get("/api/v1/workforce/attendance/day", params=params)
    assert after.status_code == 200, after.text
    assert {row["employee_id"] for row in after.json()["items"]} == {
        own_employee.id,
        other_employee.id,
    }
