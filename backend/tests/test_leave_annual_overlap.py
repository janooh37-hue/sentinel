from datetime import date

from app.core import leave_lifecycle
from app.db.models import Employee, Leave
from app.services import leave_service


def test_is_annual():
    assert leave_lifecycle.is_annual("annual leave") is True
    assert leave_lifecycle.is_annual("Annual Leave - الإجازة السنوية") is True
    assert leave_lifecycle.is_annual("sick leave") is False


def _emp(db, id_, unit):
    db.add(
        Employee(
            id=id_,
            name_ar="ع",
            name_en="X",
            status="Active",
            duty_unit=unit,
            duty_post="p",
            contact="0501112222",
            msg_language="ar",
        )
    )
    db.commit()


def _leave(db, id_, emp, start, end, status="Approved", lt="annual leave"):
    db.add(
        Leave(
            id=id_,
            employee_id=emp,
            leave_type=lt,
            start_date=start,
            end_date=end,
            status=status,
            days=1,
        )
    )
    db.commit()


def test_list_annual_overlapping_matches_only_overlaps(db_session):
    _emp(db_session, "G1", "السرية الأولى")
    ms, me = date(2026, 7, 1), date(2026, 7, 31)
    _leave(db_session, 1, "G1", date(2026, 6, 28), date(2026, 7, 3))  # overlaps start
    _leave(db_session, 2, "G1", date(2026, 7, 20), date(2026, 8, 5))  # overlaps end
    _leave(db_session, 3, "G1", date(2026, 5, 1), date(2026, 5, 10))  # before → excluded
    _leave(db_session, 4, "G1", date(2026, 7, 10), date(2026, 7, 12), status="Rejected")  # excluded
    _leave(db_session, 5, "G1", date(2026, 7, 10), date(2026, 7, 12), lt="sick leave")  # not annual
    got = leave_service.list_annual_overlapping(db_session, month_start=ms, month_end=me)
    assert sorted(lv.id for lv in got) == [1, 2]


def test_list_annual_overlapping_scoped_by_unit(db_session):
    _emp(db_session, "G1", "السرية الأولى")
    _emp(db_session, "G2", "السرية الثانية")
    ms, me = date(2026, 7, 1), date(2026, 7, 31)
    _leave(db_session, 1, "G1", date(2026, 7, 5), date(2026, 7, 9))
    _leave(db_session, 2, "G2", date(2026, 7, 5), date(2026, 7, 9))
    got = leave_service.list_annual_overlapping(
        db_session, month_start=ms, month_end=me, duty_unit="السرية الأولى"
    )
    assert [lv.id for lv in got] == [1]
