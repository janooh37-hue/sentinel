from datetime import date

from app.db.models import Employee, Leave
from app.services import digest_service as ds


def _pair(id_, name_ar, name_en, s, e):
    emp = Employee(
        id=id_,
        name_ar=name_ar,
        name_en=name_en,
        status="Active",
        contact="0501112222",
        msg_language="ar",
        duty_unit="u",
        duty_post="p",
    )
    lv = Leave(
        id=1,
        employee_id=id_,
        leave_type="annual leave",
        start_date=s,
        end_date=e,
        status="Approved",
        days=1,
    )
    return emp, lv


def test_month_bounds():
    assert ds.month_bounds(date(2026, 7, 15)) == (date(2026, 7, 1), date(2026, 7, 31))
    assert ds.month_bounds(date(2026, 2, 10)) == (date(2026, 2, 1), date(2026, 2, 28))


def test_render_arabic_lists_names_and_dates():
    pairs = [_pair("G1", "أحمد", "Ahmed", date(2026, 7, 5), date(2026, 7, 9))]
    out = ds.render_leave_digest("السرية الأولى", date(2026, 7, 1), pairs, "ar")
    assert "يوليو" in out
    assert "2026" in out
    assert "أحمد" in out
    assert "05/07/2026" in out and "09/07/2026" in out
    assert "السرية الأولى" in out


def test_render_english_uses_english_name_and_month():
    pairs = [_pair("G1", "أحمد", "Ahmed", date(2026, 7, 5), date(2026, 7, 9))]
    out = ds.render_leave_digest("Alpha", date(2026, 7, 1), pairs, "en")
    assert "July" in out and "Ahmed" in out
