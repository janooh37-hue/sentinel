from datetime import date

from sqlalchemy import select

from app.db.models import DutySupervisor


def test_duty_supervisor_row_roundtrips(db_session):
    row = DutySupervisor(duty_unit="السرية الأولى", recipient_duty_post="مسؤول سرية")
    db_session.add(row)
    db_session.commit()
    got = db_session.scalar(
        select(DutySupervisor).where(DutySupervisor.duty_unit == "السرية الأولى")
    )
    assert got is not None
    assert got.recipient_duty_post == "مسؤول سرية"
    assert got.created_at is not None
    assert isinstance(got.created_at.date(), date)
