"""Maintenance requests exercise real General Book rendering; only Word is stubbed."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from docx import Document as DocxDocument
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import Settings
from app.db.models import (
    AuditLog,
    Book,
    BookCategory,
    BookVersion,
    Document,
    Employee,
    GeneralBookRecipient,
    User,
    VehicleMaintenanceRequest,
    VehicleOdometerReading,
)
from app.db.session import get_db
from app.main import create_app
from app.schemas.vehicle import VehicleMaintenanceRequestCreate
from app.services import artifact_service, document_service, vehicle_letter_service
from tests.conftest import make_user
from tests.test_vehicle_letters import _all_docx_text, _table_text


@dataclass(frozen=True)
class _RequestEnv:
    db: Session
    client: TestClient
    settings: Settings
    user: User
    vehicle_id: int
    contractor: GeneralBookRecipient


@pytest.fixture()
def request_env(api_db: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> _RequestEnv:
    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(artifact_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda _path: None)
    contractor = GeneralBookRecipient(name="شركة ورشة الأمان", name_ar="ورشة بديلة")
    api_db.add_all(
        [
            BookCategory(id="GS", prefix="GS"),
            Employee(id="G4101", name_en="Test Driver", name_ar="سالم الاختباري"),
            contractor,
        ]
    )
    api_db.commit()
    user = make_user(api_db, role="admin", email="maintenance-requests@test.ae")
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app, raise_server_exceptions=True)
    vehicle_id = _create_vehicle(client)
    return _RequestEnv(api_db, client, settings, user, vehicle_id, contractor)


def _create_vehicle(client: TestClient, *, plate_number: str = "58216") -> int:
    response = client.post(
        "/api/v1/vehicles",
        json={
            "plate_code": "14",
            "plate_number": plate_number,
            "traffic_code": "1180021637",
            "type_ar": "باص خفيف",
            "type_en": "Light bus",
            "class_ar": "خفيف",
            "class_en": "Light",
            "make": "Toyota",
            "model": "Hiace",
            "model_year": 2024,
            "vin": f"JT123456789{plate_number}",
            "new_site": {"name_ar": "موقع الاختبار", "name_en": "Test Site"},
            "license_start": "2026-01-01",
            "license_expiry": "2099-12-31",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _set_contractor(env: _RequestEnv) -> None:
    response = env.client.put(
        "/api/v1/vehicles/maintenance-contractor",
        json={"maintenance_contractor_id": env.contractor.id},
    )
    assert response.status_code == 200, response.text
    assert response.json()["maintenance_contractor_id"] == env.contractor.id
    assert response.json()["maintenance_contractor_name"] == "شركة ورشة الأمان"


def _create_request(env: _RequestEnv, **overrides: Any) -> dict[str, Any]:
    response = env.client.post(
        f"/api/v1/vehicles/{env.vehicle_id}/maintenance-requests",
        json={"type": "repair", "description": "فحص المحرك", **overrides},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _list_requests(env: _RequestEnv) -> list[dict[str, Any]]:
    response = env.client.get(f"/api/v1/vehicles/{env.vehicle_id}/maintenance-requests")
    assert response.status_code == 200, response.text
    return response.json()


def _add_maintenance(env: _RequestEnv, **overrides: Any) -> dict[str, Any]:
    response = env.client.post(
        "/api/v1/vehicles/maintenance",
        json={
            "vehicle_id": env.vehicle_id,
            "date": "2026-09-20",
            "type": "service",
            "odometer_km": 125500,
            "cost": 875,
            **overrides,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_contractor_setting_round_trips_and_can_be_cleared(request_env: _RequestEnv) -> None:
    env = request_env
    summary = env.client.get("/api/v1/vehicles/summary")
    assert summary.status_code == 200, summary.text
    assert summary.json()["maintenance_contractor_id"] is None
    assert summary.json()["maintenance_contractor_name"] is None
    _set_contractor(env)
    summary = env.client.get("/api/v1/vehicles/summary")
    assert summary.status_code == 200, summary.text
    assert summary.json()["maintenance_contractor_id"] == env.contractor.id
    assert summary.json()["maintenance_contractor_name"] == "شركة ورشة الأمان"
    cleared = env.client.put(
        "/api/v1/vehicles/maintenance-contractor", json={"maintenance_contractor_id": None}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["maintenance_contractor_id"] is None
    assert cleared.json()["maintenance_contractor_name"] is None


@pytest.mark.parametrize("closing_km,expected_km", [(126450, 126450), (None, 126000)])
def test_request_files_real_general_book_for_contractor_with_vehicle_and_last_maintenance(
    request_env: _RequestEnv, closing_km: int | None, expected_km: int
) -> None:
    env = request_env
    _set_contractor(env)
    _add_maintenance(env)
    _add_maintenance(env, date="2026-09-02", odometer_km=120000, cost=200, type="tires")
    # Insert the older month last: latest is by month, not insertion order.
    env.db.add_all(
        [
            VehicleOdometerReading(
                vehicle_id=env.vehicle_id,
                month="2026-10",
                opening_km=126000,
                closing_km=closing_km,
            ),
            VehicleOdometerReading(
                vehicle_id=env.vehicle_id,
                month="2026-08",
                opening_km=124000,
                closing_km=125000,
            ),
        ]
    )
    env.db.commit()
    detail = env.client.get(f"/api/v1/vehicles/{env.vehicle_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["current_odometer_km"] == expected_km
    description = "فحص <المحرك> & تبديل الزيت"
    result = _create_request(env, description=description, employee_id="G4101")
    request, letter = result["request"], result["letter"]
    assert request["vehicle_id"] == env.vehicle_id
    assert request["employee_id"] == "G4101"
    assert request["type"] == "repair"
    assert request["description"] == description
    assert request["odometer_km"] == expected_km
    assert request["status"] == "open"
    assert request["maintenance_id"] is None
    assert request["completed_at"] is None
    assert request["created_by_user_id"] == env.user.id
    assert request["created_at"]
    assert request["book_id"] == letter["book_id"]
    assert request["ref_number"] == letter["ref_number"]
    assert letter["ref_number"]
    assert letter["pdf_available"] is False
    assert _list_requests(env) == [request]

    book = env.db.get(Book, letter["book_id"])
    assert book is not None
    assert book.category_id == "GS"
    assert book.classification_code == "11/1"
    assert book.subject == "طلب صيانة مركبة — 14 / 58216"
    assert book.ref_number == letter["ref_number"]
    assert book.created_by_user_id == env.user.id
    version = env.db.scalar(select(BookVersion).where(BookVersion.book_id == book.id))
    assert version is not None
    assert version.template_id == "General Book"
    assert version.document_id == letter["document_id"]
    assert version.fields is not None
    assert version.fields["recipient_id"] == env.contractor.id
    body = str(version.fields["body"])
    assert "&lt;المحرك&gt; &amp; تبديل الزيت" in body
    assert "<المحرك>" not in body
    for value in (
        "14 / 58216",
        "باص خفيف",
        "Toyota",
        "Hiace",
        "2024",
        "JT12345678958216",
        "موقع الاختبار",
        "سالم الاختباري",
        "G4101",
        str(expected_km),
        "20/09/2026",
        "صيانة دورية",
        "125500",
        "875",
        "إصلاح",
    ):
        assert value in body

    document = env.db.get(Document, letter["document_id"])
    assert document is not None
    assert document.template_id == "General Book"
    assert document.docx_path is not None
    path = Path(document.docx_path)
    if not path.is_absolute():
        path = env.settings.data_dir / path
    text = _all_docx_text(path)
    for value in ("شركة ورشة الأمان", "JT12345678958216", "سالم الاختباري", description):
        assert value in text
    rendered = DocxDocument(str(path))
    table_text = "\n".join(_table_text(table) for table in rendered.tables)
    for value in ("14 / 58216", "JT12345678958216", str(expected_km), "20/09/2026", "875"):
        assert value in table_text
    assert (
        env.db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "letter.generated"))
        == 1
    )


@pytest.mark.parametrize("deleted_contractor", [False, True], ids=["unset", "deleted"])
def test_request_requires_existing_contractor_without_creating_rows(
    request_env: _RequestEnv, deleted_contractor: bool
) -> None:
    env = request_env
    if deleted_contractor:
        _set_contractor(env)
        env.db.delete(env.contractor)
        env.db.commit()
    response = env.client.post(
        f"/api/v1/vehicles/{env.vehicle_id}/maintenance-requests",
        json={"type": "service", "description": "تبديل الزيت"},
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "MAINTENANCE_CONTRACTOR_MISSING"
    assert _list_requests(env) == []
    assert env.db.scalar(select(func.count(Book.id))) == 0
    assert env.db.scalar(select(func.count(Document.id))) == 0


@pytest.mark.parametrize("maintenance_km", [None, 125500])
def test_current_odometer_falls_back_to_latest_maintenance_or_remains_unknown(
    request_env: _RequestEnv, maintenance_km: int | None
) -> None:
    env = request_env
    _set_contractor(env)
    if maintenance_km is not None:
        _add_maintenance(env, odometer_km=maintenance_km)
        _add_maintenance(env, date="2026-08-01", odometer_km=120000)
    detail = env.client.get(f"/api/v1/vehicles/{env.vehicle_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["current_odometer_km"] == maintenance_km
    result = _create_request(env)
    assert result["request"]["odometer_km"] == maintenance_km
    version = env.db.scalar(
        select(BookVersion).where(BookVersion.book_id == result["letter"]["book_id"])
    )
    assert version is not None and version.fields is not None
    if maintenance_km is None:
        assert "لا توجد صيانة سابقة مسجلة" in str(version.fields["body"])


@pytest.mark.parametrize("snapshot_km", [None, 126500])
def test_explicit_odometer_is_preserved_in_request_snapshot(
    request_env: _RequestEnv, snapshot_km: int | None
) -> None:
    env = request_env
    _set_contractor(env)
    _add_maintenance(env)
    first = _create_request(env, odometer_km=snapshot_km)["request"]
    assert first["odometer_km"] == snapshot_km
    _add_maintenance(env, date="2026-10-15", odometer_km=130000)
    second = _create_request(env)["request"]
    assert second["odometer_km"] == 130000
    listed = _list_requests(env)
    assert [row["id"] for row in listed] == [second["id"], first["id"]]
    assert listed[1]["odometer_km"] == snapshot_km


def test_completion_links_and_closes_request_and_rejects_wrong_vehicle_or_reuse(
    request_env: _RequestEnv,
) -> None:
    env = request_env
    _set_contractor(env)
    request = _create_request(env, odometer_km=126500)["request"]
    other_vehicle_id = _create_vehicle(env.client, plate_number="58217")
    payload = {
        "vehicle_id": env.vehicle_id,
        "date": "2026-10-15",
        "type": "repair",
        "odometer_km": 126600,
        "cost": 1400,
        "request_id": request["id"],
    }
    wrong_vehicle = env.client.post(
        "/api/v1/vehicles/maintenance", json={**payload, "vehicle_id": other_vehicle_id}
    )
    assert wrong_vehicle.status_code == 422, wrong_vehicle.text
    assert wrong_vehicle.json()["error"]["code"] == "MAINTENANCE_REQUEST_NOT_OPEN"
    assert _list_requests(env) == [request]
    assert env.client.get("/api/v1/vehicles/maintenance").json() == []

    completed = env.client.post("/api/v1/vehicles/maintenance", json=payload)
    assert completed.status_code == 201, completed.text
    maintenance = completed.json()
    closed = _list_requests(env)[0]
    assert closed["status"] == "done"
    assert closed["maintenance_id"] == maintenance["id"]
    assert closed["completed_at"] is not None
    assert closed["book_id"] == request["book_id"]
    assert closed["ref_number"] == request["ref_number"]
    assert closed["odometer_km"] == 126500
    assert maintenance["odometer_km"] == 126600
    repeated = env.client.post("/api/v1/vehicles/maintenance", json=payload)
    assert repeated.status_code == 422, repeated.text
    assert repeated.json()["error"]["code"] == "MAINTENANCE_REQUEST_NOT_OPEN"
    assert _list_requests(env) == [closed]
    listed = env.client.get("/api/v1/vehicles/maintenance")
    assert listed.status_code == 200, listed.text
    assert [row["id"] for row in listed.json()] == [maintenance["id"]]


def test_request_commit_failure_rolls_back_generated_book_and_request(
    request_env: _RequestEnv,
) -> None:
    env = request_env
    _set_contractor(env)

    def fail_commit(_session: Session) -> None:
        assert list(env.settings.data_dir.rglob("*.docx")), "real rendering must run before commit"
        raise RuntimeError("maintenance request commit failed")

    event.listen(env.db, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="maintenance request commit failed"):
            vehicle_letter_service.create_maintenance_request(
                env.db,
                env.vehicle_id,
                VehicleMaintenanceRequestCreate(type="repair", description="فحص المحرك"),
                user=env.user,
            )
    finally:
        event.remove(env.db, "before_commit", fail_commit)
    # A fresh connection distinguishes true rollback from uncommitted session state.
    with Session(env.db.get_bind()) as persisted:
        for model in (VehicleMaintenanceRequest, Book, BookVersion, Document):
            assert persisted.scalar(select(func.count()).select_from(model)) == 0
        assert (
            persisted.scalar(
                select(func.count(AuditLog.id)).where(AuditLog.action == "letter.generated")
            )
            == 0
        )
    assert _list_requests(env) == []


def test_request_generation_failure_rolls_back_request_and_generated_document(
    request_env: _RequestEnv,
) -> None:
    env = request_env
    _set_contractor(env)
    engine = env.db.get_bind()

    def fail_document_insert(
        _connection, _cursor, statement, _parameters, _context, _executemany
    ) -> None:
        if statement.lstrip().upper().startswith("INSERT INTO DOCUMENTS "):
            assert list(env.settings.data_dir.rglob("*.docx"))
            raise RuntimeError("maintenance request generation failed")

    event.listen(engine, "before_cursor_execute", fail_document_insert)
    try:
        with pytest.raises(RuntimeError, match="maintenance request generation failed"):
            vehicle_letter_service.create_maintenance_request(
                env.db,
                env.vehicle_id,
                VehicleMaintenanceRequestCreate(type="repair", description="فحص المحرك"),
                user=env.user,
            )
    finally:
        event.remove(engine, "before_cursor_execute", fail_document_insert)
    with Session(engine) as persisted:
        for model in (VehicleMaintenanceRequest, Book, BookVersion, Document):
            assert persisted.scalar(select(func.count()).select_from(model)) == 0
    assert _list_requests(env) == []


def test_classified_reference_retry_preserves_request_and_book_link(
    request_env: _RequestEnv,
) -> None:
    env = request_env
    _set_contractor(env)
    engine = env.db.get_bind()
    failed = False

    def fail_first_sequence_insert(
        _connection, _cursor, statement, parameters, _context, _executemany
    ) -> None:
        nonlocal failed
        if not failed and statement.lstrip().upper().startswith(
            "INSERT INTO CLASSIFIED_REF_SEQUENCE "
        ):
            failed = True
            raise OperationalError(statement, parameters, RuntimeError("database is locked"))

    event.listen(engine, "before_cursor_execute", fail_first_sequence_insert)
    try:
        result = _create_request(env)
    finally:
        event.remove(engine, "before_cursor_execute", fail_first_sequence_insert)
    assert failed
    request = result["request"]
    assert request["id"] is not None
    assert request["book_id"] == result["letter"]["book_id"]
    assert _list_requests(env) == [request]
    with Session(engine) as persisted:
        assert persisted.get(VehicleMaintenanceRequest, request["id"]) is not None
        assert persisted.get(Book, request["book_id"]) is not None
        audit = persisted.scalar(select(AuditLog).where(AuditLog.action == "letter.generated"))
        assert audit is not None and f'"maintenance_request_id": {request["id"]}' in audit.payload


def test_deferred_generation_rejects_revision_before_replacing_files(api_db: Session) -> None:
    with pytest.raises(ValueError, match="new book without attachments"):
        document_service.generate_document(
            api_db,
            employee_id=None,
            template_id="General Book",
            fields={},
            defer_commit=True,
            revise_of_book_id=1,
        )
