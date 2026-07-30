"""Scheduled departures — a future-dated resignation or termination keeps the
employee Active through their notice period, then flips on the day.

Pending departure ⇔ status == 'Active' AND pending_status IS NOT NULL AND
end_date IS NOT NULL. `status` deliberately stays 'Active' while pending so
every active-roster query keeps treating the person as the working employee
they still are.
"""

from datetime import date

from app.db.models import Employee


def test_pending_status_defaults_to_none(db_session):
    row = Employee(id="G9101", name_en="Pending Default", status="Active")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.pending_status is None


def test_pending_status_round_trips(db_session):
    row = Employee(
        id="G9102",
        name_en="Pending Resigned",
        status="Active",
        end_date=date(2026, 8, 15),
        pending_status="Resigned",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.pending_status == "Resigned"
    assert row.status == "Active"
    assert row.end_date == date(2026, 8, 15)


def test_list_item_projection_exposes_the_pending_fields(db_session):
    """The widget and search badge read the LIST endpoint, not the detail one."""
    from app.schemas.employee import EmployeeListItem

    row = Employee(
        id="G9103",
        name_en="Pending Projection",
        status="Active",
        end_date=date(2026, 8, 15),
        pending_status="Resigned",
    )
    db_session.add(row)
    db_session.commit()
    item = EmployeeListItem.model_validate(row)
    assert item.pending_status == "Resigned"
    assert item.end_date == date(2026, 8, 15)
