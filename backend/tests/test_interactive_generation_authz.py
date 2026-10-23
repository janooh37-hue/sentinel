"""Every interactive publication entrance honors the Records generation policy."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.db.models import (
    AuditLog, Book, BookCategory, Document, GeneralBookRecipient, Leave,
    UserPermission, VehicleMaintenanceRequest,
)
from app.db.session import get_db
from app.main import create_app
from app.services import settings_service
from tests.test_vehicle_letters import gen_env  # noqa: F401

@pytest.fixture()
def db_session(api_db):
    return api_db


CASES = [
    ("return", "HR", "Duty Resumption Form"),
    ("fines", "VF", "Vehicle Fines"),
    ("accident", "VA", "Vehicle Accident Report"),
    ("mileage", "GS", "Vehicle Mileage Log"),
    ("maintenance", "GS", "General Book"),
]


@pytest.mark.parametrize(("entrance", "category", "service"), CASES)
@pytest.mark.parametrize("denied", ["documents.generate", "books.view", "category", "service", "classification"])
def test_publication_denial_is_atomic_and_authorized_actor_succeeds(
    gen_env, entrance, category, service, denied, monkeypatch
):
    if denied == "classification" and entrance != "maintenance":
        pytest.skip("Only the General Book entrance applies classification authorization")
    env = gen_env
    db = env.db
    db.add(UserPermission(user_id=env.user.id, capability="vehicles.edit", effect="grant"))
    env.user.role = "manager"
    if db.get(BookCategory, "HR") is None:
        db.add(BookCategory(id="HR", prefix="HR"))
    leave = Leave(
        employee_id=env.employees[0].id, leave_type="Annual Leave",
        start_date=date(2026, 8, 1), end_date=date(2026, 8, 7), days=7, status="Approved",
    )
    contractor = GeneralBookRecipient(name="Synthetic workshop")
    db.add_all([leave, contractor])
    db.flush()
    monkeypatch.setattr(settings_service, "get_vehicle_maintenance_contractor_id", lambda db: contractor.id)
    capability = {
        "category": f"books.category.{category}",
        "service": f"books.service.{service}",
        "classification": "books.category.11/1",
    }.get(denied, denied)
    override = UserPermission(user_id=env.user.id, capability=capability, effect="deny")
    db.add(override)
    db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: env.user
    client = TestClient(app)
    routes = {
        "return": (f"/leaves/{leave.id}/return", {"resumption_date": "2026-08-08"}),
        "fines": (f"/vehicles/{env.vehicle.id}/fines/letter", {"fine_ids": [env.fines[0].id]}),
        "accident": (f"/vehicles/{env.vehicle.id}/accidents/{env.accident.id}/letter", {}),
        "mileage": ("/vehicles/odometer/form", {"month": "2026-08", "vehicle_ids": [env.vehicle.id]}),
        "maintenance": (f"/vehicles/{env.vehicle.id}/maintenance-requests", {"type": "repair", "description": "Synthetic repair"}),
    }
    path, payload = routes[entrance]

    def snapshot():
        db.expire_all()
        return (
            tuple(db.scalar(select(func.count()).select_from(model)) for model in (Book, Document, VehicleMaintenanceRequest, AuditLog)),
            leave.status, leave.return_date, leave.return_doc_path, env.accident.letter_book_id,
            tuple(sorted(str(p) for p in env.settings.data_dir.rglob("*") if p.is_file())),
        )

    before = snapshot()
    response = client.post(f"/api/v1{path}", json=payload)
    assert response.status_code == 403, response.text
    assert snapshot() == before
    db.delete(override)
    db.commit()
    response = client.post(f"/api/v1{path}", json=payload)
    assert response.status_code in (200, 201), response.text
    assert db.scalar(select(func.count()).select_from(Book)) == before[0][0] + 1
    assert db.scalar(select(func.count()).select_from(Document)) == before[0][1] + 1
    if entrance == "return":
        db.refresh(leave)
        assert leave.status == "Completed"
    if entrance == "maintenance":
        assert db.scalar(select(func.count()).select_from(VehicleMaintenanceRequest)) == 1
