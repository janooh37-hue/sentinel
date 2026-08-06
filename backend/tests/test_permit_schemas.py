from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas.permit import (
    PermitAccessAreas,
    PermitCreate,
    PermitUpdate,
    PermitVehicleCreate,
    PersonIdScan,
    VehicleLicenceScan,
)


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
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=[{"name": "X", "uae_id": "1"}],
        manager_id=3,
    )
    assert p.manager_id == 3


def test_access_areas_normalize_location_zone_order_and_duplicates():
    access = PermitAccessAreas(
        al_wathba_1=["red", "green", "red"],
        al_wathba_2=["red"],
        work_residence=False,
    )
    assert access.al_wathba_1 == ["green", "red"]
    assert access.al_wathba_2 == ["red"]


def test_access_areas_require_at_least_one_selection():
    with pytest.raises(ValidationError):
        PermitAccessAreas()


def test_permit_update_rejects_explicit_null_access():
    with pytest.raises(ValidationError):
        PermitUpdate(access_areas=None)

def test_permit_update_rejects_obsolete_flat_zones():
    with pytest.raises(ValidationError):
        PermitUpdate.model_validate({"zones": ["red"]})



def test_permit_update_access_area_is_omittable_but_not_nullable():
    schema = PermitUpdate.model_json_schema()
    properties = schema["properties"]["access_areas"]
    assert "access_areas" not in schema.get("required", [])
    assert "anyOf" not in properties
    assert "$ref" in properties

def test_scan_response_shapes():
    assert VehicleLicenceScan(colour="White").colour == "White"
    assert PersonIdScan(name="X", uae_id="1").uae_id == "1"
