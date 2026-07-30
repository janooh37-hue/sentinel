"""A Resignation Letter records where the employee is headed.

Future date → pending (Active through the notice period). Today-or-past →
applied now. Never overwrites someone who has already departed.
"""

from datetime import date, timedelta

import pytest

from app.db.models import Employee
from app.services.document_service import _record_pending_resignation


def _emp(db_session, employee_id: str, **kw) -> Employee:
    kw.setdefault("status", "Active")
    row = Employee(id=employee_id, name_en=f"Emp {employee_id}", **kw)
    db_session.add(row)
    db_session.commit()
    return row


def test_future_resignation_date_schedules(db_session):
    emp = _emp(db_session, "G9200")
    future = date.today() + timedelta(days=16)
    _record_pending_resignation(db_session, emp, {"resignation_date": future.isoformat()})
    db_session.commit()  # exercise the actual write path for this novel state
    assert emp.status == "Active"
    assert emp.pending_status == "Resigned"
    assert emp.end_date == future


def test_today_resignation_date_applies_now(db_session):
    emp = _emp(db_session, "G9201")
    _record_pending_resignation(db_session, emp, {"resignation_date": date.today().isoformat()})
    assert emp.status == "Resigned"
    assert emp.pending_status is None
    assert emp.end_date == date.today()


def test_past_resignation_date_applies_now(db_session):
    emp = _emp(db_session, "G9202")
    past = date.today() - timedelta(days=2)
    _record_pending_resignation(db_session, emp, {"resignation_date": past.isoformat()})
    assert emp.status == "Resigned"
    assert emp.end_date == past


def test_dd_mm_yyyy_is_accepted(db_session):
    emp = _emp(db_session, "G9203")
    future = date.today() + timedelta(days=5)
    _record_pending_resignation(db_session, emp, {"resignation_date": future.strftime("%d/%m/%Y")})
    assert emp.pending_status == "Resigned"
    assert emp.end_date == future


def test_missing_date_is_a_no_op(db_session):
    """No date, nothing to schedule — the paper still files normally."""
    emp = _emp(db_session, "G9204")
    _record_pending_resignation(db_session, emp, {})
    assert emp.status == "Active"
    assert emp.pending_status is None
    assert emp.end_date is None


def test_unparseable_date_is_a_no_op(db_session):
    emp = _emp(db_session, "G9205")
    _record_pending_resignation(db_session, emp, {"resignation_date": "not a date"})
    assert emp.pending_status is None
    assert emp.end_date is None


@pytest.mark.parametrize("existing", ["Resigned", "Terminated"])
def test_already_departed_employee_is_never_touched(db_session, existing):
    """A second letter for someone already gone must not rewrite their record."""
    original_end = date(2026, 1, 31)
    emp = _emp(db_session, f"G921{existing[0]}", status=existing, end_date=original_end)
    _record_pending_resignation(
        db_session,
        emp,
        {"resignation_date": (date.today() + timedelta(days=10)).isoformat()},
    )
    assert emp.status == existing
    assert emp.end_date == original_end
    assert emp.pending_status is None


def test_none_employee_is_a_no_op(db_session):
    """Letters can be generated without a linked employee row."""
    _record_pending_resignation(db_session, None, {"resignation_date": "2026-08-15"})


def test_today_parameter_overrides_the_clock(db_session):
    """The ``today`` seam is real, not decorative — a caller-injected clock
    decides schedule-vs-immediate, not ``date.today()`` baked into the call."""
    emp = _emp(db_session, "G9206")
    d = date(2026, 8, 15)
    _record_pending_resignation(
        db_session, emp, {"resignation_date": d.isoformat()}, today=date(2026, 8, 20)
    )
    assert emp.status == "Resigned"  # d is in the past relative to the injected today
    assert emp.pending_status is None
