from datetime import date

from app.db.models import Employee, Leave, Violation
from app.services import whatsapp_templates as wt


def _emp(**kw):
    base = dict(id="G1", name_en="John Smith", name_ar="جون سميث", msg_language="ar")
    base.update(kw)
    return Employee(**base)


def test_leave_approved_arabic_params():
    emp = _emp()
    leave = Leave(
        id=7, employee_id="G1", leave_type="Annual Leave - إجازة سنوية",
        start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5,
        status="Approved",
    )
    name, params = wt.render("leave_approved", "ar", leave, emp)
    assert name == "leave_approved_ar"
    # name(ar), type(ar), start, start-weekday, end, end-weekday, days
    assert params == [
        "جون سميث", "إجازة سنوية",
        "05/07/2026", "الأحد",
        "09/07/2026", "الخميس",
        "5",
    ]


def test_leave_approved_english_uses_english_half_and_name():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=7, employee_id="G1", leave_type="Annual Leave - إجازة سنوية",
        start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5,
    )
    name, params = wt.render("leave_approved", "en", leave, emp)
    assert name == "leave_approved_en"
    assert params[0] == "John Smith"
    assert params[1] == "Annual Leave"
    assert params[3] == "Sunday"


def test_duty_resumption_params():
    emp = _emp()
    leave = Leave(id=7, employee_id="G1", leave_type="Annual - سنوية",
                  start_date=date(2026, 7, 5), end_date=date(2026, 7, 9),
                  return_date=date(2026, 7, 10))
    name, params = wt.render("duty_resumption", "ar", leave, emp)
    assert name == "duty_resumption_ar"
    assert params == ["جون سميث", "10/07/2026", "الجمعة"]


def test_violation_params_falls_back_to_deduction_when_no_action():
    emp = _emp(msg_language="en")
    v = Violation(id=3, employee_id="G1",
                  violation_type="Sleeping on Duty - النوم أثناء الخدمة",
                  date=date(2026, 7, 1), action_taken=None, deduction_days=2)
    name, params = wt.render("violation", "en", v, emp)
    assert name == "violation_en"
    assert params[0] == "John Smith"
    assert params[1] == "Sleeping on Duty"
    assert params[2] == "01/07/2026"
    assert params[4] == "2 day(s) deduction"


def test_unknown_event_raises():
    import pytest
    with pytest.raises(KeyError):
        wt.render("nope", "ar", None, _emp())
