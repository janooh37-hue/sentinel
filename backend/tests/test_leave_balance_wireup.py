"""Balance wire-up: taken-days are deducted, bilingual leave_type strings match,
Rejected/Cancelled rows are ignored, and duplicate spans count once.

Regression guard for the pre-fix bug where ``_DbLeaveHistory`` compared
``leave_type`` with exact equality (``== "Annual"``). Stored values are
inconsistent bilingual free-text, so nothing matched and taken was always 0 —
the balance always showed the full entitlement.
"""

from datetime import date

import pytest
from sqlalchemy import text

from app.db.models import Employee, Leave
from app.services import leave_service


@pytest.fixture(autouse=True)
def _drop_natural_key_index(db_session):
    """The natural-key unique index (migration 0045) blocks *identical* rows.
    We seed same-span rows with differing/bilingual ``leave_type`` strings (which
    the index permits) and one exact dup, so drop it to seed freely."""
    db_session.execute(text("DROP INDEX IF EXISTS ux_leaves_natural_key"))
    db_session.commit()


def _emp(db, eid="G1042"):
    e = Employee(id=eid, name_en="Ahmed", name_ar="أحمد", doj=date(2021, 3, 1))
    db.add(e)
    db.flush()
    return e


def _leave(db, *, leave_type, start, end, days, status="Approved", eid="G1042"):
    row = Leave(
        employee_id=eid,
        leave_type=leave_type,
        start_date=start,
        end_date=end,
        days=days,
        status=status,
    )
    db.add(row)
    db.flush()
    return row


def test_annual_and_sick_taken_are_deducted(db_session):
    _emp(db_session)
    # Annual — two real spans (5 + 7 = 12), one exact-duplicate span, one rejected.
    _leave(db_session, leave_type="Annual Leave - إجازة سنوية",
           start=date(2026, 1, 10), end=date(2026, 1, 14), days=5)
    _leave(db_session, leave_type="Annual",
           start=date(2026, 3, 2), end=date(2026, 3, 8), days=7)
    _leave(db_session, leave_type="Annual Leave",  # same span, different string → dup
           start=date(2026, 3, 2), end=date(2026, 3, 8), days=7)
    _leave(db_session, leave_type="Annual Leave", status="Rejected",
           start=date(2026, 5, 20), end=date(2026, 5, 22), days=3)
    # Sick — 4 + 2 = 6, plus a bilingual duplicate of the 2-day span. Both spans
    # sit inside the current anniversary window (opens on the 01/03 join day).
    _leave(db_session, leave_type="Sick Leave - إجازة مرضية",
           start=date(2026, 4, 5), end=date(2026, 4, 8), days=4)
    _leave(db_session, leave_type="Sick",
           start=date(2026, 6, 11), end=date(2026, 6, 12), days=2)
    _leave(db_session, leave_type="Sick Leave - إجازة مرضية",  # dup span
           start=date(2026, 6, 11), end=date(2026, 6, 12), days=2)
    db_session.commit()

    bal = leave_service.compute_balance(db_session, "G1042", as_of=date(2026, 7, 16))

    # Taken totals count each distinct span once, ignore the rejected row, and
    # match the bilingual/short leave_type strings.
    assert bal.annual_taken == 12.0  # 5 + 7 (dup 7 & rejected 3 dropped)
    assert bal.sick_taken == 6.0  # 4 + 2 (dup 2 dropped)
    # Remaining is entitlement minus taken — the whole point of the wire-up.
    assert bal.annual_remaining == round(bal.annual_total - 12.0, 1)
    assert bal.sick_remaining == 90.0 - 6.0


def test_rejected_and_cancelled_do_not_consume(db_session):
    _emp(db_session, eid="G2001")
    _leave(db_session, eid="G2001", leave_type="Annual Leave", status="Rejected - مرفوض",
           start=date(2026, 4, 1), end=date(2026, 4, 5), days=5)
    _leave(db_session, eid="G2001", leave_type="Annual Leave", status="Cancelled",
           start=date(2026, 4, 10), end=date(2026, 4, 14), days=5)
    db_session.commit()

    bal = leave_service.compute_balance(db_session, "G2001", as_of=date(2026, 7, 16))
    assert bal.annual_taken == 0.0


def test_duplicate_span_counted_once(db_session):
    _emp(db_session, eid="G3003")
    for _ in range(3):
        _leave(db_session, eid="G3003", leave_type="Annual Leave",
               start=date(2026, 2, 1), end=date(2026, 2, 3), days=3)
    db_session.commit()

    bal = leave_service.compute_balance(db_session, "G3003", as_of=date(2026, 7, 16))
    assert bal.annual_taken == 3.0  # not 9
