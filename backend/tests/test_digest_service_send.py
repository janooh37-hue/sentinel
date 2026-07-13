# backend/tests/test_digest_service_send.py
from datetime import date
from types import SimpleNamespace

from app.db.models import Employee, Leave
from app.services import digest_service as ds
from app.services import duty_supervisor_service as dsv


def _emp(db, id_, unit, post, contact="0501112222"):
    db.add(
        Employee(
            id=id_,
            name_ar="ع",
            name_en="X",
            status="Active",
            duty_unit=unit,
            duty_post=post,
            contact=contact,
            msg_language="ar",
        )
    )
    db.commit()


def _leave(db, id_, emp, s, e):
    db.add(
        Leave(
            id=id_,
            employee_id=emp,
            leave_type="annual leave",
            start_date=s,
            end_date=e,
            status="Approved",
            days=1,
        )
    )
    db.commit()


def _stub_send(monkeypatch):
    calls = []

    def fake(db, *, employee, body, language, event_type, event_ref, sent_by):
        calls.append(SimpleNamespace(employee=employee, body=body, event_ref=event_ref))
        return SimpleNamespace(id=len(calls))

    monkeypatch.setattr(ds.notify_dispatch, "send_direct", fake)
    return calls


def test_send_unit_digest_sends_to_each_supervisor(db_session, monkeypatch):
    calls = _stub_send(monkeypatch)
    dsv.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    _emp(db_session, "SUP", "السرية الأولى", "مسؤول سرية")
    _emp(db_session, "EMP", "السرية الأولى", "جندي")
    _leave(db_session, 1, "EMP", date(2026, 7, 5), date(2026, 7, 9))
    res = ds.send_unit_digest(db_session, "السرية الأولى", month=date(2026, 7, 1), sent_by=None)
    assert res.sent == 1
    assert len(calls) == 1
    assert calls[0].employee.id == "SUP"
    assert "leave_digest:2026-07:" in calls[0].event_ref


def test_send_unit_digest_skips_when_no_supervisor(db_session, monkeypatch):
    _stub_send(monkeypatch)
    _emp(db_session, "EMP", "دعم 1", "جندي")
    _leave(db_session, 1, "EMP", date(2026, 7, 5), date(2026, 7, 9))
    res = ds.send_unit_digest(db_session, "دعم 1", month=date(2026, 7, 1), sent_by=None)
    assert res.sent == 0
    assert [s.reason for s in res.skips] == ["no_supervisor"]


def test_send_unit_digest_skips_when_no_leaves(db_session, monkeypatch):
    _stub_send(monkeypatch)
    dsv.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    _emp(db_session, "SUP", "السرية الأولى", "مسؤول سرية")
    res = ds.send_unit_digest(db_session, "السرية الأولى", month=date(2026, 7, 1), sent_by=None)
    assert res.sent == 0
    assert [s.reason for s in res.skips] == ["no_leaves"]


def test_send_all_digests_covers_every_mapped_unit(db_session, monkeypatch):
    _stub_send(monkeypatch)
    dsv.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    dsv.add_mapping(db_session, "السرية الثانية", "مسؤول سرية")
    _emp(db_session, "S1", "السرية الأولى", "مسؤول سرية")
    _emp(db_session, "S2", "السرية الثانية", "مسؤول سرية")
    _emp(db_session, "E1", "السرية الأولى", "جندي")
    _leave(db_session, 1, "E1", date(2026, 7, 5), date(2026, 7, 9))
    res = ds.send_all_digests(db_session, month=date(2026, 7, 1), sent_by=None)
    assert res.sent == 1
    assert any(s.reason == "no_leaves" and s.duty_unit == "السرية الثانية" for s in res.skips)
