from datetime import date

from app.schemas.permit import PermitCreate, PermitVehicleCreate, PersonIdScan, VehicleLicenceScan


def test_vehicle_create_accepts_mulkiya_fields():
    v = PermitVehicleCreate(
        plate_no="A 1",
        colour="White",
        vehicle_type="Sedan",
        plate_category="Private",
        traffic_no="123",
        reg_expiry=date(2027, 1, 1),
    )
    assert v.colour == "White" and v.reg_expiry == date(2027, 1, 1)


def test_permit_create_accepts_manager_id():
    p = PermitCreate(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=[{"name": "X", "uae_id": "1"}],
        manager_id=3,
    )
    assert p.manager_id == 3


def test_scan_response_shapes():
    assert VehicleLicenceScan(colour="White").colour == "White"
    assert PersonIdScan(name="X", uae_id="1").uae_id == "1"
