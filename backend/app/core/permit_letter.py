"""Builds the Arabic RTL body HTML for the 1/5 security-permit General Book.

Count-aware (1 vs ≥2), generic «الفرد/الأفراد» terminology, zone phrase from the
selected zones, and the vehicle clause + الجدول الثاني table dropped when there
are no vehicles. Pure + unit-tested — no DB, no I/O.

Layout notes (rendered by ``core.arabic_rtl.html_to_docx``):
  * The narrative is justified; the company + validity + zones sit centered
    directly under the letter subject.
  * Zones render as colour-coded chips (the "colour key") — green / red / blue
    matching the app's zone palette — so the reader sees the access level at a
    glance, not only buried in the prose.
  * Both tables carry an explicit ``<colgroup>`` so columns size to their
    content (else the renderer splits them evenly and the make/model column
    wraps while the plate column wastes space). The section title is a merged,
    shaded header row inside the table (one fewer paragraph than a standalone
    caption — keeps the signature block on page one).
"""

from __future__ import annotations

from datetime import date
from html import escape

from app.core.permit_validity import period_label

# These permits authorize entry to the Al Wathba correctional facility; the
# letter is addressed to its director. Fills the template's {{ recipient_name }}
# token (rendered as «السيد \ {recipient} المحترم»).
PERMIT_RECIPIENT = "مدير المؤسسة العقابية والإصلاحية - الوثبة"

# key -> (Arabic label, chip background, chip ink). Palette mirrors the app's
# ZoneBadge / permit mockup: green, red, blue(=work residence).
_ZONES: dict[str, tuple[str, str, str]] = {
    "green": ("المنطقة الخضراء", "#dcfce7", "#15803d"),
    "red": ("المنطقة الحمراء", "#fee2e2", "#b91c1c"),
    "work_residence": ("سكن العمل", "#dbeafe", "#1d4ed8"),
}
_NBSP = "\u00a0"


def _access_chips(zones: list[object]) -> str:
    chips = []
    for zone in zones:
        key = str(zone)
        label, bg, ink = _ZONES.get(key, (key, "#eef2f6", "#334155"))
        chips.append(
            f'<span style="background-color:{bg}; color:{ink}; font-weight:bold">'
            f"{_NBSP}{escape(label)}{_NBSP}</span>"
        )
    return (_NBSP * 2).join(chips)


def _access_rows(access_areas: dict[str, object] | None, zones: list[str]) -> str:
    rows: list[str] = []

    def line(label: str, selected: list[object], separator: str = ":") -> None:
        if selected:
            rows.append(f"<div><b>{label}{separator}</b> {_access_chips(selected)}</div>")

    if access_areas is None:
        line("الموقع غير محدد", [zone for zone in zones if zone != "work_residence"])
        if "work_residence" in zones:
            line("منطقة أخرى", ["work_residence"], " —")
    else:
        for key, label in (("al_wathba_1", "الوثبة 1"), ("al_wathba_2", "الوثبة 2")):
            selected = access_areas.get(key, [])
            if isinstance(selected, list):
                line(label, selected)
        if access_areas.get("work_residence") is True:
            line("منطقة أخرى", ["work_residence"], " —")

    return "".join(rows)


def _info_row(label: str, value_html: str) -> str:
    """One row of the info block: bold label right-aligned, value centered.
    (Rendered inside a borderless 2-column table by build_permit_letter_html.)"""
    return (
        f'<tr><td style="text-align:right"><b>{label}</b></td>'
        f'<td style="text-align:center">{value_html}</td></tr>'
    )


def _fmt(d: date | str) -> str:
    if isinstance(d, date):
        return d.strftime("%Y/%m/%d")
    return str(d).replace("-", "/")




def _people_table(people: list[dict[str, str]]) -> str:
    rows = "".join(
        f"<tr><td>{i}</td><td>{escape(p.get('name') or '')}</td>"
        f"<td>{escape(p.get('uae_id') or '')}</td><td>{escape(p.get('nationality') or '')}</td>"
        f"<td>{escape(p.get('role') or '')}</td></tr>"
        for i, p in enumerate(people, 1)
    )
    return (
        '<table style="font-size:10pt; text-align:center; width:auto">'
        "<thead>"
        '<tr><th colspan="5" style="background-color:#e6f4f1; color:#0f766e">'
        "الجدول الأول: بيانات الأفراد</th></tr>"
        '<tr style="background-color:#eef2f6">'
        "<th>م</th><th>الاسم</th><th>رقم الهوية</th><th>الجنسية</th><th>المهنة</th></tr>"
        f"</thead><tbody>{rows}</tbody></table>"
    )


def _vehicle_table(vehicles: list[dict[str, str]]) -> str:
    rows = "".join(
        "<tr>"
        f"<td>{escape(v.get('plate_no') or '')}</td><td>{escape(v.get('plate_emirate') or '')}</td>"
        f"<td>{escape(v.get('plate_category') or '')}</td><td>{escape(v.get('traffic_no') or '')}</td>"
        f"<td>{escape(v.get('make_model') or '')}</td>"
        f"<td>{escape(v.get('colour') or '')}</td>"
        f"<td>{escape(_fmt(v.get('reg_expiry') or ''))}</td></tr>"
        for v in vehicles
    )
    return (
        '<table style="font-size:9pt; text-align:center; width:auto">'
        "<thead>"
        '<tr><th colspan="7" style="background-color:#e6f4f1; color:#0f766e">'
        "الجدول الثاني: بيانات المركبات</th></tr>"
        '<tr style="background-color:#eef2f6">'
        "<th>اللوحة</th><th>الإمارة</th><th>الفئة</th><th>رقم المرور</th>"
        "<th>الطراز / النوع</th><th>اللون</th><th>انتهاء الرخصة</th></tr>"
        f"</thead><tbody>{rows}</tbody></table>"
    )


def build_permit_letter_html(
    *,
    company: str,
    access_areas: dict[str, object] | None,
    zones: list[str],
    start_date: date,
    validity_value: int,
    validity_unit: str,
    people: list[dict[str, str]],
    vehicles: list[dict[str, str]],
    purpose: str | None = None,
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

    company_e = escape(company)

    # Company sits directly under the subject, aligned to the LEFT. Then a
    # justified narrative, then the info block (bold label pinned right, value
    # centered — a borderless 2-column table since one paragraph can't hold two
    # alignments).
    # dir="ltr" so "left" is the physical left — a bidi (RTL) paragraph renders
    # jc=left toward the right instead.
    header = f'<p dir="ltr" style="text-align:left; font-size:12pt"><b>الجهة: {company_e}</b></p>'
    para = (
        '<p style="text-align:justify; line-height:1.45">'
        "يطيب لنا أن نتقدم لسيادتكم بخالص التحية والتقدير، ويرجى من سيادتكم السماح "
        f"{subject_person} بالكشف أدناه بالدخول من البوابة الرئيسية إلى المواقع والمناطق الموضحة أدناه"
        f"{vehicle_clause}، حتى {verb_tail} في الوقت المحدد.</p>"
    )

    validity_val = f"{period_label(validity_value, validity_unit, 'ar')} اعتباراً من {_fmt(start_date)}"
    rows = _info_row("صلاحية التصريح:", validity_val)
    if purpose and purpose.strip():
        rows += _info_row("الغرض من التصريح:", escape(purpose.strip()))
    rows += _info_row("مواقع ومناطق الدخول المصرّح بها:", _access_rows(access_areas, zones))
    info = (
        '<table style="border:none; font-size:11pt">'
        '<colgroup><col style="width:32%"><col style="width:68%"></colgroup>'
        f"{rows}</table>"
    )

    spacer = "<p></p>"
    # Blank line between the company header and the narrative so they don't touch.
    html = header + spacer + para + info + spacer + _people_table(people)
    if has_vehicles:
        html += spacer + _vehicle_table(vehicles)
    return html
