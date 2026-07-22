# backend/tests/test_permit_letter.py
from datetime import date

from app.core.permit_letter import build_permit_letter_html, zones_phrase

P1 = [{"name": "Ali", "uae_id": "784-1", "nationality": "مصر"}]
P2 = [*P1, {"name": "Rakesh", "uae_id": "784-2", "nationality": "الهند"}]
V1 = [
    {
        "plate_no": "A 1",
        "plate_emirate": "دبي",
        "plate_category": "خصوصي",
        "traffic_no": "123",
        "make_model": "Toyota",
        "colour": "أبيض",
        "reg_expiry": "2027-03-14",
    }
]


def test_zone_phrase_join():
    assert zones_phrase(["green"]) == "المنطقة الخضراء"
    assert zones_phrase(["green", "work_residence"]) == "المنطقة الخضراء وسكن العمل"


def test_single_person_single_vehicle():
    html = build_permit_letter_html(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=P1,
        vehicles=V1,
    )
    assert "للفرد المبيّن" in html and "بحوزته المركبة" in html and "يتسنّى له القيام بعمله" in html
    assert "الجدول الثاني" in html and "A 1" in html


def test_many_persons_many_vehicles():
    html = build_permit_letter_html(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=P2,
        vehicles=[*V1, *V1],
    )
    assert (
        "للأفراد المبيّنين" in html
        and "بحوزتهم المركبات" in html
        and "يتسنّى لهم القيام بعملهم" in html
    )


def test_no_vehicles_drops_clause_and_table():
    html = build_permit_letter_html(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=P2,
        vehicles=[],
    )
    assert "المركبة" not in html and "المركبات" not in html
    assert "الجدول الثاني" not in html
    assert "للأفراد المبيّنين" in html


def test_uses_individual_not_employee_term():
    html = build_permit_letter_html(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=P1,
        vehicles=[],
    )
    assert "الموظف" not in html  # generic template: individuals, not employees
    assert "الجدول الثاني" not in html  # no vehicle table when 0 vehicles
    assert "للفرد المبيّن" in html


def test_work_residence_zone_phrase_and_person_term():
    html = build_permit_letter_html(
        company="X",
        zones=["work_residence"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 2),
        people=P1,
        vehicles=[],
    )
    assert "سكن العمل" in html  # zone phrase renders (matches app-wide label)
    assert "للفرد المبيّن" in html  # person term stays الفرد, not الموظف


# ---------------------------------------------------------------------------
# Layout structure (the "not-crowded, colour-coded" pass — rendered by
# arabic_rtl.html_to_docx, which honours colgroup widths, run shading, and
# text-align:justify).
# ---------------------------------------------------------------------------


def _sample(**kw):
    base = dict(
        company="Al Nahda Contracting LLC",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 8, 1),
        people=P2,
        vehicles=V1,
    )
    base.update(kw)
    return build_permit_letter_html(**base)


def test_company_renders_as_header_line():
    # Company sits under the subject as its own bold, centered header line.
    html = _sample()
    assert "الجهة: Al Nahda Contracting LLC" in html
    assert "text-align:center" in html


def test_body_paragraph_is_justified():
    assert "text-align:justify" in _sample()


def test_tables_are_autofit_and_centered():
    # Tables opt into Word AutoFit-to-Contents (width:auto) so columns hug their
    # text and the table centers, instead of stretching full-width.
    html = _sample()
    assert html.count("width:auto") == 2  # people + vehicles
    assert "text-align:center" in html  # cell text is centered
    assert "text-align:right" not in html  # no per-cell right-align overrides left


def test_section_titles_are_merged_shaded_header_rows():
    # Titles live INSIDE the table as a merged, shaded row (not a standalone
    # paragraph), keeping the letter compact.
    html = _sample()
    assert 'colspan="4"' in html and "الجدول الأول: بيانات الأفراد" in html
    assert 'colspan="7"' in html and "الجدول الثاني: بيانات المركبات" in html
    assert "<p><b>الجدول" not in html  # no standalone caption paragraphs


def test_purpose_renders_only_when_set():
    with_purpose = _sample(purpose="صيانة أنظمة الإنذار")
    assert "الغرض من التصريح:" in with_purpose and "صيانة أنظمة الإنذار" in with_purpose
    # Absent (None / blank) → no purpose line at all.
    assert "الغرض من التصريح:" not in _sample()
    assert "الغرض من التصريح:" not in _sample(purpose="   ")


def test_table_text_is_centered_at_table_level():
    # Alignment is set once on the <table> (cascades to every cell), not per cell.
    html = _sample()
    assert "text-align:center; width:auto" in html
    # Data cells are plain <td> — they inherit the table's center alignment.
    assert "<td>1</td>" in html


def test_zones_are_colour_coded_chips():
    html = build_permit_letter_html(
        company="X",
        zones=["green", "red", "work_residence"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 8, 1),
        people=P1,
        vehicles=[],
    )
    # Each zone renders as a shaded, named chip in its palette colour.
    assert "background-color:#dcfce7" in html  # green
    assert "background-color:#fee2e2" in html  # red
    assert "background-color:#dbeafe" in html  # work residence (blue)
    assert "المناطق المصرّح بدخولها" in html
