# backend/tests/test_permit_mulkiya_model.py
from datetime import date

from sqlalchemy.orm import Session

from app.db.models import Permit, PermitVehicle


def test_vehicle_has_mulkiya_columns(db_session: Session) -> None:
    p = Permit(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 22),
        end_date=date(2026, 8, 1),
        status="active",
    )
    p.vehicles.append(
        PermitVehicle(
            plate_no="A 12345",
            plate_emirate="Dubai",
            make_model="Toyota Camry",
            colour="White",
            vehicle_type="Sedan",
            plate_category="Private",
            traffic_no="12345678",
            reg_expiry=date(2027, 3, 14),
        )
    )
    p.manager_id = 1
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    v = p.vehicles[0]
    assert (v.colour, v.vehicle_type, v.plate_category, v.traffic_no) == (
        "White",
        "Sedan",
        "Private",
        "12345678",
    )
    assert v.reg_expiry == date(2027, 3, 14)
    assert p.book_id is None and p.manager_id == 1
