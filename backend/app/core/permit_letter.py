"""Builds the Arabic RTL body HTML for the 1/5 security-permit General Book.

Count-aware (1 vs ≥2), generic «الفرد/الأفراد» terminology, zone phrase from the
selected zones, and the vehicle clause + الجدول الثاني table dropped when there
are no vehicles. Pure + unit-tested — no DB, no I/O.
"""

from __future__ import annotations

from datetime import date
from html import escape

ZONE_AR: dict[str, str] = {
    "green": "المنطقة الخضراء",
    "red": "المنطقة الحمراء",
    "work_residence": "سكن الموظفين",
}


def zones_phrase(zones: list[str]) -> str:
    parts = [ZONE_AR.get(z, z) for z in zones]
    return " و".join(parts)  # Arabic conjunction "و" prefixes the next word


def _fmt(d: date | str) -> str:
    if isinstance(d, date):
        return d.strftime("%Y/%m/%d")
    return str(d).replace("-", "/")


def _people_table(people: list[dict[str, str]]) -> str:
    rows = "".join(
        f"<tr><td>{i}</td><td>{escape(p.get('name') or '')}</td>"
        f"<td>{escape(p.get('uae_id') or '')}</td><td>{escape(p.get('nationality') or '')}</td></tr>"
        for i, p in enumerate(people, 1)
    )
    return (
        "<p><b>الجدول الأول: بيانات الأفراد</b></p>"
        '<table border="1" cellspacing="0" cellpadding="4"><thead><tr>'
        "<th>م</th><th>الاسم</th><th>رقم الهوية</th><th>الجنسية</th>"
        f"</tr></thead><tbody>{rows}</tbody></table>"
    )


def _vehicle_table(vehicles: list[dict[str, str]]) -> str:
    rows = "".join(
        "<tr>"
        f"<td>{escape(v.get('plate_no') or '')}</td><td>{escape(v.get('plate_emirate') or '')}</td>"
        f"<td>{escape(v.get('plate_category') or '')}</td><td>{escape(v.get('traffic_no') or '')}</td>"
        f"<td>{escape(v.get('make_model') or '')}</td><td>{escape(v.get('colour') or '')}</td>"
        f"<td>{_fmt(v.get('reg_expiry') or '')}</td></tr>"
        for v in vehicles
    )
    return (
        "<p><b>الجدول الثاني: بيانات المركبات</b></p>"
        '<table border="1" cellspacing="0" cellpadding="4"><thead><tr>'
        "<th>اللوحة</th><th>الإمارة</th><th>الفئة</th><th>رقم المرور</th>"
        "<th>النوع/الموديل</th><th>اللون</th><th>انتهاء الرخصة</th>"
        f"</tr></thead><tbody>{rows}</tbody></table>"
    )


def build_permit_letter_html(
    *,
    company: str,
    zones: list[str],
    start_date: date,
    end_date: date,
    people: list[dict[str, str]],
    vehicles: list[dict[str, str]],
) -> str:
    many_people = len(people) >= 2
    has_vehicles = len(vehicles) > 0
    many_vehicles = len(vehicles) >= 2

    subject_person = "للأفراد المبيّنين" if many_people else "للفرد المبيّن"
    verb_tail = "يتسنّى لهم القيام بعملهم" if many_people else "يتسنّى له القيام بعمله"

    if has_vehicles:
        poss = "وبحوزتهم" if many_people else "وبحوزته"
        veh_word = "المركبات" if many_vehicles else "المركبة"
        vehicle_clause = f"، {poss} {veh_word} المنوّه عنها بالجدول الثاني"
    else:
        vehicle_clause = ""

    zone_ar = zones_phrase(zones)
    company_e = escape(company)

    para = (
        "<p>يطيب لنا أن نتقدم لسيادتكم بخالص التحية والتقدير، ويرجى من سيادتكم السماح "
        f"{subject_person} بالكشف أدناه بالدخول من البوابة الرئيسية إلى {zone_ar}"
        f"{vehicle_clause}، حتى {verb_tail} في الوقت المحدد.</p>"
    )
    facts = (
        f"<p><b>الجهة:</b> {company_e} · <b>صلاحية التصريح:</b> "
        f"من {_fmt(start_date)} إلى {_fmt(end_date)}</p>"
    )

    html = para + facts + _people_table(people)
    if has_vehicles:
        html += _vehicle_table(vehicles)
    return html
