"""A1 — the leave dedup guard must match on the natural key regardless of age.

The old WF-03 guard only looked back 2 minutes, so a re-generated leave more
than 2 minutes later (the audit found real cases ~5.7 min apart) slipped through
and created a duplicate. The extracted `_find_duplicate_leave` helper does an
exact (employee, type, start, end) match with no time window.
"""

from datetime import date, datetime

from app.db.models import Employee, Leave
from app.services.document_service import _find_duplicate_leave


def _emp(db, eid="G3082"):
    e = Employee(id=eid, name_en="Test", name_ar="اختبار")
    db.add(e)
    db.flush()
    return e


def test_find_duplicate_matches_regardless_of_age(db_session):
    _emp(db_session)
    old = Leave(
        employee_id="G3082",
        leave_type="Sick Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Approved",
    )
    db_session.add(old)
    db_session.flush()
    old.created_at = datetime(2026, 7, 1, 0, 0, 0)  # far older than the retired 2-min window
    db_session.flush()
    probe = Leave(
        employee_id="G3082",
        leave_type="Sick Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Approved",
    )
    found = _find_duplicate_leave(db_session, probe)
    assert found is not None and found.id == old.id


def test_find_duplicate_none_for_distinct_dates(db_session):
    _emp(db_session)
    a = Leave(
        employee_id="G3082",
        leave_type="Annual Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Pending",
    )
    db_session.add(a)
    db_session.flush()
    probe = Leave(
        employee_id="G3082",
        leave_type="Annual Leave",
        start_date=date(2026, 7, 10),
        end_date=date(2026, 7, 12),
        days=3,
        status="Pending",
    )
    assert _find_duplicate_leave(db_session, probe) is None


def test_find_duplicate_skips_soft_deleted(db_session):
    _emp(db_session)
    gone = Leave(
        employee_id="G3082",
        leave_type="Sick Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Approved",
        deleted_at=datetime(2026, 7, 2),
    )
    db_session.add(gone)
    db_session.flush()
    probe = Leave(
        employee_id="G3082",
        leave_type="Sick Leave",
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 3),
        days=3,
        status="Approved",
    )
    assert _find_duplicate_leave(db_session, probe) is None
