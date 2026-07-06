from datetime import date

from app.db.models import Employee
from app.services import notify_format as nf


def _emp(**kw):
    base = dict(id="G1", name_en="John Smith", name_ar="جون سميث", msg_language="ar")
    base.update(kw)
    return Employee(**base)


def test_event_constants():
    assert nf.EVENT_LEAVE_APPROVED == "leave_approved"
    assert nf.EVENT_DUTY_RESUMPTION == "duty_resumption"
    assert nf.EVENT_VIOLATION == "violation"


def test_fmt_date_is_day_month_year():
    assert nf.fmt_date(date(2026, 7, 5)) == "05/07/2026"


def test_weekday_localized_monday_first():
    # 2026-07-05 is a Sunday
    assert nf.weekday(date(2026, 7, 5), "en") == "Sunday"
    assert nf.weekday(date(2026, 7, 5), "ar") == "الأحد"


def test_type_label_splits_on_dash():
    assert nf.type_label("Annual Leave - إجازة سنوية", "en") == "Annual Leave"
    assert nf.type_label("Annual Leave - إجازة سنوية", "ar") == "إجازة سنوية"


def test_type_label_wellformed_stored_arabic_wins_over_canonical():
    # An explicit ' - <arabic>' is the record's own wording — keep it verbatim
    # rather than substituting the canonical label.
    assert nf.type_label("Annual Leave - الإجازة السنوية", "ar") == "الإجازة السنوية"
    assert nf.type_label("Duty Leave - الاستئذان", "ar") == "الاستئذان"


def test_type_label_canonical_when_english_only():
    # Stored without the Arabic half — Arabic SMS must NOT leak English.
    assert nf.type_label("Annual Leave", "ar") == "الإجازة السنوية"
    assert nf.type_label("Annual Leave", "en") == "Annual Leave"
    assert nf.type_label("Sick Leave", "ar") == "الإجازة المرضية"


def test_type_label_canonical_when_no_dash_mixed():
    # 'EN AR' with no ' - ' separator — split fails; canonical map rescues both.
    assert nf.type_label("Duty Resumption مباشرة عمل", "en") == "Duty Resumption"
    assert nf.type_label("Duty Resumption مباشرة عمل", "ar") == "مباشرة عمل"
    assert nf.type_label("Passport Release تسليم جواز", "ar") == "تسليم جواز"


def test_type_label_generic_unknown_and_violation():
    assert nf.type_label("Unknown", "ar") == "إجازة"
    assert nf.type_label("Unknown", "en") == "Leave"
    assert nf.type_label("Violation", "ar") == "مخالفة"
    assert nf.type_label("Violation", "en") == "Violation"


def test_type_label_known_arabic_freetext_maps_to_english():
    # A known Arabic-only violation type renders English on the EN channel.
    assert nf.type_label("ترك مكان العمل", "ar") == "ترك مكان العمل"
    assert nf.type_label("ترك مكان العمل", "en") == "Leaving the workplace"


def test_type_label_unknown_arabic_only_value_falls_through():
    # An unmapped Arabic free-text value has no English form; it stays as-is.
    assert nf.type_label("نص غير معروف", "ar") == "نص غير معروف"
    assert nf.type_label("نص غير معروف", "en") == "نص غير معروف"


def test_action_text_translates_known_arabic_action_for_english():
    assert nf.action_text("إنذار خطي", 0, "en") == "Written warning"
    assert nf.action_text("إنذار خطي", 0, "ar") == "إنذار خطي"
    # Unknown free-text action is shown verbatim in both languages.
    assert nf.action_text("Custom note", 0, "en") == "Custom note"


def test_employee_name_prefers_language():
    assert nf.employee_name(_emp(), "ar") == "جون سميث"
    assert nf.employee_name(_emp(msg_language="en"), "en") == "John Smith"


def test_action_text_fallback_to_deduction():
    assert nf.action_text(None, 2, "en") == "2 day(s) deduction"
    assert nf.action_text(None, 2, "ar") == "خصم 2 يوم"
    assert nf.action_text("Warning", 0, "en") == "Warning"
    assert nf.action_text(None, 0, "en") == "—"


def test_salary_month_on_or_before_15_is_next_month():
    # 5 July 2026 (<=15) -> next month = August 2026
    assert nf.salary_transfer_month(date(2026, 7, 5), "ar") == "أغسطس 2026"
    assert nf.salary_transfer_month(date(2026, 7, 5), "en") == "August 2026"


def test_salary_month_boundary_15_is_next_month():
    assert nf.salary_transfer_month(date(2026, 7, 15), "en") == "August 2026"


def test_salary_month_after_15_is_month_after():
    # 20 July 2026 (>15) -> month after = September 2026
    assert nf.salary_transfer_month(date(2026, 7, 20), "ar") == "سبتمبر 2026"
    assert nf.salary_transfer_month(date(2026, 7, 20), "en") == "September 2026"


def test_salary_month_year_rollover_before_15():
    # 5 Dec 2026 (<=15) -> January 2027
    assert nf.salary_transfer_month(date(2026, 12, 5), "en") == "January 2027"


def test_salary_month_year_rollover_after_15():
    # 20 Dec 2026 (>15) -> February 2027
    assert nf.salary_transfer_month(date(2026, 12, 20), "en") == "February 2027"


def test_salary_month_has_no_leading_shahr():
    # Guard the doubled-«شهر» contract: helper must not prefix «شهر».
    assert not nf.salary_transfer_month(date(2026, 7, 5), "ar").startswith("شهر")


def test_office_constants():
    assert nf.HR_OFFICE_AR == "مكتب الموارد البشرية"
    assert nf.ADMIN_OFFICE_AR == "مكتب الإدارة"


def test_hr_docs_single_arabic():
    assert nf.hr_request_docs({"salary_certificate": True}, "ar") == ("شهادة راتب", 1)


def test_hr_docs_single_english():
    assert nf.hr_request_docs("salary_certificate", "en") == ("Salary Certificate", 1)


def test_hr_docs_employment_certificate_label():
    # Confirmed label: خطاب عمل (NOT شهادة عمل / شهادة راتب).
    assert nf.hr_request_docs(["employment_certificate"], "ar") == ("خطاب عمل", 1)


def test_hr_docs_multiple_joined_arabic():
    label, count = nf.hr_request_docs(
        {"salary_certificate": True, "experience_certificate": True}, "ar"
    )
    assert label == "شهادة راتب، شهادة خبرة"
    assert count == 2


def test_hr_docs_unknown_key_skipped():
    assert nf.hr_request_docs(["salary_certificate", "bogus"], "en") == ("Salary Certificate", 1)
