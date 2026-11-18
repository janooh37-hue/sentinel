"""Vehicle dialogs find the driver or responsible employee by G number or name and
learn only the G number and names; a fleet reporter can use it."""

from __future__ import annotations

from app.db.models import Employee
from tests.fleet_support import FleetEnv


def test_fleet_reporter_finds_employees_by_name_or_g_number(fleet_env: FleetEnv) -> None:
    client = fleet_env.client(fleet_env.reporter)
    by_name = client.get("/api/v1/vehicles/employees", params={"q": "Fined"})
    assert by_name.status_code == 200, by_name.text
    assert by_name.json()["items"] == [
        {"id": "G7401", "name_en": "Fined Driver", "name_ar": "Fined Driver"}
    ]
    by_g = client.get("/api/v1/vehicles/employees", params={"q": "G7401"})
    assert [item["id"] for item in by_g.json()["items"]] == ["G7401"]

    one = client.get("/api/v1/vehicles/employees/G7401")
    assert one.status_code == 200, one.text
    assert one.json() == {"id": "G7401", "name_en": "Fined Driver", "name_ar": "Fined Driver"}


def test_identity_documents_are_not_searchable(fleet_env: FleetEnv) -> None:
    employee = fleet_env.db.get(Employee, "G7401")
    assert employee is not None
    employee.passport_no = "P9988776"
    employee.uae_id_no = "784-1990-1234567-1"
    fleet_env.db.commit()
    client = fleet_env.client(fleet_env.reporter)
    for q in ("P9988776", "784-1990"):
        response = client.get("/api/v1/vehicles/employees", params={"q": q})
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 0


def test_fleet_reporter_still_has_no_general_employee_lookup(fleet_env: FleetEnv) -> None:
    response = fleet_env.client(fleet_env.reporter).get("/api/v1/employees/lookup")
    assert response.status_code == 403, response.text


def test_vehicle_employee_search_needs_vehicles_edit(fleet_env: FleetEnv) -> None:
    client = fleet_env.client(fleet_env.operator)
    for path in ("/api/v1/vehicles/employees", "/api/v1/vehicles/employees/G7401"):
        response = client.get(path)
        assert response.status_code == 403, response.text
        assert response.json()["error"]["details"]["capability"] == "vehicles.edit"
