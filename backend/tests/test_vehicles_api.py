"""Vehicle CRUD, file, fine, renewal, settings, and capability API contracts."""

from __future__ import annotations

import base64
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.config import get_settings
from app.db.models import (
    AuditLog,
    Base,
    Employee,
    User,
    UserPermission,
    Vehicle,
    VehicleAccident,
    VehicleFile,
    VehiclePhotoAsset,
)
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import vehicle_photo_service

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


def _upload_license_scan(client: TestClient, vehicle_id: int, *, filename: str) -> dict[str, Any]:
    response = client.post(
        f"/api/v1/vehicles/{vehicle_id}/files",
        data={"kind": "license"},
        files={"file": (filename, _PNG_1X1, "image/png")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _upload_vehicle_image(
    client: TestClient,
    vehicle_id: int,
    *,
    kind: str,
    filename: str,
) -> dict[str, Any]:
    response = client.post(
        f"/api/v1/vehicles/{vehicle_id}/files",
        data={"kind": kind},
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
    current_scan = _upload_license_scan(admin_client, vehicle["id"], filename="current-license.png")
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
    current_scan = _upload_license_scan(admin_client, vehicle["id"], filename="current-license.png")
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


def test_photo_library_shares_exact_asset_and_isolates_vehicle_selection(
    admin_client: TestClient,
) -> None:
    first = _create_vehicle(admin_client)
    second_payload = _vehicle_payload()
    second_payload["plate_number"] = "58217"
    second_payload["new_site"] = {
        "name_ar": "موقع الاختبار الثاني",
        "name_en": "Second Test Site",
    }
    second_response = admin_client.post("/api/v1/vehicles", json=second_payload)
    assert second_response.status_code == 201, second_response.text
    second = second_response.json()

    uploaded = admin_client.post(
        "/api/v1/vehicles/photo-library",
        data={"label_ar": "هايس", "label_en": "Hiace"},
        files={"file": ("hiace.png", _PNG_1X1, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    asset = uploaded.json()
    duplicate = admin_client.post(
        "/api/v1/vehicles/photo-library",
        data={"label_en": "Same pixels"},
        files={"file": ("same-image.png", _PNG_1X1, "image/png")},
    )
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["id"] == asset["id"]

    for vehicle in (first, second):
        selected = admin_client.patch(
            f"/api/v1/vehicles/{vehicle['id']}",
            json={"photo_asset_id": asset["id"]},
        )
        assert selected.status_code == 200, selected.text
    first_selected = admin_client.get(f"/api/v1/vehicles/{first['id']}").json()
    second_selected = admin_client.get(f"/api/v1/vehicles/{second['id']}").json()
    url_fields = ("photo_url", "photo_thumbnail_url", "photo_full_url")
    assert all(first_selected[field] == second_selected[field] for field in url_fields)

    cleared = admin_client.patch(f"/api/v1/vehicles/{first['id']}", json={"photo_asset_id": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["photo_asset_id"] is None
    assert all(cleared.json()[field] is None for field in url_fields)
    assert (
        admin_client.get(f"/api/v1/vehicles/{second['id']}").json()["photo_asset_id"] == asset["id"]
    )

    archived = admin_client.post(f"/api/v1/vehicles/{second['id']}/archive")
    assert archived.status_code == 200, archived.text
    blocked = admin_client.delete(f"/api/v1/vehicles/photo-library/{asset['id']}")
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["error"]["code"] == "VEHICLE_PHOTO_IN_USE"
    assert blocked.json()["error"]["details"] == {
        "photo_id": asset["id"],
        "usage_count": 1,
    }

    assert admin_client.post(f"/api/v1/vehicles/{second['id']}/restore").status_code == 200
    assert (
        admin_client.patch(
            f"/api/v1/vehicles/{second['id']}", json={"photo_asset_id": None}
        ).status_code
        == 200
    )
    assert admin_client.delete(f"/api/v1/vehicles/photo-library/{asset['id']}").status_code == 204


def test_concurrent_exact_photo_uploads_share_asset_and_cleanup_losing_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "data_dir", tmp_path / "concurrent-photo-data")
    settings.ensure_dirs()
    engine = create_engine(
        f"sqlite:///{tmp_path / 'concurrent-photo.db'}",
        future=True,
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    attach_sqlite_pragmas(engine, wal=False)
    Base.metadata.create_all(engine)
    test_session = sessionmaker(
        bind=engine,
        autoflush=False,
        expire_on_commit=False,
        future=True,
    )
    both_files_written = Barrier(2)
    original_write = vehicle_photo_service._write_photo_files

    def synchronized_write(**kwargs):
        result = original_write(**kwargs)
        both_files_written.wait(timeout=10)
        return result

    monkeypatch.setattr(vehicle_photo_service, "_write_photo_files", synchronized_write)

    def upload(label: str) -> int:
        with test_session() as db:
            return vehicle_photo_service.create_photo_asset(
                db,
                filename=f"{label}.png",
                data=_PNG_1X1,
                label_ar=None,
                label_en=label,
            ).id

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(upload, label) for label in ("First", "Second")]
            asset_ids = [future.result(timeout=15) for future in futures]
        assert len(set(asset_ids)) == 1
        with test_session() as db:
            assert db.scalar(select(func.count()).select_from(VehiclePhotoAsset)) == 1
        roots = [path for path in (settings.data_dir / "vehicle_photos").iterdir() if path.is_dir()]
        assert len(roots) == 1
    finally:
        engine.dispose()


def test_lazy_legacy_dedup_preserves_issued_urls_without_duplicate_storage(
    admin_client: TestClient,
    api_db: Session,
) -> None:
    first = _create_vehicle(admin_client)
    second_payload = _vehicle_payload()
    second_payload["plate_number"] = "58218"
    second_payload["new_site"] = {
        "name_ar": "موقع الصور القديمة",
        "name_en": "Legacy Photo Site",
    }
    second_response = admin_client.post("/api/v1/vehicles", json=second_payload)
    assert second_response.status_code == 201, second_response.text
    second = second_response.json()

    files = []
    for vehicle in (first, second):
        uploaded = admin_client.post(
            f"/api/v1/vehicles/{vehicle['id']}/files",
            data={"kind": "photo"},
            files={"file": ("legacy.png", _PNG_1X1, "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        files.append(uploaded.json())

    assets = [
        VehiclePhotoAsset(
            label_en=f"Legacy {index}",
            original_name=file["original_name"],
            legacy_file_id=file["id"],
        )
        for index, file in enumerate(files, start=1)
    ]
    api_db.add_all(assets)
    api_db.flush()
    first_vehicle = api_db.get(Vehicle, first["id"])
    second_vehicle = api_db.get(Vehicle, second["id"])
    assert first_vehicle is not None
    assert second_vehicle is not None
    first_vehicle.photo_asset_id = assets[0].id
    second_vehicle.photo_asset_id = assets[1].id
    first_asset_id = assets[0].id
    duplicate_asset_id = assets[1].id
    api_db.commit()

    listed = admin_client.get("/api/v1/vehicles/photo-library")
    assert listed.status_code == 200, listed.text
    metadata = {item["id"]: item for item in listed.json()}
    first_urls = metadata[first_asset_id]
    duplicate_urls = metadata[duplicate_asset_id]
    assert duplicate_urls["width"] is None
    assert duplicate_urls["height"] is None

    canonical_responses = {
        variant: admin_client.get(first_urls[f"{variant}_url"])
        for variant in ("thumbnail", "preview", "full")
    }
    duplicate_responses = {
        variant: admin_client.get(duplicate_urls[f"{variant}_url"])
        for variant in ("thumbnail", "preview", "full")
    }
    for variant in ("thumbnail", "preview", "full"):
        canonical_response = canonical_responses[variant]
        duplicate_response = duplicate_responses[variant]
        assert canonical_response.status_code == 200, canonical_response.text
        assert duplicate_response.status_code == 200, duplicate_response.text
        assert duplicate_response.content == canonical_response.content
        assert duplicate_response.headers["etag"] == canonical_response.headers["etag"]

    api_db.expire_all()
    alias = api_db.get(VehiclePhotoAsset, duplicate_asset_id)
    assert alias is not None
    assert alias.canonical_asset_id == first_asset_id
    assert alias.content_hash is None
    assert alias.thumbnail_path is None
    assert alias.preview_path is None
    assert alias.full_path is None
    persisted_first = api_db.get(Vehicle, first["id"])
    persisted_second = api_db.get(Vehicle, second["id"])
    assert persisted_first is not None
    assert persisted_second is not None
    assert persisted_first.photo_asset_id == first_asset_id
    assert persisted_second.photo_asset_id == first_asset_id

    selected_alias = admin_client.patch(
        f"/api/v1/vehicles/{second['id']}",
        json={"photo_asset_id": duplicate_asset_id},
    )
    assert selected_alias.status_code == 200, selected_alias.text
    assert selected_alias.json()["photo_asset_id"] == first_asset_id
    assert (
        admin_client.delete(f"/api/v1/vehicles/photo-library/{duplicate_asset_id}").status_code
        == 409
    )
    assert {item["id"] for item in admin_client.get("/api/v1/vehicles/photo-library").json()} == {
        first_asset_id
    }

    storage_roots = [
        path for path in (get_settings().data_dir / "vehicle_photos").iterdir() if path.is_dir()
    ]
    assert len(storage_roots) == 1
    for file in files:
        stored = api_db.get(VehicleFile, file["id"])
        assert stored is not None
        assert (get_settings().data_dir / stored.path).is_file()


def test_photo_library_auth_precedes_etag_and_invalid_upload_is_rejected(
    admin_client: TestClient,
    vehicle_editor_client: TestClient,
    api_db: Session,
) -> None:
    uploaded = admin_client.post(
        "/api/v1/vehicles/photo-library",
        data={"label_en": "Private photo"},
        files={"file": ("private.png", _PNG_1X1, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    image_url = uploaded.json()["thumbnail_url"]
    image = admin_client.get(image_url)
    assert image.status_code == 200, image.text
    assert image.headers["cache-control"] == "private, max-age=31536000, immutable"
    etag = image.headers["etag"]

    unauthorised_user = _make_user(api_db, role="operator", email="vehicle-photo-no-view@test.ae")
    unauthorised = _client_for(api_db, unauthorised_user).get(
        image_url, headers={"If-None-Match": etag}
    )
    assert unauthorised.status_code == 403
    conditional = vehicle_editor_client.get(image_url, headers={"If-None-Match": f"W/{etag}"})
    assert conditional.status_code == 304
    assert conditional.headers["etag"] == etag
    assert (
        vehicle_editor_client.delete(
            f"/api/v1/vehicles/photo-library/{uploaded.json()['id']}"
        ).status_code
        == 403
    )

    invalid = vehicle_editor_client.post(
        "/api/v1/vehicles/photo-library",
        data={"label_en": "Broken"},
        files={"file": ("broken.png", b"not an image", "image/png")},
    )
    assert invalid.status_code == 422, invalid.text
    assert invalid.json()["error"]["code"] == "VEHICLE_PHOTO_INVALID"


def test_gallery_promotion_copies_to_library_without_mutating_original(
    admin_client: TestClient,
    api_db: Session,
) -> None:
    vehicle = _create_vehicle(admin_client)
    gallery = _upload_vehicle_image(
        admin_client,
        int(vehicle["id"]),
        kind="gallery",
        filename="gallery-source.png",
    )
    original = api_db.get(VehicleFile, gallery["id"])
    assert original is not None
    original_path = get_settings().data_dir / original.path
    original_bytes = original_path.read_bytes()

    promoted = admin_client.post(
        f"/api/v1/vehicles/{vehicle['id']}/files/{gallery['id']}/photo-asset"
    )
    assert promoted.status_code == 200, promoted.text
    api_db.expire_all()
    preserved = api_db.get(VehicleFile, gallery["id"])
    assert preserved is not None
    assert preserved.kind == "gallery"
    assert preserved.path == original.path
    assert original_path.read_bytes() == original_bytes

    selected = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={"photo_asset_id": promoted.json()["id"]},
    )
    assert selected.status_code == 200, selected.text
    assert admin_client.delete(gallery["url"]).status_code == 204
    assert not original_path.exists()
    assert admin_client.get(promoted.json()["full_url"]).status_code == 200


def test_deleting_accident_referenced_gallery_photo_names_blocking_accident(
    admin_client: TestClient,
    api_db: Session,
) -> None:
    vehicle = _create_vehicle(admin_client)
    vehicle_id = int(vehicle["id"])
    evidence = _upload_vehicle_image(
        admin_client,
        vehicle_id,
        kind="gallery",
        filename="accident-evidence.png",
    )
    accident = VehicleAccident(
        vehicle_id=vehicle_id,
        employee_id=None,
        date=date(2026, 8, 21),
        time="14:30",
        location_ar="موقف الاختبار",
        location_en="Test car park",
        description_ar="تلف",
        description_en="Damage",
        police_ref=None,
        damage_cost=500,
        status="open",
        photo_file_ids=[evidence["id"]],
    )
    api_db.add(accident)
    api_db.commit()

    rejected = admin_client.delete(
        f"/api/v1/vehicles/{vehicle_id}/files/{evidence['id']}",
    )

    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["error"]["code"] == "VEHICLE_FILE_IN_USE"
    assert rejected.json()["error"]["details"] == {
        "file_id": evidence["id"],
        "accident_id": accident.id,
    }
    assert admin_client.get(evidence["url"]).status_code == 200
    api_db.expire_all()
    persisted = api_db.get(VehicleAccident, accident.id)
    assert persisted is not None
    assert persisted.photo_file_ids == [evidence["id"]]


@pytest.mark.parametrize("kind", ["license", "accident", "receipt"])
def test_license_accident_and_receipt_files_remain_not_deletable(
    admin_client: TestClient,
    kind: str,
) -> None:
    vehicle = _create_vehicle(admin_client)
    vehicle_id = int(vehicle["id"])
    protected = _upload_vehicle_image(
        admin_client,
        vehicle_id,
        kind=kind,
        filename=f"protected-{kind}.png",
    )

    rejected = admin_client.delete(
        f"/api/v1/vehicles/{vehicle_id}/files/{protected['id']}",
    )

    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["error"]["code"] == "FILE_NOT_DELETABLE"
    assert rejected.json()["error"]["details"] == {
        "file_id": protected["id"],
        "kind": kind,
    }
    assert admin_client.get(protected["url"]).status_code == 200


@pytest.mark.parametrize("kind", ["photo", "gallery"])
def test_free_photo_deletion_keeps_permission_and_active_vehicle_guards(
    admin_client: TestClient,
    vehicle_editor_client: TestClient,
    admin_user: User,
    api_db: Session,
    kind: str,
) -> None:
    vehicle = _create_vehicle(admin_client)
    vehicle_id = int(vehicle["id"])
    free_photo = _upload_vehicle_image(
        admin_client,
        vehicle_id,
        kind=kind,
        filename=f"free-{kind}.png",
    )
    file_row = api_db.get(VehicleFile, free_photo["id"])
    assert file_row is not None
    stored_path = get_settings().data_dir / file_row.path
    assert stored_path.is_file()

    forbidden = vehicle_editor_client.delete(
        f"/api/v1/vehicles/{vehicle_id}/files/{free_photo['id']}",
    )
    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["error"]["details"]["capability"] == "vehicles.delete"
    assert stored_path.is_file()

    archived = admin_client.post(f"/api/v1/vehicles/{vehicle_id}/archive")
    assert archived.status_code == 200, archived.text
    archived_delete = admin_client.delete(
        f"/api/v1/vehicles/{vehicle_id}/files/{free_photo['id']}",
    )
    assert archived_delete.status_code == 409, archived_delete.text
    assert archived_delete.json()["error"]["code"] == "VEHICLE_ARCHIVED"
    restored = admin_client.post(f"/api/v1/vehicles/{vehicle_id}/restore")
    assert restored.status_code == 200, restored.text

    deleted = admin_client.delete(
        f"/api/v1/vehicles/{vehicle_id}/files/{free_photo['id']}",
    )

    assert deleted.status_code == 204, deleted.text
    api_db.expire_all()
    assert api_db.get(VehicleFile, free_photo["id"]) is None
    assert not stored_path.exists()
    audit = (
        api_db.query(AuditLog)
        .filter_by(
            action="file.deleted",
            entity_type="vehicle",
            entity_id=str(vehicle_id),
        )
        .one()
    )
    assert audit.actor == admin_user.email
    assert audit.payload is not None
    assert json.loads(audit.payload) == {"file_id": free_photo["id"]}


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


def test_profile_fields_persist_and_round_trip(admin_client: TestClient) -> None:
    payload = _vehicle_payload()
    payload.update(
        {
            "make": "Toyota",
            "model": "Land Cruiser",
            "model_year": 2024,
            "colour": "White",
            "insurance_expiry": "2027-06-01",
            "inmate_capacity": 0,
            "passenger_capacity": 12,
            "accessories_ar": "مكيف",
            "accessories_en": "AC unit",
            "notes_ar": "ملاحظة عامة",
            "notes_en": "General note",
        }
    )
    created = admin_client.post("/api/v1/vehicles", json=payload)
    assert created.status_code == 201, created.text
    vehicle = created.json()
    assert vehicle["make"] == "Toyota"
    assert vehicle["model"] == "Land Cruiser"
    assert vehicle["model_year"] == 2024
    assert vehicle["colour"] == "White"
    assert vehicle["insurance_expiry"] == "2027-06-01"
    assert vehicle["insurance_status"] == "valid"
    assert vehicle["inmate_capacity"] == 0
    assert vehicle["passenger_capacity"] == 12
    assert vehicle["accessories_ar"] == "مكيف"
    assert vehicle["accessories_en"] == "AC unit"
    assert vehicle["notes_ar"] == "ملاحظة عامة"
    assert vehicle["notes_en"] == "General note"
    # Adding profile facts never touches the existing bilingual type.
    assert vehicle["type_ar"] == payload["type_ar"]
    assert vehicle["type_en"] == payload["type_en"]

    fetched = admin_client.get(f"/api/v1/vehicles/{vehicle['id']}")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["make"] == "Toyota"


def test_update_profile_fields_null_vs_omitted_vs_unset(admin_client: TestClient) -> None:
    vehicle = _create_vehicle(admin_client)

    filled = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={"make": "Nissan", "insurance_expiry": "2027-01-01"},
    )
    assert filled.status_code == 200, filled.text
    assert filled.json()["make"] == "Nissan"
    assert filled.json()["insurance_expiry"] == "2027-01-01"

    # Omitted fields are preserved (PATCH exclude_unset semantics).
    omitted = admin_client.patch(f"/api/v1/vehicles/{vehicle['id']}", json={"colour": "Black"})
    assert omitted.status_code == 200, omitted.text
    assert omitted.json()["make"] == "Nissan"
    assert omitted.json()["insurance_expiry"] == "2027-01-01"
    assert omitted.json()["colour"] == "Black"

    # Explicit null clears the value and its computed status.
    cleared = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={"insurance_expiry": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["insurance_expiry"] is None
    assert cleared.json()["insurance_status"] is None
    assert cleared.json()["make"] == "Nissan"

    # Make/model are independent of the existing bilingual vehicle type and class.
    respecced = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={"make": "Mitsubishi", "model": "Rosa", "model_year": 2019},
    )
    assert respecced.status_code == 200, respecced.text
    assert respecced.json()["model"] == "Rosa"
    assert respecced.json()["model_year"] == 2019
    assert respecced.json()["type_ar"] == vehicle["type_ar"]
    assert respecced.json()["type_en"] == vehicle["type_en"]
    assert respecced.json()["class_ar"] == vehicle["class_ar"]
    assert respecced.json()["class_en"] == vehicle["class_en"]
    assert respecced.json()["license_start"] == vehicle["license_start"]
    assert respecced.json()["license_expiry"] == vehicle["license_expiry"]

    # Zero is a real capacity on the update path, and null is still "unknown".
    zeroed = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={"inmate_capacity": 0, "passenger_capacity": 0},
    )
    assert zeroed.status_code == 200, zeroed.text
    assert zeroed.json()["inmate_capacity"] == 0
    assert zeroed.json()["passenger_capacity"] == 0

    unknown = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={"inmate_capacity": None},
    )
    assert unknown.status_code == 200, unknown.text
    assert unknown.json()["inmate_capacity"] is None
    assert unknown.json()["passenger_capacity"] == 0


def test_list_search_matches_make_model_and_colour(admin_client: TestClient) -> None:
    payload = _vehicle_payload()
    payload.update({"make": "Mitsubishi", "model": "Rosa", "colour": "Pearl"})
    created = admin_client.post("/api/v1/vehicles", json=payload)
    assert created.status_code == 201, created.text
    vehicle_id = created.json()["id"]

    for term in ("Mitsubishi", "rosa", "pearl"):
        found = admin_client.get("/api/v1/vehicles", params={"q": term})
        assert found.status_code == 200, found.text
        assert [row["id"] for row in found.json()] == [vehicle_id], term

    missing = admin_client.get("/api/v1/vehicles", params={"q": "Peugeot"})
    assert missing.status_code == 200, missing.text
    assert missing.json() == []


def test_blank_optional_text_becomes_null(admin_client: TestClient) -> None:
    blank_fields = (
        "vin",
        "contract_note_ar",
        "contract_note_en",
        "make",
        "model",
        "colour",
        "accessories_ar",
        "accessories_en",
        "notes_ar",
        "notes_en",
    )
    payload = _vehicle_payload()
    payload.update({field: "   " if index % 2 else "" for index, field in enumerate(blank_fields)})
    created = admin_client.post("/api/v1/vehicles", json=payload)
    assert created.status_code == 201, created.text
    vehicle = created.json()
    for field in blank_fields:
        assert vehicle[field] is None, field

    filled = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={field: f" {field}-value " for field in blank_fields},
    )
    assert filled.status_code == 200, filled.text
    for field in blank_fields:
        assert filled.json()[field] == f"{field}-value", field

    blanked = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={field: "   " if index % 2 else "" for index, field in enumerate(blank_fields)},
    )
    assert blanked.status_code == 200, blanked.text
    for field in blank_fields:
        assert blanked.json()[field] is None, field


def test_negative_capacity_and_bad_license_dates_rejected_with_no_partial_write(
    admin_client: TestClient,
) -> None:
    vehicle = _create_vehicle(admin_client)

    bad_capacity = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={"passenger_capacity": -1, "make": "ShouldNotPersist"},
    )
    assert bad_capacity.status_code == 422, bad_capacity.text

    bad_dates = admin_client.patch(
        f"/api/v1/vehicles/{vehicle['id']}",
        json={
            "license_start": "2027-01-01",
            "license_expiry": "2026-01-01",
            "make": "ShouldNotPersist",
        },
    )
    assert bad_dates.status_code == 422, bad_dates.text

    persisted = admin_client.get(f"/api/v1/vehicles/{vehicle['id']}")
    assert persisted.status_code == 200, persisted.text
    assert persisted.json()["make"] is None
    assert persisted.json()["passenger_capacity"] is None


def test_archive_lifecycle_retains_history_and_guards_every_write_path(
    admin_client: TestClient,
    vehicle_editor_client: TestClient,
    api_db: Session,
) -> None:
    from app.services import vehicle_reminder_service

    vehicle = _create_vehicle(admin_client)
    vehicle_id = int(vehicle["id"])
    _add_fine(admin_client, vehicle_id)
    photo = admin_client.post(
        f"/api/v1/vehicles/{vehicle_id}/files",
        data={"kind": "gallery"},
        files={"file": ("main.png", _PNG_1X1, "image/png")},
    )
    assert photo.status_code == 200, photo.text
    _upload_license_scan(admin_client, vehicle_id, filename="licence.png")
    accident = admin_client.post(
        "/api/v1/vehicles/accidents",
        json={
            "vehicle_id": vehicle_id,
            "employee_id": None,
            "date": "2026-08-21",
            "time": "14:30",
            "location_ar": "موقف الاختبار",
            "location_en": "Test car park",
            "description_ar": "تلف",
            "description_en": "Damage",
            "police_ref": None,
            "damage_cost": 500,
            "photo_file_ids": [],
        },
    )
    assert accident.status_code == 201, accident.text
    accident_id = accident.json()["id"]
    maintenance = admin_client.post(
        "/api/v1/vehicles/maintenance",
        json={
            "vehicle_id": vehicle_id,
            "date": "2026-08-22",
            "type": "service",
            "odometer_km": 1000,
            "cost": 200,
            "vendor_ar": None,
            "vendor_en": "Garage",
            "next_due": None,
            "receipt_file_id": None,
        },
    )
    assert maintenance.status_code == 201, maintenance.text
    renewed = admin_client.post(
        f"/api/v1/vehicles/{vehicle_id}/renew",
        json={"start": "2026-01-01", "expiry": "2027-01-01", "cost": 500},
    )
    assert renewed.status_code == 200, renewed.text

    # Only vehicles.delete can archive; edit alone is insufficient.
    forbidden = vehicle_editor_client.post(f"/api/v1/vehicles/{vehicle_id}/archive")
    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["error"]["details"]["capability"] == "vehicles.delete"

    archived = admin_client.post(f"/api/v1/vehicles/{vehicle_id}/archive")
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived_at"] is not None

    # Repeating archive on an already-archived vehicle is a harmless no-op.
    again = admin_client.post(f"/api/v1/vehicles/{vehicle_id}/archive")
    assert again.status_code == 200, again.text
    assert again.json()["archived_at"] == archived.json()["archived_at"]

    # Excluded from the default (active) list and summary aggregates.
    active_list = admin_client.get("/api/v1/vehicles")
    assert vehicle_id not in {row["id"] for row in active_list.json()}
    archived_list = admin_client.get("/api/v1/vehicles?state=archived")
    assert vehicle_id in {row["id"] for row in archived_list.json()}
    summary = admin_client.get("/api/v1/vehicles/summary")
    assert summary.status_code == 200, summary.text
    assert summary.json()["vehicles"] == 0
    assert summary.json()["fines_count"] == 0

    # Excluded from fleet-wide fines/accidents/maintenance listings.
    assert admin_client.get("/api/v1/vehicles/fines").json() == []
    assert admin_client.get("/api/v1/vehicles/accidents").json() == []
    assert admin_client.get("/api/v1/vehicles/maintenance").json() == []

    # Excluded from EVG candidate options.
    evg_preview = admin_client.post(
        "/api/v1/vehicles/fines/evg/preview", json={"traffic_codes": []}
    )
    assert evg_preview.status_code == 200, evg_preview.text
    assert vehicle_id not in {row["id"] for row in evg_preview.json()["vehicles"]}

    # Excluded from reminder runs even though its licence is far in the past
    # relative to a distant frozen "today" — sanity-checked by directly
    # forcing the window to always be due and confirming zero sends.
    sent = vehicle_reminder_service.send_due_reminders(api_db, today=date(2030, 1, 1))
    assert sent == 0

    # Archived detail stays readable, including files/fines/accidents/history.
    detail = admin_client.get(f"/api/v1/vehicles/{vehicle_id}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert len(body["fines"]) == 1
    assert [row["id"] for row in body["accidents"]] == [accident_id]
    assert len(body["maintenance"]) == 1
    assert len(body["renewals"]) == 1
    assert len(body["license_files"]) >= 1

    # Every representative write endpoint rejects the archived vehicle, even
    # with edit capability.
    guarded = [
        lambda: admin_client.patch(f"/api/v1/vehicles/{vehicle_id}", json={"make": "X"}),
        lambda: admin_client.post(
            f"/api/v1/vehicles/{vehicle_id}/renew",
            json={"start": "2027-01-01", "expiry": "2028-01-01", "cost": 0},
        ),
        lambda: admin_client.post(
            f"/api/v1/vehicles/{vehicle_id}/fines",
            json={
                "employee_id": None,
                "date": "2026-08-20",
                "time": None,
                "amount": 100,
                "black_points": 0,
                "location": None,
                "description": None,
            },
        ),
        lambda: admin_client.post(
            "/api/v1/vehicles/accidents",
            json={
                "vehicle_id": vehicle_id,
                "employee_id": None,
                "date": "2026-08-21",
                "time": "14:30",
                "location_ar": "a",
                "location_en": "a",
                "description_ar": "a",
                "description_en": "a",
                "police_ref": None,
                "damage_cost": 0,
                "photo_file_ids": [],
            },
        ),
        lambda: admin_client.post(
            "/api/v1/vehicles/maintenance",
            json={
                "vehicle_id": vehicle_id,
                "date": "2026-08-22",
                "type": "service",
                "odometer_km": 1,
                "cost": 0,
                "vendor_ar": None,
                "vendor_en": None,
                "next_due": None,
                "receipt_file_id": None,
            },
        ),
        lambda: admin_client.post(
            f"/api/v1/vehicles/{vehicle_id}/files",
            data={"kind": "gallery"},
            files={"file": ("x.png", _PNG_1X1, "image/png")},
        ),
    ]
    for call in guarded:
        response = call()
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "VEHICLE_ARCHIVED"

    # Restore requires vehicles.delete too.
    forbidden_restore = vehicle_editor_client.post(f"/api/v1/vehicles/{vehicle_id}/restore")
    assert forbidden_restore.status_code == 403, forbidden_restore.text

    restored = admin_client.post(f"/api/v1/vehicles/{vehicle_id}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["archived_at"] is None

    # Repeating restore on an already-active vehicle is a harmless no-op.
    again_restore = admin_client.post(f"/api/v1/vehicles/{vehicle_id}/restore")
    assert again_restore.status_code == 200, again_restore.text

    active_again = admin_client.get("/api/v1/vehicles")
    assert vehicle_id in {row["id"] for row in active_again.json()}
    # Writes work again post-restore, and plate uniqueness/history survived.
    resumed_edit = admin_client.patch(f"/api/v1/vehicles/{vehicle_id}", json={"make": "Toyota"})
    assert resumed_edit.status_code == 200, resumed_edit.text
    assert resumed_edit.json()["make"] == "Toyota"
    assert len(resumed_edit.json()["renewals"]) == 1
    duplicate_plate = admin_client.post(
        "/api/v1/vehicles",
        json=_vehicle_payload(),
    )
    assert duplicate_plate.status_code == 422, duplicate_plate.text
    assert duplicate_plate.json()["error"]["code"] == "PLATE_EXISTS"


def test_restore_rejects_inactive_site(admin_client: TestClient) -> None:
    vehicle = _create_vehicle(admin_client)
    vehicle_id = int(vehicle["id"])
    site_id = vehicle["site_id"]

    archived = admin_client.post(f"/api/v1/vehicles/{vehicle_id}/archive")
    assert archived.status_code == 200, archived.text

    deactivated = admin_client.patch(f"/api/v1/vehicles/sites/{site_id}", json={"active": False})
    assert deactivated.status_code == 200, deactivated.text

    restore = admin_client.post(f"/api/v1/vehicles/{vehicle_id}/restore")
    assert restore.status_code == 422, restore.text
    assert restore.json()["error"]["code"] == "VEHICLE_SITE_INACTIVE"

    still_archived = admin_client.get(f"/api/v1/vehicles/{vehicle_id}")
    assert still_archived.json()["archived_at"] is not None
