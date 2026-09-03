"""Vehicle CRUD, file, fine, renewal, settings, and capability API contracts."""

from __future__ import annotations

import base64
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import get_settings
from app.db.models import Employee, User, UserPermission, Vehicle
from app.db.session import get_db
from app.main import create_app

_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _make_user(db: Session, *, role: str, email: str, capabilities: tuple[str, ...] = ()) -> User:
    user = User(email=email, password_hash="x", role=role, status="active")
    db.add(user)
    db.commit()
    db.refresh(user)
    db.add_all(
        UserPermission(user_id=user.id, capability=capability, effect="grant")
        for capability in capabilities
    )
    db.commit()
    return user


def _client_for(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def admin_user(api_db: Session) -> User:
    return _make_user(api_db, role="admin", email="vehicles-admin@test.ae")


@pytest.fixture()
def admin_client(
    api_db: Session, admin_user: User, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> TestClient:
    settings = get_settings()
    monkeypatch.setattr(settings, "data_dir", tmp_path / "vehicle-data")
    settings.ensure_dirs()
    return _client_for(api_db, admin_user)


@pytest.fixture()
def vehicle_editor_client(api_db: Session) -> TestClient:
    editor = _make_user(
        api_db,
        role="operator",
        email="vehicles-editor@test.ae",
        capabilities=("vehicles.view", "vehicles.edit"),
    )
    return _client_for(api_db, editor)


@pytest.fixture()
def employee(api_db: Session) -> Employee:
    row = Employee(
        id="G1001",
        name_en="Test Driver",
        name_ar="سائق تجريبي",
        doj=date(2020, 1, 1),
    )
    api_db.add(row)
    api_db.commit()
    return row


def _vehicle_payload(
    *,
    license_start: date = date(2026, 1, 1),
    license_expiry: date = date(2099, 12, 31),
) -> dict[str, Any]:
    return {
        "plate_code": "14",
        "plate_number": "58216",
        "traffic_code": "1180021637",
        "type_ar": "تويوتا هايس",
        "type_en": "Toyota Hiace",
        "class_ar": "باص خفيف",
        "class_en": "Light bus",
        "vin": "JT123456789012345",
        "new_site": {"name_ar": "موقع الاختبار", "name_en": "Test Site"},
        "license_start": license_start.isoformat(),
        "license_expiry": license_expiry.isoformat(),
    }


def _create_vehicle(
    client: TestClient,
    *,
    license_start: date = date(2026, 1, 1),
    license_expiry: date = date(2099, 12, 31),
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/vehicles",
        json=_vehicle_payload(
            license_start=license_start,
            license_expiry=license_expiry,
        ),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _add_fine(client: TestClient, vehicle_id: int) -> dict[str, Any]:
    response = client.post(
        f"/api/v1/vehicles/{vehicle_id}/fines",
        json={
            "employee_id": None,
            "date": "2026-08-20",
            "time": "08:30",
            "amount": 600,
            "black_points": 4,
            "location": "Abu Dhabi",
            "description": "Test fine",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _upload_license_scan(
    client: TestClient, vehicle_id: int, *, filename: str
) -> dict[str, Any]:
    response = client.post(
        f"/api/v1/vehicles/{vehicle_id}/files",
        data={"kind": "license"},
        files={"file": (filename, _PNG_1X1, "image/png")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_create_vehicle_with_inline_site_returns_valid_status(admin_client: TestClient) -> None:
    vehicle = _create_vehicle(admin_client)

    assert vehicle["expiry_status"] == "valid"
    assert vehicle["site_id"] is not None

    sites_response = admin_client.get("/api/v1/vehicles/sites")
    assert sites_response.status_code == 200, sites_response.text
    assert sites_response.json() == [
        {
            "id": vehicle["site_id"],
            "name_ar": "موقع الاختبار",
            "name_en": "Test Site",
            "active": True,
            "vehicle_count": 1,
        }
    ]


@pytest.mark.parametrize("populated", [False, True], ids=["empty", "populated"])
def test_site_active_cannot_be_null(admin_client: TestClient, populated: bool) -> None:
    if populated:
        site_id = _create_vehicle(admin_client)["site_id"]
    else:
        created = admin_client.post(
            "/api/v1/vehicles/sites",
            json={"name_ar": "موقع فارغ", "name_en": "Empty Site"},
        )
        assert created.status_code == 201, created.text
        site_id = created.json()["id"]

    response = admin_client.patch(
        f"/api/v1/vehicles/sites/{site_id}",
        json={"active": None},
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "VEHICLE_SITE_ACTIVE_REQUIRED"
    sites = admin_client.get("/api/v1/vehicles/sites")
    assert sites.status_code == 200, sites.text
    persisted = next(row for row in sites.json() if row["id"] == site_id)
    assert persisted["active"] is True


def test_populated_site_cannot_be_archived(admin_client: TestClient) -> None:
    vehicle = _create_vehicle(admin_client)

    response = admin_client.patch(
        f"/api/v1/vehicles/sites/{vehicle['site_id']}",
        json={"active": False},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "SITE_HAS_VEHICLES"


def test_duplicate_plate_without_plate_code_is_rejected(
    admin_client: TestClient,
) -> None:
    first_payload = _vehicle_payload()
    first_payload.pop("plate_code")
    created = admin_client.post("/api/v1/vehicles", json=first_payload)
    assert created.status_code == 201, created.text

    duplicate_payload = _vehicle_payload()
    duplicate_payload.pop("plate_code")
    duplicate_payload.pop("new_site")
    duplicate_payload["site_id"] = created.json()["site_id"]
    response = admin_client.post("/api/v1/vehicles", json=duplicate_payload)

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "PLATE_EXISTS"


def test_renew_license_archives_old_period_and_preserves_existing_scan_when_omitted(
    admin_client: TestClient,
    api_db: Session,
) -> None:
    old_start = date(2025, 1, 1)
    old_expiry = date(2026, 12, 31)
    vehicle = _create_vehicle(
        admin_client,
        license_start=old_start,
        license_expiry=old_expiry,
    )
    current_scan = _upload_license_scan(
        admin_client, vehicle["id"], filename="current-license.png"
    )
    attached = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={"license_file_id": current_scan["id"]},
    )
    assert attached.status_code == 200, attached.text
    assert attached.json()["license_url"] == current_scan["url"]

    response = admin_client.post(
        f"/api/v1/vehicles/{vehicle['id']}/renew",
        json={
            "start": "2027-01-01",
            "expiry": "2027-12-31",
            "cost": 1450,
        },
    )

    assert response.status_code == 200, response.text
    renewed = response.json()
    assert renewed["license_start"] == "2027-01-01"
    assert renewed["license_expiry"] == "2027-12-31"
    assert renewed["license_url"] == current_scan["url"]
    assert len(renewed["renewals"]) == 1
    archived = renewed["renewals"][0]
    assert archived["start"] == old_start.isoformat()
    assert archived["expiry"] == old_expiry.isoformat()
    assert archived["cost"] == 1450
    assert archived["scan_url"] == current_scan["url"]

    api_db.expire_all()
    persisted = api_db.get(Vehicle, vehicle["id"])
    assert persisted is not None
    assert persisted.license_file_id == current_scan["id"]
    assert persisted.renewals[0].scan_file_id == current_scan["id"]


def test_renew_license_replaces_current_scan_when_supplied(
    admin_client: TestClient,
    api_db: Session,
) -> None:
    vehicle = _create_vehicle(admin_client)
    current_scan = _upload_license_scan(
        admin_client, vehicle["id"], filename="current-license.png"
    )
    replacement_scan = _upload_license_scan(
        admin_client, vehicle["id"], filename="replacement-license.png"
    )
    attached = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={"license_file_id": current_scan["id"]},
    )
    assert attached.status_code == 200, attached.text

    response = admin_client.post(
        f"/api/v1/vehicles/{vehicle['id']}/renew",
        json={
            "start": "2100-01-01",
            "expiry": "2100-12-31",
            "cost": 1450,
            "scan_file_id": replacement_scan["id"],
        },
    )

    assert response.status_code == 200, response.text
    renewed = response.json()
    assert renewed["license_url"] == replacement_scan["url"]
    assert renewed["renewals"][0]["scan_url"] == current_scan["url"]

    api_db.expire_all()
    persisted = api_db.get(Vehicle, vehicle["id"])
    assert persisted is not None
    assert persisted.license_file_id == replacement_scan["id"]
    assert persisted.renewals[0].scan_file_id == current_scan["id"]


def test_add_fine_without_employee_is_unassigned_and_increments_summary(
    admin_client: TestClient,
) -> None:
    vehicle = _create_vehicle(admin_client)

    updated_vehicle = _add_fine(admin_client, int(vehicle["id"]))

    assert len(updated_vehicle["fines"]) == 1
    fine = updated_vehicle["fines"][0]
    assert fine["employee_id"] is None
    assert fine["employee_name_ar"] is None
    assert fine["employee_name_en"] is None

    summary_response = admin_client.get("/api/v1/vehicles/summary")
    assert summary_response.status_code == 200, summary_response.text
    summary = summary_response.json()
    assert summary["fines_count"] == 1
    assert summary["fines_amount"] == 600
    assert summary["black_points"] == 4


def test_patch_fine_assigns_an_existing_employee(
    admin_client: TestClient, employee: Employee
) -> None:
    vehicle = _create_vehicle(admin_client)
    with_fine = _add_fine(admin_client, int(vehicle["id"]))
    fine_id = with_fine["fines"][0]["id"]

    response = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}/fines/{fine_id}",
        json={"employee_id": employee.id},
    )

    assert response.status_code == 200, response.text
    assigned = next(row for row in response.json()["fines"] if row["id"] == fine_id)
    assert assigned["employee_id"] == employee.id
    assert assigned["employee_name_en"] == employee.name_en
    assert assigned["employee_name_ar"] == employee.name_ar


def test_user_with_edit_but_without_delete_cannot_delete_fine(
    admin_client: TestClient, vehicle_editor_client: TestClient
) -> None:
    vehicle = _create_vehicle(admin_client)
    with_fine = _add_fine(admin_client, int(vehicle["id"]))
    fine_id = with_fine["fines"][0]["id"]

    response = vehicle_editor_client.delete(f"/api/v1/vehicles/{vehicle['id']}/fines/{fine_id}")

    assert response.status_code == 403
    assert response.json()["error"]["details"]["capability"] == "vehicles.delete"
    persisted = admin_client.get(f"/api/v1/vehicles/{vehicle['id']}")
    assert persisted.status_code == 200, persisted.text
    assert [row["id"] for row in persisted.json()["fines"]] == [fine_id]


def test_accident_lifecycle_and_delete_capability(
    admin_client: TestClient, vehicle_editor_client: TestClient
) -> None:
    vehicle = _create_vehicle(admin_client)
    created_response = admin_client.post(
        "/api/v1/vehicles/accidents",
        json={
            "vehicle_id": vehicle["id"],
            "employee_id": None,
            "date": "2026-08-21",
            "time": "14:30",
            "location_ar": "موقف الاختبار",
            "location_en": "Test car park",
            "description_ar": "تلف في الباب",
            "description_en": "Door damage",
            "police_ref": "ADP-2026-001",
            "damage_cost": 2400,
            "photo_file_ids": [],
        },
    )
    assert created_response.status_code == 201, created_response.text
    accident = created_response.json()
    assert accident["vehicle_id"] == vehicle["id"]
    assert accident["vehicle_plate_label"] == "14 \\ 58216"
    assert accident["status"] == "open"
    assert accident["damage_cost"] == 2400

    listed_response = admin_client.get("/api/v1/vehicles/accidents")
    assert listed_response.status_code == 200, listed_response.text
    listed = listed_response.json()
    assert [row["id"] for row in listed] == [accident["id"]]
    assert listed[0]["police_ref"] == "ADP-2026-001"

    status_response = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}/accidents/{accident['id']}",
        json={"status": "closed"},
    )
    assert status_response.status_code == 200, status_response.text
    assert status_response.json()["status"] == "closed"

    forbidden = vehicle_editor_client.delete(
        f"/api/v1/vehicles/{vehicle['id']}/accidents/{accident['id']}"
    )
    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["error"]["details"]["capability"] == "vehicles.delete"
    persisted = admin_client.get("/api/v1/vehicles/accidents")
    assert persisted.status_code == 200, persisted.text
    assert [(row["id"], row["status"]) for row in persisted.json()] == [(accident["id"], "closed")]

    deleted = admin_client.delete(f"/api/v1/vehicles/{vehicle['id']}/accidents/{accident['id']}")
    assert deleted.status_code == 204, deleted.text
    remaining = admin_client.get("/api/v1/vehicles/accidents")
    assert remaining.status_code == 200, remaining.text
    assert remaining.json() == []


def test_maintenance_lifecycle_and_delete_capability(
    admin_client: TestClient, vehicle_editor_client: TestClient
) -> None:
    vehicle = _create_vehicle(admin_client)
    created_response = admin_client.post(
        "/api/v1/vehicles/maintenance",
        json={
            "vehicle_id": vehicle["id"],
            "date": "2026-08-22",
            "type": "service",
            "odometer_km": 125000,
            "cost": 875,
            "vendor_ar": "ورشة الاختبار",
            "vendor_en": "Test Garage",
            "next_due": "2027-02-22",
            "receipt_file_id": None,
        },
    )
    assert created_response.status_code == 201, created_response.text
    maintenance = created_response.json()
    assert maintenance["vehicle_id"] == vehicle["id"]
    assert maintenance["vehicle_plate_label"] == "14 \\ 58216"
    assert maintenance["type"] == "service"
    assert maintenance["odometer_km"] == 125000
    assert maintenance["cost"] == 875

    listed_response = admin_client.get("/api/v1/vehicles/maintenance")
    assert listed_response.status_code == 200, listed_response.text
    listed = listed_response.json()
    assert [row["id"] for row in listed] == [maintenance["id"]]
    assert listed[0]["vendor_en"] == "Test Garage"
    assert listed[0]["next_due"] == "2027-02-22"

    forbidden = vehicle_editor_client.delete(
        f"/api/v1/vehicles/{vehicle['id']}/maintenance/{maintenance['id']}"
    )
    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["error"]["details"]["capability"] == "vehicles.delete"
    persisted = admin_client.get("/api/v1/vehicles/maintenance")
    assert persisted.status_code == 200, persisted.text
    assert [row["id"] for row in persisted.json()] == [maintenance["id"]]

    deleted = admin_client.delete(
        f"/api/v1/vehicles/{vehicle['id']}/maintenance/{maintenance['id']}"
    )
    assert deleted.status_code == 204, deleted.text
    remaining = admin_client.get("/api/v1/vehicles/maintenance")
    assert remaining.status_code == 200, remaining.text
    assert remaining.json() == []


def test_gallery_png_upload_is_served_inline(admin_client: TestClient) -> None:
    vehicle = _create_vehicle(admin_client)

    upload = admin_client.post(
        f"/api/v1/vehicles/{vehicle['id']}/files",
        data={"kind": "gallery", "label_en": "Damage photo"},
        files={"file": ("damage.png", _PNG_1X1, "image/png")},
    )
    assert upload.status_code == 200, upload.text
    file_row = upload.json()
    assert file_row["kind"] == "gallery"
    assert file_row["media_type"] == "image/png"

    response = admin_client.get(f"/api/v1/vehicles/{vehicle['id']}/files/{file_row['id']}")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/png"
    assert response.headers["content-disposition"].lower().startswith("inline")
    assert response.content == _PNG_1X1


def test_notify_days_updates_summary_and_flips_vehicle_to_due(
    admin_client: TestClient,
) -> None:
    today = date.today()
    vehicle = _create_vehicle(
        admin_client,
        license_start=today - timedelta(days=325),
        license_expiry=today + timedelta(days=40),
    )
    assert vehicle["expiry_status"] == "valid"

    response = admin_client.put(
        "/api/v1/vehicles/notify-days",
        json={"days": 45},
    )

    assert response.status_code == 200, response.text
    summary = response.json()
    assert summary["notify_days"] == 45
    assert summary["license_attention"] == 1

    vehicles_response = admin_client.get("/api/v1/vehicles")
    assert vehicles_response.status_code == 200, vehicles_response.text
    updated = next(row for row in vehicles_response.json() if row["id"] == vehicle["id"])
    assert updated["days_to_expiry"] == 40
    assert updated["expiry_status"] == "due"
