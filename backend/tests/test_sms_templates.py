from datetime import date
from types import SimpleNamespace

import pytest

from app.db.models import Employee, Leave, Violation
from app.services import notify_format as nf
from app.services import sms_templates as st


def _emp(**kw):
    base = dict(id="G1", name_en="John Smith", name_ar="جون سميث", msg_language="ar")
    base.update(kw)
    return Employee(**base)


def test_leave_approved_english_full_text():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=7,
        employee_id="G1",
        leave_type="Annual Leave - إجازة سنوية",
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
    )
    text = st.render_text("leave_approved", "en", leave, emp)
    assert text == (
        "Dear John Smith,\n"
        "Your Annual Leave has been approved.\n"
        "Start: 05/07/2026 (Sunday)\n"
        "End: 09/07/2026 (Thursday)\n"
        "Duration: 5 day(s).\n"
        "Please bring your work ID to the office to avoid any violation.\n"
        "Have a nice vacation.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_annual_leave_adds_idcard_and_signoff_both_languages():
    emp = _emp()
    leave = Leave(
        id=9,
        employee_id="G1",
        leave_type="Annual Leave",
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
    )
    ar = st.render_text("leave_approved", "ar", leave, emp)
    assert "يرجى إحضار بطاقة العمل إلى المكتب لتجنب أي مخالفة." in ar
    assert "إجازة سعيدة." in ar
    en = st.render_text("leave_approved", "en", leave, emp)
    assert "Please bring your work ID to the office to avoid any violation." in en
    assert "Have a nice vacation." in en


def test_non_annual_leave_has_no_idcard_lines():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=10,
        employee_id="G1",
        leave_type="Sick Leave - الإجازة المرضية",
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
    )
    en = st.render_text("leave_approved", "en", leave, emp)
    assert "work ID" not in en
    assert "Have a nice vacation." not in en


def test_leave_approved_english_no_doubled_leave_word():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=8,
        employee_id="G1",
        leave_type="Annual Leave",  # english-only
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
    )
    text = st.render_text("leave_approved", "en", leave, emp)
    assert "Your Annual Leave has been approved." in text
    assert "Leave leave" not in text


def test_leave_approved_arabic_no_english_leak_when_english_only_stored():
    emp = _emp()
    leave = Leave(
        id=8,
        employee_id="G1",
        leave_type="Annual Leave",  # english-only
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
    )
    text = st.render_text("leave_approved", "ar", leave, emp)
    assert "(الإجازة السنوية)" in text
    assert "Annual" not in text


def test_leave_approved_arabic_has_signature_and_weekday():
    emp = _emp()
    leave = Leave(
        id=7,
        employee_id="G1",
        leave_type="Annual Leave - إجازة سنوية",
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        days=5,
    )
    text = st.render_text("leave_approved", "ar", leave, emp)
    assert text.startswith("عزيزي جون سميث،")
    assert "(الأحد)" in text
    assert "إجازة سنوية" in text
    assert text.endswith("إدارة مركز الإصلاح والتأهيل بالوثبة")


def test_duty_resumption_uses_return_date():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=7,
        employee_id="G1",
        leave_type="Annual - سنوية",
        start_date=date(2026, 7, 5),
        end_date=date(2026, 7, 9),
        return_date=date(2026, 7, 10),
    )
    text = st.render_text("duty_resumption", "en", leave, emp)
    assert text == (
        "Dear John Smith,\n"
        "Your return to duty on 10/07/2026 (Friday) has been recorded.\n"
        "Welcome back.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_violation_shows_description_and_sign_request():
    emp = _emp(msg_language="en")
    v = Violation(
        id=3,
        employee_id="G1",
        violation_type="Others",
        date=date(2026, 7, 1),
        action_taken=None,
        deduction_days=0,
        description="Left post without permission",
    )
    text = st.render_text("violation", "en", v, emp)
    assert text == (
        "Dear John Smith,\n"
        "A violation has been recorded against you on 01/07/2026 (Wednesday).\n"
        "Details: Left post without permission.\n"
        "Please come to the administration office to sign the violation record.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_violation_omits_details_line_when_no_description():
    emp = _emp(msg_language="en")
    v = Violation(id=5, employee_id="G1", violation_type="Others", date=date(2026, 7, 1))
    text = st.render_text("violation", "en", v, emp)
    assert "Details:" not in text
    assert "sign the violation record" in text


def test_unknown_event_raises():
    with pytest.raises(KeyError):
        st.render_text("nope", "ar", None, _emp())


def _has_ascii_letter(s: str) -> bool:
    return any("a" <= c.lower() <= "z" for c in s)


def test_salary_transfer_ar():
    rec = SimpleNamespace(fields={"bank_name": "بنك أبوظبي الأول"}, today=date(2026, 7, 5))
    text = st.render_text(nf.EVENT_SALARY_TRANSFER, "ar", rec, _emp())
    assert "تم اعتماد طلب تحويل راتبك إلى حسابك لدى بنك أبوظبي الأول." in text
    assert "سيتم التحويل مع راتب شهر أغسطس 2026." in text
    assert "مكتب الموارد البشرية" in text
    assert text.strip().endswith("إدارة مركز الإصلاح والتأهيل بالوثبة")
    assert "شهر شهر" not in text
    assert not _has_ascii_letter(text.replace("2026", ""))


def test_salary_transfer_en():
    rec = SimpleNamespace(fields={"bank_name": "First Abu Dhabi Bank"}, today=date(2026, 7, 5))
    text = st.render_text(nf.EVENT_SALARY_TRANSFER, "en", rec, _emp())
    assert (
        "Your salary transfer request to your account at First Abu Dhabi Bank has been approved."
        in text
    )
    assert "The transfer will take effect with the August 2026 salary." in text
    assert not any("؀" <= c <= "ۿ" for c in text)


def test_salary_deduction_ar():
    rec = SimpleNamespace(fields={"amount": "500"}, today=date(2026, 7, 5))
    text = st.render_text(nf.EVENT_SALARY_DEDUCTION, "ar", rec, _emp())
    assert "سيتم خصم مبلغ 500 درهم من المرتب الشهري." in text
    assert not _has_ascii_letter(text.replace("500", ""))


def test_salary_deduction_en():
    rec = SimpleNamespace(fields={"amount": "500"}, today=date(2026, 7, 5))
    text = st.render_text(nf.EVENT_SALARY_DEDUCTION, "en", rec, _emp())
    assert "An amount of AED 500 will be deducted from the monthly salary." in text
    assert not any("؀" <= c <= "ۿ" for c in text)


def test_employee_clearance_ar():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))  # 05/07/2026 is a Sunday
    text = st.render_text(nf.EVENT_EMPLOYEE_CLEARANCE, "ar", rec, _emp())
    assert "تم إنجاز إخلاء طرفك اعتباراً من 05/07/2026 (الأحد)." in text
    assert "نتمنى لك التوفيق." in text
    assert not _has_ascii_letter(text.replace("05/07/2026", ""))


def test_employee_clearance_en():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))
    text = st.render_text(nf.EVENT_EMPLOYEE_CLEARANCE, "en", rec, _emp())
    assert "Your employee clearance has been completed, effective 05/07/2026 (Sunday)." in text
    assert "We wish you all the best." in text
    assert not any("؀" <= c <= "ۿ" for c in text)


def test_hr_request_single_ar():
    rec = SimpleNamespace(
        fields={"doc_selections": {"salary_certificate": True}}, today=date(2026, 7, 5)
    )
    text = st.render_text(nf.EVENT_HR_REQUEST, "ar", rec, _emp())
    assert "تم تقديم طلبك للحصول على شهادة راتب." in text
    assert "سيتم إبلاغك عند صدور المستند." in text
    assert not _has_ascii_letter(text)


def test_hr_request_single_en():
    rec = SimpleNamespace(fields={"doc_selections": "salary_certificate"}, today=date(2026, 7, 5))
    text = st.render_text(nf.EVENT_HR_REQUEST, "en", rec, _emp())
    assert "Your request for Salary Certificate has been submitted." in text
    assert "You will be notified once the document is issued." in text
    assert not any("؀" <= c <= "ۿ" for c in text)


def test_hr_request_plural_ar():
    rec = SimpleNamespace(
        fields={"doc_selections": {"salary_certificate": True, "experience_certificate": True}},
        today=date(2026, 7, 5),
    )
    text = st.render_text(nf.EVENT_HR_REQUEST, "ar", rec, _emp())
    assert "تم تقديم طلبك للحصول على المستندات التالية: شهادة راتب، شهادة خبرة." in text
    assert "سيتم إبلاغك عند صدورها." in text
    assert not _has_ascii_letter(text)


def test_passport_release_ar():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))
    text = st.render_text(nf.EVENT_PASSPORT_RELEASE, "ar", rec, _emp())
    assert "تم تقديم طلب استلام جواز سفرك." in text
    assert "سيتم إبلاغك عند جاهزيته للاستلام." in text
    assert not _has_ascii_letter(text)


def test_passport_release_en():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))
    text = st.render_text(nf.EVENT_PASSPORT_RELEASE, "en", rec, _emp())
    assert "Your passport release request has been submitted." in text
    assert "You will be notified when it is ready for collection." in text
    assert not any("؀" <= c <= "ۿ" for c in text)


def test_resignation_ar():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))
    text = st.render_text(nf.EVENT_RESIGNATION, "ar", rec, _emp())
    assert "تم استلام خطاب استقالتك بتاريخ 05/07/2026 (الأحد)." in text
    assert "سيتم إبلاغك بالإجراءات التالية." in text
    assert not _has_ascii_letter(text.replace("05/07/2026", ""))


def test_resignation_en():
    rec = SimpleNamespace(fields={}, today=date(2026, 7, 5))
    text = st.render_text(nf.EVENT_RESIGNATION, "en", rec, _emp())
    assert "Your resignation letter has been received on 05/07/2026 (Sunday)." in text
    assert "You will be informed of the next steps." in text
    assert not any("؀" <= c <= "ۿ" for c in text)


def test_warning_ar_routes_to_admin_office():
    rec = SimpleNamespace(
        fields={"violation_type": "Late Attendance - التأخر عن الدوام"},
        today=date(2026, 7, 5),
    )
    text = st.render_text(nf.EVENT_WARNING, "ar", rec, _emp())
    assert "تم إصدار إنذار بحقك بتاريخ 05/07/2026 (الأحد)." in text
    assert "المخالفة: التأخر عن الدوام." in text
    assert "يرجى الحضور إلى مكتب الإدارة للتوقيع على الإنذار." in text
    assert "مكتب الموارد البشرية" not in text  # warnings route to admin, not HR
    assert not _has_ascii_letter(text.replace("05/07/2026", ""))


def test_warning_en():
    rec = SimpleNamespace(
        fields={"violation_type": "Late Attendance - التأخر عن الدوام"},
        today=date(2026, 7, 5),
    )
    text = st.render_text(nf.EVENT_WARNING, "en", rec, _emp())
    assert "A warning has been issued against you on 05/07/2026 (Sunday)." in text
    assert "Violation: Late Attendance." in text
    assert "Please come to the administration office to sign the warning." in text
    assert not any("؀" <= c <= "ۿ" for c in text)


def test_warning_multi_violation_ar_no_leak():
    rec = SimpleNamespace(
        fields={"violation_type": "Late - التأخر، Sleeping - النوم"},
        today=date(2026, 7, 5),
    )
    text = st.render_text(nf.EVENT_WARNING, "ar", rec, _emp())
    assert "التأخر" in text
    assert "النوم" in text
    assert "Late" not in text
    assert "Sleeping" not in text
    assert not _has_ascii_letter(text.replace("05/07/2026", ""))


def test_warning_multi_violation_en():
    rec = SimpleNamespace(
        fields={"violation_type": "Late - التأخر، Sleeping - النوم"},
        today=date(2026, 7, 5),
    )
    text = st.render_text(nf.EVENT_WARNING, "en", rec, _emp())
    assert "Late" in text
    assert "Sleeping" in text
    assert not any("؀" <= c <= "ۿ" for c in text)


def test_violation_ar_shows_description_and_sign_request():
    emp = _emp()
    v = Violation(
        id=4,
        employee_id="G1",
        violation_type="Others",
        date=date(2026, 7, 1),
        action_taken=None,
        deduction_days=0,
        description="ترك موقع العمل دون إذن",
    )
    text = st.render_text("violation", "ar", v, emp)
    assert "تم تسجيل مخالفة بحقك بتاريخ 01/07/2026" in text
    assert "التفاصيل: ترك موقع العمل دون إذن." in text
    assert "يرجى الحضور إلى مكتب الإدارة للتوقيع على محضر المخالفة." in text
    assert not _has_ascii_letter(text.replace("01/07/2026", ""))


def test_leave_cancelled_includes_reason_from_notes():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=21,
        employee_id="G1",
        leave_type="Annual Leave",
        start_date=date(2026, 7, 20),
        end_date=date(2026, 8, 3),
        days=15,
        notes="Operational requirement — coverage shortage.",
    )
    en = st.render_text("leave_cancelled", "en", leave, emp)
    assert "Reason: Operational requirement — coverage shortage.\n" in en
    ar = st.render_text("leave_cancelled", "ar", leave, emp)
    assert "سبب الإلغاء: Operational requirement — coverage shortage.\n" in ar


def test_leave_cancelled_without_notes_has_no_reason_line():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=22,
        employee_id="G1",
        leave_type="Annual Leave",
        start_date=date(2026, 7, 20),
        end_date=date(2026, 8, 3),
        days=15,
        notes="   ",
    )
    en = st.render_text("leave_cancelled", "en", leave, emp)
    assert "Reason:" not in en
    ar = st.render_text("leave_cancelled", "ar", leave, emp)
    assert "سبب الإلغاء" not in ar


def test_sick_leave_registered_full_text_en():
    emp = _emp(msg_language="en")
    leave = Leave(
        id=31,
        employee_id="G1",
        leave_type="Sick Leave - الإجازة المرضية",
        start_date=date(2026, 7, 13),
        end_date=date(2026, 7, 15),
        days=3,
    )
    text = st.render_text("sick_leave_registered", "en", leave, emp)
    assert text == (
        "Dear John Smith,\n"
        "Your Sick Leave has been registered.\n"
        "Duration: 3 day(s), from 13/07/2026 (Monday) to 15/07/2026 (Wednesday).\n"
        "We wish you a speedy recovery.\n"
        "Al Wathba Rehabilitation Centre"
    )


def test_sick_leave_registered_arabic_wording():
    emp = _emp()
    leave = Leave(
        id=32,
        employee_id="G1",
        leave_type="Sick Leave",
        start_date=date(2026, 7, 13),
        end_date=date(2026, 7, 15),
        days=3,
    )
    ar = st.render_text("sick_leave_registered", "ar", leave, emp)
    assert "تم تسجيل إجازتك المرضية." in ar
    assert "المدة: 3 يوم، من 13/07/2026 (الإثنين) إلى 15/07/2026 (الأربعاء)." in ar
    assert "نتمنى لك الشفاء العاجل." in ar
    assert ar.endswith("إدارة مركز الإصلاح والتأهيل بالوثبة")
