from datetime import date

import pytest

from app.db.models import Employee, Leave, Violation
from app.services import sms_templates as st


def _emp(**kw):
    base = dict(id="G1", name_en="John Smith", name_ar="جون سميث", msg_language="ar")
    base.update(kw)
    return Employee(**base)


def test_leave_approved_english_full_text():
    emp = _emp(msg_language="en")
    leave = Leave(id=7, employee_id="G1", leave_type="Annual Leave - إجازة سنوية",
                  start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5)
    text = st.render_text("leave_approved", "en", leave, emp)
    assert text == (
        "Dear John Smith,\n"
        "Your Annual Leave has been approved.\n"
        "Start: 05/07/2026 (Sunday)\n"
        "End: 09/07/2026 (Thursday)\n"
        "Duration: 5 day(s).\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_leave_approved_english_no_doubled_leave_word():
    emp = _emp(msg_language="en")
    leave = Leave(id=8, employee_id="G1", leave_type="Annual Leave",  # english-only
                  start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5)
    text = st.render_text("leave_approved", "en", leave, emp)
    assert "Your Annual Leave has been approved." in text
    assert "Leave leave" not in text


def test_leave_approved_arabic_no_english_leak_when_english_only_stored():
    emp = _emp()
    leave = Leave(id=8, employee_id="G1", leave_type="Annual Leave",  # english-only
                  start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5)
    text = st.render_text("leave_approved", "ar", leave, emp)
    assert "(الإجازة السنوية)" in text
    assert "Annual" not in text


def test_leave_approved_arabic_has_signature_and_weekday():
    emp = _emp()
    leave = Leave(id=7, employee_id="G1", leave_type="Annual Leave - إجازة سنوية",
                  start_date=date(2026, 7, 5), end_date=date(2026, 7, 9), days=5)
    text = st.render_text("leave_approved", "ar", leave, emp)
    assert text.startswith("عزيزي جون سميث،")
    assert "(الأحد)" in text
    assert "إجازة سنوية" in text
    assert text.endswith("إدارة مركز الإصلاح والتأهيل بالوثبة")


def test_duty_resumption_uses_return_date():
    emp = _emp(msg_language="en")
    leave = Leave(id=7, employee_id="G1", leave_type="Annual - سنوية",
                  start_date=date(2026, 7, 5), end_date=date(2026, 7, 9),
                  return_date=date(2026, 7, 10))
    text = st.render_text("duty_resumption", "en", leave, emp)
    assert text == (
        "Dear John Smith,\n"
        "Your return to duty on 10/07/2026 (Friday) has been recorded.\n"
        "Welcome back.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_violation_falls_back_to_deduction():
    emp = _emp(msg_language="en")
    v = Violation(id=3, employee_id="G1",
                  violation_type="Sleeping on Duty - النوم أثناء الخدمة",
                  date=date(2026, 7, 1), action_taken=None, deduction_days=2)
    text = st.render_text("violation", "en", v, emp)
    assert text == (
        "Dear John Smith,\n"
        "A Sleeping on Duty has been recorded on 01/07/2026 (Wednesday).\n"
        "Action: 2 day(s) deduction.\n"
        "Please contact HR for any clarification.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_unknown_event_raises():
    with pytest.raises(KeyError):
        st.render_text("nope", "ar", None, _emp())
