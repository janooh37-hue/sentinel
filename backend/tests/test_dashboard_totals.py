from datetime import date

from app.db.models import Employee, Leave
from app.services.dashboard_service import _compute_totals

TODAY = date(2026, 8, 10)


def _leave(employee_id: str, leave_type: str) -> Leave:
    return Leave(
        employee_id=employee_id,
        leave_type=leave_type,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 20),
        days=20,
        status="Approved",
    )


def test_loaned_count_alone_and_never_as_our_staff_on_site_or_on_leave(db_session):
    db_session.add_all(
        [
            Employee(id="G1", name_en="ON SITE", status="Active"),
            Employee(id="G2", name_en="ON LEAVE", status="Active"),
            Employee(id="G3", name_en="LOANED", status="Loaned"),
            Employee(id="G4", name_en="GONE", status="Resigned", end_date=date(2026, 7, 1)),
        ]
    )
    db_session.flush()
    db_session.add_all(
        [
            # Overlapping approved leaves are still one person on leave.
            _leave("G2", "Annual Leave"),
            _leave("G2", "Sick Leave"),
            _leave("G3", "Annual Leave"),
            _leave("G4", "Annual Leave"),
        ]
    )
    db_session.flush()

    totals = _compute_totals(db_session, today=TODAY)

    assert (
        totals.employees_active,
        totals.our_staff,
        totals.present_today,
        totals.loaned,
        totals.on_leave_today,
    ) == (3, 2, 1, 1, 1)
