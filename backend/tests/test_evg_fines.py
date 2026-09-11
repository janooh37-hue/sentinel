"""Pure EVG parsing and vehicle fine import service contracts."""

from __future__ import annotations

import concurrent.futures
import json
import threading
import time
from collections.abc import Iterator
from datetime import date
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import EvgError, ValidationFailedError
from app.core.evg_fines import (
    EvgTicketRow,
    parse_tickets_payload,
    plate_code_from_color_code,
)
from app.db.models import AuditLog, User, Vehicle, VehicleFine, VehicleSite
from app.db.session import get_db
from app.main import create_app
from app.schemas.vehicle import EvgConfirmRow
from app.services import evg_client, vehicle_evg_jobs, vehicle_evg_service

TICKETS_PAYLOAD: dict[str, object] = {
    "ResponseValue": {
        "Tickets": [
            {
                "TicketID": {
                    "TicketNo": 8101,
                    "TicketYear": 2026,
                    "TicketSourceCode": 1,
                    "TicketDate": "2026-08-20T00:00:00",
                    "IsExternalTicket": False,
                },
                "TicketTime": "2026-08-20T12:37:20",
                "TicketType": "A",
                "LocationDescAr": "طريق المطار التجريبي",
                "LocationDescEn": "Synthetic Airport Road",
                "DriverTcfNo": None,
                "LicenseInfo": None,
                "PlateInfo": {
                    "PlateNo": " 55501 ",
                    "PlateOrgNo": 0,
                    "PlateColorCode": 72,
                    "PlateKindCode": 1,
                    "PlateTypeCode": None,
                    "PlateSourceCode": 1,
                },
                "VehicleOwnerTcfNo": 7770001234,
                "IsWebPayable": True,
                "LateCharges": 20.6,
                "TotalAmount": 600.4,
                "DiscountRate": 10.4,
                "TotalAmountAfterDiscount": 540.6,
                "BlackPoints": 4,
                "MaterialsList": [
                    {
                        "MaterialCode": 1001,
                        "MaterialArabicDesc": "مخالفة سرعة تجريبية",
                        "MaterialEnglishDesc": "Synthetic speeding violation",
                        "MaterialAmount": 300,
                        "DiscountRate": 10.4,
                        "AmountAfterDiscount": 270,
                    },
                    {
                        "MaterialCode": 1002,
                        "MaterialArabicDesc": "مخالفة مسار تجريبية",
                        "MaterialEnglishDesc": "Synthetic lane violation",
                        "MaterialAmount": 300,
                        "DiscountRate": 10.4,
                        "AmountAfterDiscount": 270,
                    },
                ],
                "TicketStatus": None,
                "PaymentDate": None,
            },
            {
                "TicketID": {
                    "TicketNo": 8102,
                    "TicketYear": 2026,
                    "TicketSourceCode": 1,
                    "TicketDate": "2026-08-21T00:00:00",
                    "IsExternalTicket": False,
                },
                "TicketTime": None,
                "TicketType": "Camera",
                "LocationDescAr": "موقع تجريبي ثان",
                "LocationDescEn": "",
                "PlateInfo": {
                    "PlateNo": 77702,
                    "PlateColorCode": 166,
                },
                "LateCharges": None,
                "TotalAmount": 300.6,
                "DiscountRate": 0.6,
                "TotalAmountAfterDiscount": None,
                "BlackPoints": None,
                "MaterialsList": [
                    {
                        "MaterialArabicDesc": "وصف عربي تجريبي",
                        "MaterialEnglishDesc": None,
                    },
                    {
                        "MaterialArabicDesc": " ",
                        "MaterialEnglishDesc": "",
                    },
                ],
            },
            {
                "TicketID": {
                    "TicketNo": 8101,
                    "TicketDate": "2026-08-22T00:00:00",
                },
                "TicketTime": "2026-08-22T08:05:00",
                "TicketType": "A",
                "LocationDescEn": "Duplicate should be ignored",
                "PlateInfo": {
                    "PlateNo": "99991",
                    "PlateColorCode": 70,
                },
                "TotalAmount": 900,
                "DiscountRate": 0,
                "TotalAmountAfterDiscount": 900,
                "LateCharges": 0,
                "BlackPoints": 0,
                "MaterialsList": [],
            },
            {
                "TicketID": {
                    "TicketNo": 8103,
                    "TicketDate": "2026-08-23T00:00:00",
                },
                "TicketTime": "2026-08-23T09:00:00",
                "TicketType": "A",
                "LocationDescEn": "Zero amount should be ignored",
                "PlateInfo": {
                    "PlateNo": "99992",
                    "PlateColorCode": 70,
                },
                "TotalAmount": 0,
                "DiscountRate": 0,
                "TotalAmountAfterDiscount": 0,
                "LateCharges": 0,
                "BlackPoints": 0,
                "MaterialsList": [],
            },
            {
                "TicketID": {
                    "TicketDate": "2026-08-24T00:00:00",
                },
                "TicketTime": "2026-08-24T10:00:00",
                "TicketType": "A",
                "LocationDescEn": "Missing number should be ignored",
                "PlateInfo": {
                    "PlateNo": "99993",
                    "PlateColorCode": 70,
                },
                "TotalAmount": 500,
                "DiscountRate": 0,
                "TotalAmountAfterDiscount": 500,
                "LateCharges": 0,
                "BlackPoints": 0,
                "MaterialsList": [],
            },
        ]
    },
    "OperationSucceded": True,
    "ResponseCode": 5,
    "ResponseCodeMessage": "OperationSucceeded",
    "Exception": None,
}


def test_parse_tickets_payload_maps_rows_and_skips_unusable() -> None:
    assert parse_tickets_payload(TICKETS_PAYLOAD) == [
        EvgTicketRow(
            ticket_no="8101",
            date=date(2026, 8, 20),
            time="12:37",
            location="Synthetic Airport Road",
            plate_number="55501",
            plate_code="21",
            amount=600,
            discount_pct=10,
            amount_after_discount=541,
            late_charges=21,
            black_points=4,
            fine_type="Absent",
            descriptions=(
                "Synthetic speeding violation",
                "Synthetic lane violation",
            ),
        ),
        EvgTicketRow(
            ticket_no="8102",
            date=date(2026, 8, 21),
            time=None,
            location="موقع تجريبي ثان",
            plate_number="77702",
            plate_code=None,
            amount=301,
            discount_pct=1,
            amount_after_discount=None,
            late_charges=0,
            black_points=0,
            fine_type="Camera",
            descriptions=("وصف عربي تجريبي",),
        ),
    ]


@pytest.mark.parametrize(
    ("color_code", "expected"),
    [
        (70, "19"),
        (72, "21"),
        (52, "1"),
        (110, "59"),
        (51, None),
        (111, None),
        (166, None),
        (None, None),
        ("x", None),
    ],
)
def test_plate_code_from_color_code_maps_verified_range(
    color_code: object,
    expected: str | None,
) -> None:
    assert plate_code_from_color_code(color_code) == expected


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"ResponseValue": {"Tickets": "not-a-list"}},
    ],
)
def test_parse_tickets_payload_rejects_an_unusable_envelope(payload: object) -> None:
    with pytest.raises(ValueError):
        parse_tickets_payload(payload)


def test_fetch_tickets_calls_portal_api_and_returns_mapped_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.method == "GET"
        assert str(request.url) == ("https://evg.ae/PortalApi/api/UTSTickets/7770001234")
        return httpx.Response(200, json=TICKETS_PAYLOAD)

    monkeypatch.setattr(evg_client, "_transport", httpx.MockTransport(handler))

    expected = parse_tickets_payload(TICKETS_PAYLOAD)
    assert evg_client.fetch_tickets("7770001234") == expected
    assert len(requests) == 1


def test_fetch_tickets_retries_once_when_the_edge_stalls_a_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """EVG's bot-defence edge stalls a burst instead of answering it."""

    attempts: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        if len(attempts) == 1:
            raise httpx.ReadTimeout("synthetic edge stall", request=request)
        return httpx.Response(200, json=TICKETS_PAYLOAD)

    monkeypatch.setattr(evg_client, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(evg_client, "_RETRY_BACKOFF_S", 0.0)

    assert evg_client.fetch_tickets("7770001234") == parse_tickets_payload(TICKETS_PAYLOAD)
    assert len(attempts) == 2


def test_fetch_tickets_gives_up_after_one_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        raise httpx.ReadTimeout("synthetic edge stall", request=request)

    monkeypatch.setattr(evg_client, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(evg_client, "_RETRY_BACKOFF_S", 0.0)

    with pytest.raises(EvgError) as raised:
        evg_client.fetch_tickets("7770001234")

    assert raised.value.code == "EVG_UNAVAILABLE"
    assert len(attempts) == 2


@pytest.mark.parametrize(
    ("case", "expected_fragment"),
    [
        ("http_status", "500"),
        ("invalid_json", None),
        ("operation_failed", "Synthetic upstream outage reference"),
        ("transport_error", None),
    ],
)
def test_fetch_tickets_maps_upstream_failures_without_leaking_markup(
    monkeypatch: pytest.MonkeyPatch,
    case: str,
    expected_fragment: str | None,
) -> None:
    raw_html = "<!DOCTYPE html><h1>synthetic upstream failure</h1>"
    upstream_message = (
        "Synthetic upstream outage reference <b>formatting</b> " + ("x" * 400) + "UNSAFE_TAIL"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if case == "http_status":
            return httpx.Response(500, text=raw_html)
        if case == "invalid_json":
            return httpx.Response(200, text="<not-json>")
        if case == "operation_failed":
            return httpx.Response(
                200,
                json={
                    "ResponseValue": {"Tickets": []},
                    "OperationSucceded": False,
                    "ResponseCodeMessage": upstream_message,
                },
            )
        raise httpx.ConnectError("synthetic connection refused", request=request)

    monkeypatch.setattr(evg_client, "_transport", httpx.MockTransport(handler))

    with pytest.raises(EvgError) as raised:
        evg_client.fetch_tickets("7770001234")

    assert raised.value.code == "EVG_UNAVAILABLE"
    message = raised.value.message
    assert "<" not in message
    assert "doctype" not in message.casefold()
    assert raw_html not in message
    if expected_fragment is not None:
        assert expected_fragment in message
    if case == "operation_failed":
        assert "UNSAFE_TAIL" not in message


def _ticket(
    ticket_no: str,
    *,
    plate_number: str,
    time: str | None = None,
    plate_code: str | None = None,
    amount: int = 600,
    amount_after_discount: int | None = 600,
    black_points: int = 4,
    location: str = "Synthetic Airport Road",
    descriptions: tuple[str, ...] = (),
) -> EvgTicketRow:
    return EvgTicketRow(
        ticket_no=ticket_no,
        date=date(2026, 8, 20),
        time=time,
        location=location,
        plate_number=plate_number,
        plate_code=plate_code,
        amount=amount,
        discount_pct=0,
        amount_after_discount=amount_after_discount,
        late_charges=0,
        black_points=black_points,
        fine_type="Absent",
        descriptions=descriptions,
    )


def _vehicle(site_id: int, *, plate_code: str) -> Vehicle:
    return Vehicle(
        plate_code=plate_code,
        plate_number="55501",
        traffic_code="7770001234",
        type_ar="مركبة اختبار",
        type_en="Test vehicle",
        class_ar="مركبة خفيفة",
        class_en="Light vehicle",
        site_id=site_id,
        license_start=date(2026, 1, 1),
        license_expiry=date(2027, 1, 1),
    )


def _confirm_payload(
    ticket_no: str,
    vehicle_id: int,
    **overrides: object,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "ticket_no": ticket_no,
        "date": "2026-08-24",
        "time": "12:37",
        "location": "Synthetic Airport Road",
        "plate_number": "55501",
        "plate_code": "21",
        "amount": 600,
        "amount_after_discount": 600,
        "black_points": 0,
        "fine_type": "Absent",
        "description": "EVG trust-boundary test",
        "vehicle_id": vehicle_id,
        "match": "matched",
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def evg_admin_client(api_db: Session) -> TestClient:
    user = User(
        email="evg-admin@test.ae",
        password_hash="x",
        role="admin",
        status="active",
    )
    api_db.add(user)
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture(autouse=True)
def _evg_jobs_teardown() -> Iterator[None]:
    yield
    vehicle_evg_jobs.shutdown()


def _client_for_user(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _wait_for_evg_job(
    client: TestClient,
    job_id: str,
    *,
    timeout: float = 5,
) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    while True:
        response = client.get(f"/api/v1/vehicles/fines/evg/preview/{job_id}")
        assert response.status_code == 200, response.text
        body = response.json()
        if body["status"] in {"done", "failed"}:
            return body
        if time.monotonic() >= deadline:
            pytest.fail(f"EVG preview job {job_id} did not finish within {timeout} seconds")
        time.sleep(0.05)


@pytest.fixture()
def evg_fleet(db_session: Session, admin_user: User) -> dict[str, object]:
    site = VehicleSite(name_ar="موقع الاختبار", name_en="Test Site")
    db_session.add(site)
    db_session.flush()
    vehicle_10 = _vehicle(site.id, plate_code="10")
    vehicle_21 = _vehicle(site.id, plate_code="21")
    db_session.add_all([vehicle_10, vehicle_21])
    db_session.flush()
    imported = VehicleFine(
        vehicle_id=vehicle_10.id,
        employee_id=None,
        date=date(2026, 8, 1),
        amount=400,
        amount_after_discount=400,
        black_points=0,
        source="evg",
        evg_ticket_no="9004",
        location="Previously imported",
        description="Existing description",
        fine_type="Absent",
        created_by_user_id=admin_user.id,
    )
    db_session.add(imported)
    db_session.commit()
    return {
        "vehicle_10": vehicle_10,
        "vehicle_21": vehicle_21,
        "imported": imported,
    }


def test_preview_classifies_matched_ambiguous_unmatched_and_imported(
    db_session: Session,
    admin_user: User,
    evg_fleet: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    vehicle_10 = evg_fleet["vehicle_10"]
    vehicle_21 = evg_fleet["vehicle_21"]
    assert isinstance(vehicle_10, Vehicle)
    assert isinstance(vehicle_21, Vehicle)

    rows = [
        _ticket(
            "9001",
            plate_number="55501",
            time="12:37",
            plate_code="21",
            descriptions=("Speeding", "Lane violation"),
        ),
        _ticket(
            "9002",
            plate_number="55501",
            time="08:05",
            plate_code=None,
            amount=300,
            amount_after_discount=270,
            black_points=0,
            location="Synthetic Al Ain Road",
            descriptions=("Parking violation",),
        ),
        _ticket("9003", plate_number="99999"),
        _ticket("9004", plate_number="55501"),
    ]

    def fake_fetch_tickets(
        tcn: str,
        *,
        timeout_s: float = 30.0,
    ) -> list[EvgTicketRow]:
        assert tcn == "7770001234"
        assert timeout_s == 30.0
        return rows

    monkeypatch.setattr(vehicle_evg_service, "fetch_tickets", fake_fetch_tickets)

    preview = vehicle_evg_service.preview(
        db_session,
        traffic_codes=["7770001234"],
    )

    assert preview.traffic_codes == ["7770001234"]
    assert [
        (
            row.ticket_no,
            row.match,
            row.vehicle_id,
            row.plate_code,
            row.time,
            row.description,
        )
        for row in preview.rows
    ] == [
        ("9001", "matched", vehicle_21.id, "21", "12:37", "Speeding ؛ Lane violation"),
        ("9002", "ambiguous", None, None, "08:05", "Parking violation"),
        ("9003", "unmatched", None, None, None, None),
        ("9004", "already_imported", vehicle_10.id, None, None, None),
    ]
    assert {(option.id, option.plate_label) for option in preview.vehicles} == {
        (vehicle_10.id, "10 \\ 55501"),
        (vehicle_21.id, "21 \\ 55501"),
    }


def test_preview_returns_accepted_while_fetch_is_blocked_then_imports(
    api_db: Session,
    evg_admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    site = VehicleSite(name_ar="موقع اختبار المهام", name_en="Job Test Site")
    api_db.add(site)
    api_db.flush()
    vehicle = _vehicle(site.id, plate_code="21")
    api_db.add(vehicle)
    api_db.commit()

    latch = threading.Event()
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

    def blocked_fetch_tickets(
        tcn: str,
        *,
        timeout_s: float = 30.0,
    ) -> list[EvgTicketRow]:
        assert tcn == "7770001234"
        assert timeout_s == 30.0
        latch.wait()
        return [
            _ticket(
                "9050",
                plate_number="55501",
                time="12:37",
                plate_code="21",
                descriptions=("Synthetic speeding violation",),
            )
        ]

    monkeypatch.setattr(vehicle_evg_service, "fetch_tickets", blocked_fetch_tickets)

    try:
        response_future = executor.submit(
            evg_admin_client.post,
            "/api/v1/vehicles/fines/evg/preview",
            json={"traffic_codes": ["7770001234"]},
        )
        try:
            response = response_future.result(timeout=5)
        except concurrent.futures.TimeoutError:
            pytest.fail(
                "Synchronous preview route did not return HTTP 202 while EVG fetching was blocked"
            )

        assert not latch.is_set()
        assert response.status_code == 202
        job_id = response.json()["job_id"]
        assert isinstance(job_id, str)
        assert job_id

        status_response = evg_admin_client.get(f"/api/v1/vehicles/fines/evg/preview/{job_id}")
        assert status_response.status_code == 200
        pending_job = status_response.json()
        assert pending_job["status"] in {"queued", "running"}
        assert pending_job["result"] is None

        latch.set()
        deadline = time.monotonic() + 5
        while True:
            status_response = evg_admin_client.get(f"/api/v1/vehicles/fines/evg/preview/{job_id}")
            assert status_response.status_code == 200
            completed_job = status_response.json()
            if completed_job["status"] == "done":
                break
            if time.monotonic() >= deadline:
                pytest.fail("EVG preview job did not finish within 5 seconds")
            time.sleep(0.05)

        rows = completed_job["result"]["rows"]
        assert len(rows) == 1
        row = rows[0]
        assert row["ticket_no"] == "9050"
        assert row["match"] == "matched"
        assert row["vehicle_id"] == vehicle.id

        assert evg_admin_client.get("/api/v1/vehicles/fines").json() == []

        confirm_row = dict(row)
        confirm_row["vehicle_id"] = vehicle.id
        confirm_response = evg_admin_client.post(
            "/api/v1/vehicles/fines/evg/confirm",
            json={"rows": [confirm_row]},
        )
        assert confirm_response.status_code == 200
        assert confirm_response.json()["created"] == 1

        fines = evg_admin_client.get("/api/v1/vehicles/fines").json()
        assert len(fines) == 1
        assert fines[0]["evg_ticket_no"] == "9050"
        assert fines[0]["amount"] == 600
        assert fines[0]["vehicle_id"] == vehicle.id

        repeated_confirm = evg_admin_client.post(
            "/api/v1/vehicles/fines/evg/confirm",
            json={"rows": [confirm_row]},
        )
        assert repeated_confirm.status_code == 200
        assert repeated_confirm.json()["created"] == 0
        assert repeated_confirm.json()["skipped"] == 1
        assert len(evg_admin_client.get("/api/v1/vehicles/fines").json()) == 1
    finally:
        latch.set()
        executor.shutdown(wait=True)
        vehicle_evg_jobs.shutdown()


def test_polling_running_job_remains_responsive_with_second_job_queued(
    evg_admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_started = threading.Event()
    release = threading.Event()

    def blocked_fetch_tickets(
        _tcn: str,
        *,
        timeout_s: float = 30.0,
    ) -> list[EvgTicketRow]:
        first_started.set()
        release.wait()
        return []

    monkeypatch.setattr(vehicle_evg_service, "fetch_tickets", blocked_fetch_tickets)

    first_id = ""
    second_id = ""
    try:
        first = evg_admin_client.post(
            "/api/v1/vehicles/fines/evg/preview",
            json={"traffic_codes": ["1111111111"]},
        )
        assert first.status_code == 202, first.text
        first_id = first.json()["job_id"]
        assert first_started.wait(timeout=5)

        second = evg_admin_client.post(
            "/api/v1/vehicles/fines/evg/preview",
            json={"traffic_codes": ["2222222222"]},
        )
        assert second.status_code == 202, second.text
        second_id = second.json()["job_id"]

        running = evg_admin_client.get(f"/api/v1/vehicles/fines/evg/preview/{first_id}")
        queued = evg_admin_client.get(f"/api/v1/vehicles/fines/evg/preview/{second_id}")
        assert running.status_code == 200, running.text
        assert queued.status_code == 200, queued.text
        assert running.json() == {
            "job_id": first_id,
            "status": "running",
            "result": None,
            "error_code": None,
            "error_message": None,
        }
        assert queued.json() == {
            "job_id": second_id,
            "status": "queued",
            "result": None,
            "error_code": None,
            "error_message": None,
        }
    finally:
        release.set()

    assert _wait_for_evg_job(evg_admin_client, first_id)["status"] == "done"
    assert _wait_for_evg_job(evg_admin_client, second_id)["status"] == "done"


def test_known_evg_error_marks_job_failed_without_persisting_fines(
    api_db: Session,
    evg_admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def failed_fetch_tickets(
        _tcn: str,
        *,
        timeout_s: float = 30.0,
    ) -> list[EvgTicketRow]:
        raise EvgError("EVG_UNAVAILABLE", "EVG portal is unavailable.")

    monkeypatch.setattr(vehicle_evg_service, "fetch_tickets", failed_fetch_tickets)

    response = evg_admin_client.post(
        "/api/v1/vehicles/fines/evg/preview",
        json={"traffic_codes": ["1111111111"]},
    )
    assert response.status_code == 202, response.text
    job = _wait_for_evg_job(evg_admin_client, response.json()["job_id"])

    assert job["status"] == "failed"
    assert job["result"] is None
    assert job["error_code"] == "EVG_UNAVAILABLE"
    assert job["error_message"] == "EVG portal is unavailable."
    assert api_db.query(VehicleFine).count() == 0


def test_unexpected_evg_error_is_redacted_and_marks_job_failed(
    api_db: Session,
    evg_admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret_text = "raw upstream HTML must stay private"

    def failed_fetch_tickets(
        _tcn: str,
        *,
        timeout_s: float = 30.0,
    ) -> list[EvgTicketRow]:
        raise RuntimeError(secret_text)

    monkeypatch.setattr(vehicle_evg_service, "fetch_tickets", failed_fetch_tickets)

    response = evg_admin_client.post(
        "/api/v1/vehicles/fines/evg/preview",
        json={"traffic_codes": ["1111111111"]},
    )
    assert response.status_code == 202, response.text
    job = _wait_for_evg_job(evg_admin_client, response.json()["job_id"])

    assert job == {
        "job_id": response.json()["job_id"],
        "status": "failed",
        "result": None,
        "error_code": "EVG_UNAVAILABLE",
        "error_message": "EVG fine fetching failed.",
    }
    assert secret_text not in json.dumps(job)
    assert api_db.query(VehicleFine).count() == 0


def test_preview_job_lookup_hides_other_owners_and_unknown_ids(
    api_db: Session,
    evg_admin_client: TestClient,
) -> None:
    submitted = evg_admin_client.post(
        "/api/v1/vehicles/fines/evg/preview",
        json={"traffic_codes": []},
    )
    assert submitted.status_code == 202, submitted.text
    job_id = submitted.json()["job_id"]

    other_user = User(
        email="other-evg-admin@test.ae",
        password_hash="x",
        role="admin",
        status="active",
    )
    api_db.add(other_user)
    api_db.commit()
    other_client = _client_for_user(api_db, other_user)

    hidden = other_client.get(f"/api/v1/vehicles/fines/evg/preview/{job_id}")
    unknown = evg_admin_client.get(f"/api/v1/vehicles/fines/evg/preview/{uuid4()}")
    vehicle_evg_jobs.shutdown()
    restarted = evg_admin_client.get(f"/api/v1/vehicles/fines/evg/preview/{job_id}")

    assert hidden.status_code == 404, hidden.text
    assert unknown.status_code == 404, unknown.text
    assert restarted.status_code == 404, restarted.text
    assert (
        hidden.json()
        == unknown.json()
        == restarted.json()
        == {
            "error": {
                "code": "EVG_PREVIEW_JOB_NOT_FOUND",
                "message": "EVG preview job not found.",
                "details": {},
            }
        }
    )


def test_preview_requires_vehicle_edit_capability(api_db: Session) -> None:
    user = User(
        email="evg-no-edit@test.ae",
        password_hash="x",
        role="operator",
        status="active",
    )
    api_db.add(user)
    api_db.commit()
    client = _client_for_user(api_db, user)

    post = client.post(
        "/api/v1/vehicles/fines/evg/preview",
        json={"traffic_codes": []},
    )
    get = client.get(f"/api/v1/vehicles/fines/evg/preview/{uuid4()}")

    assert post.status_code == 403, post.text
    assert get.status_code == 403, get.text
    assert post.json()["error"]["details"]["capability"] == "vehicles.edit"
    assert get.json()["error"]["details"]["capability"] == "vehicles.edit"


def test_preview_queue_capacity_evicts_oldest_terminal_job(
    evg_admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vehicle_evg_jobs, "_MAX_JOBS", 1)
    started = threading.Event()
    release = threading.Event()

    def blocked_fetch_tickets(
        _tcn: str,
        *,
        timeout_s: float = 30.0,
    ) -> list[EvgTicketRow]:
        started.set()
        release.wait()
        return []

    monkeypatch.setattr(vehicle_evg_service, "fetch_tickets", blocked_fetch_tickets)

    first_id = ""
    try:
        first = evg_admin_client.post(
            "/api/v1/vehicles/fines/evg/preview",
            json={"traffic_codes": ["1111111111"]},
        )
        assert first.status_code == 202, first.text
        first_id = first.json()["job_id"]
        assert started.wait(timeout=5)

        busy = evg_admin_client.post(
            "/api/v1/vehicles/fines/evg/preview",
            json={"traffic_codes": []},
        )
        assert busy.status_code == 503, busy.text
        assert busy.json()["error"] == {
            "code": "EVG_BUSY",
            "message": "EVG fetch queue is full.",
            "details": {},
        }
    finally:
        release.set()

    assert _wait_for_evg_job(evg_admin_client, first_id)["status"] == "done"
    replacement = evg_admin_client.post(
        "/api/v1/vehicles/fines/evg/preview",
        json={"traffic_codes": []},
    )
    assert replacement.status_code == 202, replacement.text
    replacement_id = replacement.json()["job_id"]

    evicted = evg_admin_client.get(f"/api/v1/vehicles/fines/evg/preview/{first_id}")
    assert evicted.status_code == 404, evicted.text
    assert evicted.json()["error"]["code"] == "EVG_PREVIEW_JOB_NOT_FOUND"
    assert _wait_for_evg_job(evg_admin_client, replacement_id)["status"] == "done"


def test_empty_traffic_code_list_completes_without_fetching(
    evg_admin_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_fetch(
        _tcn: str,
        *,
        timeout_s: float = 30.0,
    ) -> list[EvgTicketRow]:
        pytest.fail("empty traffic-code preview must not call EVG")

    monkeypatch.setattr(vehicle_evg_service, "fetch_tickets", unexpected_fetch)

    response = evg_admin_client.post(
        "/api/v1/vehicles/fines/evg/preview",
        json={"traffic_codes": []},
    )
    assert response.status_code == 202, response.text
    job = _wait_for_evg_job(evg_admin_client, response.json()["job_id"])

    assert job["status"] == "done"
    assert job["error_code"] is None
    assert job["error_message"] is None
    assert job["result"]["rows"] == []
    assert job["result"]["traffic_codes"] == []


def test_confirm_inserts_two_skips_duplicate_and_preserves_evg_fields(
    db_session: Session,
    admin_user: User,
    evg_fleet: dict[str, object],
) -> None:
    vehicle_10 = evg_fleet["vehicle_10"]
    vehicle_21 = evg_fleet["vehicle_21"]
    assert isinstance(vehicle_10, Vehicle)
    assert isinstance(vehicle_21, Vehicle)

    matched = EvgConfirmRow(
        ticket_no="9001",
        date=date(2026, 8, 20),
        time="12:37",
        location="Synthetic Airport Road",
        plate_number="55501",
        plate_code="21",
        amount=600,
        amount_after_discount=540,
        black_points=4,
        fine_type="Absent",
        description="Speeding ؛ Lane violation",
        vehicle_id=vehicle_21.id,
        match="matched",
    )
    assigned_ambiguous = EvgConfirmRow(
        ticket_no="9002",
        date=date(2026, 8, 21),
        time="08:05",
        location="Synthetic Al Ain Road",
        plate_number="55501",
        plate_code=None,
        amount=300,
        amount_after_discount=270,
        black_points=0,
        fine_type="Absent",
        description="Parking violation",
        vehicle_id=vehicle_10.id,
        match="ambiguous",
    )
    duplicate = EvgConfirmRow(
        ticket_no="9004",
        date=date(2026, 8, 1),
        time=None,
        location="Previously imported",
        plate_number="55501",
        plate_code="10",
        amount=400,
        amount_after_discount=400,
        black_points=0,
        fine_type="Absent",
        description="Existing description",
        vehicle_id=vehicle_10.id,
        match="already_imported",
    )

    result = vehicle_evg_service.confirm(
        db_session,
        [matched, assigned_ambiguous, duplicate],
        user=admin_user,
    )

    assert result.created == 2
    assert result.skipped == 1
    imported = {
        row.evg_ticket_no: row
        for row in db_session.query(VehicleFine)
        .filter(VehicleFine.evg_ticket_no.in_(["9001", "9002", "9004"]))
        .all()
    }
    assert set(imported) == {"9001", "9002", "9004"}
    assert db_session.query(VehicleFine).filter_by(evg_ticket_no="9004").count() == 1

    first = imported["9001"]
    assert (
        first.vehicle_id,
        first.employee_id,
        first.source,
        first.date,
        first.time,
        first.amount,
        first.amount_after_discount,
        first.black_points,
        first.location,
        first.description,
        first.fine_type,
        first.created_by_user_id,
    ) == (
        vehicle_21.id,
        None,
        "evg",
        date(2026, 8, 20),
        "12:37",
        600,
        540,
        4,
        "Synthetic Airport Road",
        "Speeding ؛ Lane violation",
        "Absent",
        admin_user.id,
    )
    second = imported["9002"]
    assert (
        second.vehicle_id,
        second.employee_id,
        second.source,
        second.time,
        second.amount,
        second.amount_after_discount,
        second.black_points,
        second.location,
        second.description,
    ) == (
        vehicle_10.id,
        None,
        "evg",
        "08:05",
        300,
        270,
        0,
        "Synthetic Al Ain Road",
        "Parking violation",
    )


def test_confirm_rejects_an_unmatched_row_before_any_insert(
    db_session: Session,
    admin_user: User,
    evg_fleet: dict[str, object],
) -> None:
    vehicle_21 = evg_fleet["vehicle_21"]
    assert isinstance(vehicle_21, Vehicle)
    valid = EvgConfirmRow(
        ticket_no="9100",
        date=date(2026, 8, 23),
        time=None,
        location="Synthetic City",
        plate_number="55501",
        plate_code="21",
        amount=500,
        amount_after_discount=500,
        black_points=0,
        fine_type="Absent",
        description="Valid row before invalid row",
        vehicle_id=vehicle_21.id,
        match="matched",
    )
    invalid_data = valid.model_dump()
    invalid_data.update(
        ticket_no="9101",
        plate_number="99999",
        plate_code=None,
        vehicle_id=None,
        match="unmatched",
    )
    invalid = EvgConfirmRow.model_construct(**invalid_data)

    with pytest.raises(ValidationFailedError) as raised:
        vehicle_evg_service.confirm(
            db_session,
            [valid, invalid],
            user=admin_user,
        )

    assert raised.value.http_status == 422
    assert raised.value.code == "EVG_ROW_UNMATCHED"
    assert (
        db_session.query(VehicleFine)
        .filter(VehicleFine.evg_ticket_no.in_(["9100", "9101"]))
        .count()
        == 0
    )
    assert not any(
        isinstance(row, VehicleFine) and row.evg_ticket_no in {"9100", "9101"}
        for row in db_session.new
    )


def test_confirm_api_rejects_nonexistent_vehicle_before_inserting_batch(
    api_db: Session,
    evg_admin_client: TestClient,
) -> None:
    site = VehicleSite(name_ar="موقع واجهة الاختبار", name_en="API Test Site")
    api_db.add(site)
    api_db.flush()
    vehicle = _vehicle(site.id, plate_code="10")
    api_db.add(vehicle)
    api_db.commit()
    missing_vehicle_id = vehicle.id + 10_000

    response = evg_admin_client.post(
        "/api/v1/vehicles/fines/evg/confirm",
        json={
            "rows": [
                _confirm_payload("9200", vehicle.id),
                _confirm_payload("9201", missing_vehicle_id),
            ]
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "VEHICLE_NOT_FOUND"
    assert (
        api_db.query(VehicleFine).filter(VehicleFine.evg_ticket_no.in_(["9200", "9201"])).count()
        == 0
    )
    assert api_db.query(AuditLog).filter(AuditLog.action == "evg.imported").count() == 0


@pytest.mark.parametrize(
    ("field", "invalid_value"),
    [
        ("amount", 0),
        ("amount", -1),
        ("black_points", -1),
    ],
)
def test_confirm_api_rejects_invalid_fine_numbers(
    api_db: Session,
    evg_admin_client: TestClient,
    field: str,
    invalid_value: int,
) -> None:
    row = _confirm_payload("9300", 1)
    row[field] = invalid_value

    response = evg_admin_client.post(
        "/api/v1/vehicles/fines/evg/confirm",
        json={"rows": [row]},
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert any(error["loc"][-1] == field for error in body["error"]["details"]["errors"])
    assert api_db.query(VehicleFine).count() == 0
    assert api_db.query(AuditLog).filter(AuditLog.action == "evg.imported").count() == 0


def test_confirm_audits_each_imported_vehicle_but_not_skipped_only_vehicle(
    db_session: Session,
    admin_user: User,
    evg_fleet: dict[str, object],
) -> None:
    vehicle_10 = evg_fleet["vehicle_10"]
    vehicle_21 = evg_fleet["vehicle_21"]
    assert isinstance(vehicle_10, Vehicle)
    assert isinstance(vehicle_21, Vehicle)
    skipped_only_vehicle = _vehicle(vehicle_10.site_id, plate_code="30")
    db_session.add(skipped_only_vehicle)
    db_session.flush()
    db_session.add(
        VehicleFine(
            vehicle_id=skipped_only_vehicle.id,
            employee_id=None,
            date=date(2026, 8, 1),
            amount=400,
            amount_after_discount=400,
            black_points=0,
            source="evg",
            evg_ticket_no="9403",
            location="Previously imported",
            description="Existing skipped-only fine",
            fine_type="Absent",
            created_by_user_id=admin_user.id,
        )
    )
    db_session.commit()

    rows = [
        EvgConfirmRow.model_validate(_confirm_payload("9400", vehicle_10.id)),
        EvgConfirmRow.model_validate(_confirm_payload("9401", vehicle_21.id)),
        EvgConfirmRow.model_validate(_confirm_payload("9402", vehicle_21.id)),
        EvgConfirmRow.model_validate(
            _confirm_payload(
                "9403",
                skipped_only_vehicle.id,
                match="already_imported",
            )
        ),
    ]

    result = vehicle_evg_service.confirm(db_session, rows, user=admin_user)

    assert (result.created, result.skipped) == (3, 1)
    imported_vehicle_ids = {
        fine.evg_ticket_no: fine.vehicle_id
        for fine in db_session.query(VehicleFine)
        .filter(VehicleFine.evg_ticket_no.in_(["9400", "9401", "9402", "9403"]))
        .all()
    }
    assert imported_vehicle_ids == {
        "9400": vehicle_10.id,
        "9401": vehicle_21.id,
        "9402": vehicle_21.id,
        "9403": skipped_only_vehicle.id,
    }

    audits = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "evg.imported")
        .order_by(AuditLog.id)
        .all()
    )
    assert len(audits) == 2
    assert all(audit.entity_type == "vehicle" for audit in audits)
    payload_by_vehicle = {
        int(audit.entity_id): json.loads(audit.payload or "{}") for audit in audits
    }
    assert set(payload_by_vehicle) == {vehicle_10.id, vehicle_21.id}
    assert payload_by_vehicle[vehicle_10.id]["created"] == 1
    assert payload_by_vehicle[vehicle_21.id]["created"] == 2
    assert skipped_only_vehicle.id not in payload_by_vehicle
