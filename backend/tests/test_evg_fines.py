"""Pure EVG parsing and vehicle fine import service contracts."""

from __future__ import annotations

import json
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.errors import ValidationFailedError
from app.core.evg_fines import (
    EvgTicketDetails,
    EvgTicketRow,
    has_next_page,
    parse_ticket_details,
    parse_tickets_page,
    plate_code_from_color,
)
from app.db.models import AuditLog, User, Vehicle, VehicleFine, VehicleSite
from app.db.session import get_db
from app.main import create_app
from app.schemas.vehicle import EvgConfirmRow
from app.services import vehicle_evg_service

TICKETS_HTML = """
<html>
  <body>
    <table id="ctl00_cphScrollMenu_gettickets1_ctl00_gvTickets">
      <tr>
        <th></th><th>Fine No.</th><th>Date &amp; Time</th><th>Location</th>
        <th>Plate No.</th><th>Total Amount</th><th>Discount (%)</th>
        <th>Amount after Discount</th><th>Late Charges</th>
        <th>Black Points Law</th><th>Fine Type</th>
      </tr>
      <tr>
        <td><input type="checkbox"></td>
        <td><a onclick="open('ticketdetails.aspx?language=en&amp;Type=Tickets&amp;Page=0&amp;TicketNo=6261776007')">******6007</a></td>
        <td>20-08-2026 12:37 PM</td><td>Abu Dhabi - Airport Road</td>
        <td>13695</td><td>600</td><td>0 %</td><td>600</td>
        <td>0 AED</td><td>4</td><td>Absent</td>
      </tr>
      <tr>
        <td><input type="checkbox"></td>
        <td><a onclick="showTicket('ticketdetails.aspx?TicketNo=6261776008')">******6008</a></td>
        <td>21-08-2026</td><td>Al Ain Road</td>
        <td>13695</td><td>300 AED</td><td>10 %</td><td>270 AED</td>
        <td>20 AED</td><td></td><td>Absent</td>
      </tr>
      <tr>
        <td><input type="checkbox"></td>
        <td><a href="#" onclick="location.href='ticketdetails.aspx?TicketNo=6261776009&amp;Page=0'">******6009</a></td>
        <td>22-08-2026 08:05 AM</td><td>Mussafah</td>
        <td>99999</td><td>1000</td><td>0 %</td><td>1000</td>
        <td>0 AED</td><td>12</td><td>Absent</td>
      </tr>
      <tr class="pager">
        <td colspan="11">
          <a href="javascript:__doPostBack('ctl00$cphScrollMenu$gettickets1$ctl00$gvTickets','Page$2')">2</a>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


DETAILS_HTML = """
<html>
  <body>
    <table id="ticket-facts">
      <tr><td>Fine No.</td><td>6261776007</td></tr>
      <tr><td>Date</td><td>20-08-2026</td></tr>
      <tr><td>Time</td><td>12:37:20 PM</td></tr>
      <tr><td>Location</td><td>Abu Dhabi - Airport Road</td></tr>
      <tr><td>Plate No.</td><td>13695</td></tr>
      <tr><td>Plate Color</td><td>TWENTY-FIRST CATEGORY</td></tr>
      <tr><td>Owner Traffic No.</td><td>1180021637</td></tr>
    </table>
    <table id="violations">
      <tr><th>Description</th><th>Amount</th><th>Amount after Discount</th></tr>
      <tr><td>Exceeding the speed limit</td><td>300 AED</td><td>300 AED</td></tr>
      <tr><td>Failure to keep lane discipline</td><td>300 AED</td><td>300 AED</td></tr>
    </table>
  </body>
</html>
"""


def _ticket(
    ticket_no: str,
    *,
    plate_number: str,
    amount: int = 600,
    amount_after_discount: int = 600,
    black_points: int = 4,
    location: str = "Abu Dhabi - Airport Road",
) -> EvgTicketRow:
    return EvgTicketRow(
        ticket_no=ticket_no,
        date=date(2026, 8, 20),
        location=location,
        plate_number=plate_number,
        amount=amount,
        discount_pct=0,
        amount_after_discount=amount_after_discount,
        late_charges=0,
        black_points=black_points,
        fine_type="Absent",
    )


def _details(
    ticket_no: str,
    *,
    plate_code: str | None,
    time: str = "12:37",
    descriptions: list[str] | None = None,
) -> EvgTicketDetails:
    return EvgTicketDetails(
        ticket_no=ticket_no,
        time=time,
        plate_code=plate_code,
        owner_traffic_no="1180021637",
        descriptions=descriptions or ["Exceeding the speed limit"],
    )


def _vehicle(site_id: int, *, plate_code: str) -> Vehicle:
    return Vehicle(
        plate_code=plate_code,
        plate_number="13695",
        traffic_code="1180021637",
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
        "location": "Abu Dhabi",
        "plate_number": "13695",
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


def test_parse_tickets_page_returns_exact_rows_and_next_postback() -> None:
    assert parse_tickets_page(TICKETS_HTML) == [
        EvgTicketRow(
            ticket_no="6261776007",
            date=date(2026, 8, 20),
            location="Abu Dhabi - Airport Road",
            plate_number="13695",
            amount=600,
            discount_pct=0,
            amount_after_discount=600,
            late_charges=0,
            black_points=4,
            fine_type="Absent",
        ),
        EvgTicketRow(
            ticket_no="6261776008",
            date=date(2026, 8, 21),
            location="Al Ain Road",
            plate_number="13695",
            amount=300,
            discount_pct=10,
            amount_after_discount=270,
            late_charges=20,
            black_points=0,
            fine_type="Absent",
        ),
        EvgTicketRow(
            ticket_no="6261776009",
            date=date(2026, 8, 22),
            location="Mussafah",
            plate_number="99999",
            amount=1000,
            discount_pct=0,
            amount_after_discount=1000,
            late_charges=0,
            black_points=12,
            fine_type="Absent",
        ),
    ]
    assert has_next_page(TICKETS_HTML) == "Page$2"
    assert has_next_page(TICKETS_HTML.replace("Page$2", "Current$2")) is None


def test_parse_ticket_details_returns_exact_normalized_details() -> None:
    assert parse_ticket_details(DETAILS_HTML) == EvgTicketDetails(
        ticket_no="6261776007",
        time="12:37",
        plate_code="21",
        owner_traffic_no="1180021637",
        descriptions=[
            "Exceeding the speed limit",
            "Failure to keep lane discipline",
        ],
    )


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("FIRST CATEGORY", "1"),
        ("ELEVENTH CATEGORY", "11"),
        ("NINETEENTH CATEGORY", "19"),
        ("TWENTIETH CATEGORY", "20"),
        ("TWENTY-FIRST CATEGORY", "21"),
        ("THIRTY-SECOND CATEGORY", "32"),
        ("FIFTIETH CATEGORY", "50"),
        ("FIFTY-NINTH CATEGORY", "59"),
        ("SPECIAL CATEGORY", None),
        ("", None),
    ],
)
def test_plate_code_from_color_maps_english_ordinals(label: str, expected: str | None) -> None:
    assert plate_code_from_color(label) == expected


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
    details_requests: dict[str, bool] = {}

    rows = [
        (
            _ticket("9001", plate_number="13695"),
            _details(
                "9001",
                plate_code="21",
                descriptions=["Speeding", "Lane violation"],
            ),
        ),
        (
            _ticket(
                "9002",
                plate_number="13695",
                amount=300,
                amount_after_discount=270,
                black_points=0,
                location="Al Ain Road",
            ),
            _details(
                "9002",
                plate_code=None,
                time="08:05",
                descriptions=["Parking violation"],
            ),
        ),
        (_ticket("9003", plate_number="99999"), None),
        (_ticket("9004", plate_number="13695"), None),
    ]

    def fake_fetch_tickets(
        tcn: str, *, details_for, timeout_s: int = 120
    ) -> list[tuple[EvgTicketRow, EvgTicketDetails | None]]:
        assert tcn == "1180021637"
        assert timeout_s == 120
        details_requests.update(
            {ticket.ticket_no: details_for(ticket.ticket_no) for ticket, _ in rows}
        )
        return rows

    monkeypatch.setattr(vehicle_evg_service, "fetch_tickets", fake_fetch_tickets)

    preview = vehicle_evg_service.preview(
        db_session,
        traffic_codes=["1180021637"],
    )

    assert details_requests == {
        "9001": True,
        "9002": True,
        "9003": True,
        "9004": False,
    }
    assert preview.traffic_codes == ["1180021637"]
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
        (vehicle_10.id, "10 \\ 13695"),
        (vehicle_21.id, "21 \\ 13695"),
    }


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
        location="Abu Dhabi - Airport Road",
        plate_number="13695",
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
        location="Al Ain Road",
        plate_number="13695",
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
        plate_number="13695",
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
        "Abu Dhabi - Airport Road",
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
        "Al Ain Road",
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
        location="Abu Dhabi",
        plate_number="13695",
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
