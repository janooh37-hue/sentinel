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


def test_employee_name_prefers_language():
    assert nf.employee_name(_emp(), "ar") == "جون سميث"
    assert nf.employee_name(_emp(msg_language="en"), "en") == "John Smith"


def test_action_text_fallback_to_deduction():
    assert nf.action_text(None, 2, "en") == "2 day(s) deduction"
    assert nf.action_text(None, 2, "ar") == "خصم 2 يوم"
    assert nf.action_text("Warning", 0, "en") == "Warning"
    assert nf.action_text(None, 0, "en") == "—"
