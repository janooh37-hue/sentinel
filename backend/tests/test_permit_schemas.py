from datetime import date, datetime

import pytest
from pydantic import ValidationError

from app.schemas.permit import (
    PermitAccessAreas,
    PermitCreate,
    PermitPersonCreate,
    PermitPersonRead,
    PermitUpdate,
    PermitValidityPeriod,
    PermitVehicleCreate,
    PersonIdScan,
    VehicleLicenceScan,
)


def test_new_visitor_requires_job() -> None:
    with pytest.raises(ValidationError):
        PermitPersonCreate(name="Ali", uae_id="784-1", nationality="UAE")


def test_visitor_job_is_normalized_and_legacy_read_role_stays_nullable() -> None:
    visitor = PermitPersonCreate(
        name="Ali", uae_id="784-1", nationality="UAE", role="  Electrician  "
    )
    assert visitor.role == "Electrician"
    with pytest.raises(ValidationError):
        PermitPersonCreate(name="Ali", uae_id="784-1", nationality="UAE", role="   ")

    legacy = PermitPersonRead(
        id=1,
        permit_id=1,
        name="Legacy",
        created_at=datetime(2026, 8, 6),
        role=None,
    )
    assert legacy.role is None


BASE_CREATE = {
    "company": "ACME",
    "access_areas": {"al_wathba_1": ["green"]},
    "start_date": date(2026, 7, 1),
}


def test_create_requires_validity_and_rejects_end_date():
    with pytest.raises(ValidationError):
        PermitCreate.model_validate({**BASE_CREATE, "end_date": "2026-09-01"})


def test_custom_validity_bounds_are_unit_specific():
    assert PermitValidityPeriod(value=2, unit="month").value == 2
    with pytest.raises(ValidationError):
        PermitValidityPeriod(value=11, unit="year")


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
        validity={"value": 2, "unit": "day"},
        people=[{"name": "X", "uae_id": "1", "role": "Technician"}],
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
