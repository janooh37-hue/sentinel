"""API and service tests for POST /vehicles/scan-licence."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.core.extraction.ocr import InvalidImageError, OcrUnavailableError
from app.db import session as session_mod
from app.db.models import Base, User, UserPermission
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import vehicle_profile_scan_service


@pytest.fixture()
def api_db(monkeypatch: pytest.MonkeyPatch, tmp_path):
    db_file = tmp_path / "vehicle_scan.db"
    eng = create_engine(
        f"sqlite:///{db_file}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


def _user(db: Session, *, email: str, capabilities: tuple[str, ...] = ()) -> User:
    user = User(email=email, password_hash="x", role="operator", status="active")
    db.add(user)
    db.flush()
    db.add_all(
        UserPermission(user_id=user.id, capability=capability, effect="grant")
        for capability in capabilities
    )
    db.commit()
    db.refresh(user)
    return user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


_SAMPLE_TEXT = (
    "Make: Toyota\nModel: Land Cruiser\nModel Year: 2024\nVIN: JTMHV05J904123456\n"
    "Registration Expiry: 01/01/2027\nInsurance Expiry: 01/12/2026\nColour: White\n"
)


def test_vehicle_edit_without_permits_edit_can_scan(
    api_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        vehicle_profile_scan_service, "ocr_bytes_to_text", lambda data: _SAMPLE_TEXT
    )
    user = _user(api_db, email="editor@test.ae", capabilities=("vehicles.view", "vehicles.edit"))
    client = _client(api_db, user)

    response = client.post(
        "/api/v1/vehicles/scan-licence",
        files={"file": ("m.jpg", b"x", "image/jpeg")},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["make"] == "Toyota"
    assert body["model"] == "Land Cruiser"
    assert body["model_year"] == 2024
    assert body["vin"] == "JTMHV05J904123456"
    assert body["license_expiry"] == "2027-01-01"
    assert body["insurance_expiry"] == "2026-12-01"
    assert body["colour"] == "White"
    assert "OCR_REVIEW_REQUIRED" in body["warnings"]


def test_viewer_without_edit_capability_cannot_scan(api_db: Session) -> None:
    user = _user(api_db, email="viewer@test.ae", capabilities=("vehicles.view",))
    client = _client(api_db, user)

    response = client.post(
        "/api/v1/vehicles/scan-licence",
        files={"file": ("m.jpg", b"x", "image/jpeg")},
    )

    assert response.status_code == 403, response.text
    assert response.json()["error"]["details"]["capability"] == "vehicles.edit"


def test_unavailable_engine_returns_review_warning_not_field_erasure(
    api_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _raise(data: bytes) -> str:
        raise OcrUnavailableError("tesseract missing")

    monkeypatch.setattr(vehicle_profile_scan_service, "ocr_bytes_to_text", _raise)
    user = _user(api_db, email="editor@test.ae", capabilities=("vehicles.view", "vehicles.edit"))
    client = _client(api_db, user)

    response = client.post(
        "/api/v1/vehicles/scan-licence",
        files={"file": ("m.jpg", b"x", "image/jpeg")},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["warnings"] == ["OCR_UNAVAILABLE"]
    assert body["make"] is None
    assert body["plate_code"] is None
    assert body["unmapped"] == {}


def test_invalid_image_returns_422(api_db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(data: bytes) -> str:
        raise InvalidImageError("not a readable image")

    monkeypatch.setattr(vehicle_profile_scan_service, "ocr_bytes_to_text", _raise)
    user = _user(api_db, email="editor@test.ae", capabilities=("vehicles.view", "vehicles.edit"))
    client = _client(api_db, user)

    response = client.post(
        "/api/v1/vehicles/scan-licence",
        files={"file": ("m.jpg", b"x", "image/jpeg")},
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "VEHICLE_SCAN_INVALID_IMAGE"


def test_no_fields_found_returns_empty_result_with_warning(
    api_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        vehicle_profile_scan_service, "ocr_bytes_to_text", lambda data: "nothing useful here"
    )
    user = _user(api_db, email="editor@test.ae", capabilities=("vehicles.view", "vehicles.edit"))
    client = _client(api_db, user)

    response = client.post(
        "/api/v1/vehicles/scan-licence",
        files={"file": ("m.jpg", b"x", "image/jpeg")},
    )

    assert response.status_code == 200, response.text
    assert response.json()["warnings"] == ["OCR_NO_FIELDS"]


def test_scan_vehicle_profile_splits_recognizable_plate(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        vehicle_profile_scan_service,
        "ocr_bytes_to_text",
        lambda data: "Traffic Plate No: 14\\58216\n",
    )
    scan = vehicle_profile_scan_service.scan_vehicle_profile(b"x")
    assert scan.plate_code == "14"
    assert scan.plate_number == "58216"


def test_scan_vehicle_profile_flags_unparseable_plate_as_unmapped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        vehicle_profile_scan_service,
        "ocr_bytes_to_text",
        lambda data: "Traffic Plate No: A45213\n",
    )
    scan = vehicle_profile_scan_service.scan_vehicle_profile(b"x")
    assert scan.plate_code is None
    assert scan.plate_number is None
    assert scan.unmapped["plate_no"] == "A45213"
