from app.db.models import Employee
from app.services import duty_supervisor_service as svc


def _emp(db, **kw):
    base = dict(
        id=kw.pop("id"),
        name_ar="ع",
        name_en="X",
        status="Active",
        duty_unit=None,
        duty_post=None,
        contact=None,
        msg_language="ar",
    )
    base.update(kw)
    e = Employee(**base)
    db.add(e)
    db.commit()
    return e


def test_add_mapping_is_idempotent(db_session):
    a = svc.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    b = svc.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    assert a.id == b.id
    assert len(svc.list_mappings(db_session)) == 1


def test_remove_mapping(db_session):
    m = svc.add_mapping(db_session, "الدوام الرسمي", "مدير مشروع")
    assert svc.remove_mapping(db_session, m.id) is True
    assert svc.remove_mapping(db_session, m.id) is False
    assert svc.list_mappings(db_session) == []


def test_resolve_supervisors_by_designation(db_session):
    svc.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    match = _emp(
        db_session, id="G1", duty_unit="السرية الأولى", duty_post="مسؤول سرية", contact="0501234567"
    )
    _emp(
        db_session, id="G2", duty_unit="السرية الأولى", duty_post="جندي", contact="0502223333"
    )  # wrong post
    _emp(
        db_session,
        id="G3",
        duty_unit="السرية الثانية",
        duty_post="مسؤول سرية",
        contact="0504445555",
    )  # wrong unit
    _emp(
        db_session, id="G4", duty_unit="السرية الأولى", duty_post="مسؤول سرية", contact=None
    )  # no phone
    _emp(
        db_session,
        id="G5",
        duty_unit="السرية الأولى",
        duty_post="مسؤول سرية",
        contact="0506667777",
        status="منتهي الخدمات",
    )  # inactive
    got = svc.resolve_supervisors(db_session, "السرية الأولى")
    assert [e.id for e in got] == ["G1"]
    assert got[0].id == match.id


def test_resolve_supervisors_no_mapping_returns_empty(db_session):
    _emp(db_session, id="G9", duty_unit="دعم 1", duty_post="مسؤول سرية", contact="0501112222")
    assert svc.resolve_supervisors(db_session, "دعم 1") == []
