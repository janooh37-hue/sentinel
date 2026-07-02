"""A4 — a partial unique index blocks exact-duplicate live leave rows.

Backstop for the app-level dedup guard (A1): even a raw insert can't recreate
the 398-row duplication the audit found. Soft-deleted rows are exempt (the
index is partial on ``deleted_at IS NULL``), so re-creating a leave whose prior
copy was soft-deleted is still allowed.
"""

from datetime import date, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import Employee, Leave


def _emp(db, eid="G3082"):
    e = Employee(id=eid, name_en="Test", name_ar="اختبار")
    db.add(e)
    db.flush()
    return e


def _mk(eid="G3082"):
    return Leave(
        employee_id=eid,
        leave_type="Sick Leave",
        start_date=date(2026, 3, 25),
        end_date=date(2026, 3, 26),
        days=2,
        status="Approved",
    )


def test_exact_duplicate_is_rejected(db_session):
    _emp(db_session)
    db_session.add(_mk())
    db_session.commit()
    db_session.add(_mk())
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_soft_deleted_row_does_not_block_recreation(db_session):
    _emp(db_session)
    first = _mk()
    first.deleted_at = datetime(2026, 3, 27)
    db_session.add(first)
    db_session.commit()
    # a live row with the same key is allowed because the old one is soft-deleted
    db_session.add(_mk())
    db_session.commit()
    live = db_session.query(Leave).filter(Leave.deleted_at.is_(None)).count()
    assert live == 1
