# backend/tests/test_permit_letter.py
from datetime import date

from app.core.permit_letter import build_permit_letter_html

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




def test_single_person_single_vehicle():
    html = build_permit_letter_html(
        company="ACME",
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        zones=["green"],
        start_date=date(2026, 7, 1),
        validity_value=1,
        validity_unit="day",
        people=P1,
        vehicles=V1,
    )
    assert "للفرد المبيّن" in html and "بحوزته المركبة" in html and "يتسنّى له القيام بعمله" in html
    assert "الجدول الثاني" in html and "A 1" in html


def test_many_persons_many_vehicles():
    html = build_permit_letter_html(
        company="ACME",
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        zones=["green"],
        start_date=date(2026, 7, 1),
        validity_value=1,
        validity_unit="day",
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
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        zones=["green"],
        start_date=date(2026, 7, 1),
        validity_value=1,
        validity_unit="day",
        people=P2,
        vehicles=[],
    )
    assert "المركبة" not in html and "المركبات" not in html
    assert "الجدول الثاني" not in html
    assert "للأفراد المبيّنين" in html


def test_uses_individual_not_employee_term():
    html = build_permit_letter_html(
        company="ACME",
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        zones=["green"],
        start_date=date(2026, 7, 1),
        validity_value=1,
        validity_unit="day",
        people=P1,
        vehicles=[],
    )
    assert "الموظف" not in html  # generic template: individuals, not employees
    assert "الجدول الثاني" not in html  # no vehicle table when 0 vehicles
    assert "للفرد المبيّن" in html


def test_work_residence_zone_phrase_and_person_term():
    html = build_permit_letter_html(
        company="X",
        access_areas={"al_wathba_1": [], "al_wathba_2": [], "work_residence": True},
        zones=["work_residence"],
        start_date=date(2026, 7, 1),
        validity_value=1,
        validity_unit="day",
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
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        zones=["green"],
        start_date=date(2026, 7, 1),
        validity_value=1,
        validity_unit="month",
        people=P2,
        vehicles=V1,
    )
    base.update(kw)
    return build_permit_letter_html(**base)


def test_company_renders_left_aligned_under_subject():
    # Company is its own bold header line, LEFT-aligned (sits under the subject).
    html = _sample()
    assert "الجهة: Al Nahda Contracting LLC" in html
    assert "text-align:left" in html


def test_body_paragraph_is_justified():
    assert "text-align:justify" in _sample()


def test_info_block_label_right_value_center():
    # validity / purpose / zones render in a borderless 2-col table: bold label
    # right-aligned, value centered.
    html = _sample(purpose="صيانة")
    assert "border:none" in html  # borderless scaffolding
    assert '<td style="text-align:right"><b>صلاحية التصريح:</b></td>' in html
    assert '<td style="text-align:right"><b>الغرض من التصريح:</b></td>' in html
    assert '<td style="text-align:right"><b>مواقع ومناطق الدخول المصرّح بها:</b></td>' in html
    assert '<td style="text-align:center">' in html  # the value cells


def test_validity_uses_period_label_from_start_date():
    html = build_permit_letter_html(
        company="X",
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        zones=["green"],
        start_date=date(2026, 7, 1),
        validity_value=2,
        validity_unit="month",
        people=P1,
        vehicles=[],
    )
    assert "شهران اعتباراً من 2026/07/01" in html
    assert "2026/08/01" not in html


def test_validity_renders_high_count_arabic_categories() -> None:
    hundred_days = _sample(validity_value=100, validity_unit="day")
    hundred_three_days = _sample(validity_value=103, validity_unit="day")

    assert "100 يوم اعتباراً من 2026/07/01" in hundred_days
    assert "103 أيام اعتباراً من 2026/07/01" in hundred_three_days


def test_tables_are_autofit_and_centered():
    # Tables opt into Word AutoFit-to-Contents (width:auto) so columns hug their
    # text and the table centers, instead of stretching full-width.
    html = _sample()
    assert html.count("width:auto") == 2  # people + vehicles
    assert "text-align:center" in html  # data-table cell text is centered


def test_section_titles_are_merged_shaded_header_rows():
    # Titles live INSIDE the table as a merged, shaded row (not a standalone
    # paragraph), keeping the letter compact.
    html = _sample()
    assert 'colspan="5"' in html and "الجدول الأول: بيانات الأفراد" in html
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
        access_areas={
            "al_wathba_1": ["green"],
            "al_wathba_2": ["red"],
            "work_residence": True,
        },
        zones=["green", "red", "work_residence"],
        start_date=date(2026, 7, 1),
        validity_value=1,
        validity_unit="month",
        people=P1,
        vehicles=[],
    )
    # Each zone renders as a shaded, named chip in its palette colour.
    assert "background-color:#dcfce7" in html  # green
    assert "background-color:#fee2e2" in html  # red
    assert "background-color:#dbeafe" in html  # work residence (blue)
    assert "مواقع ومناطق الدخول المصرّح بها" in html


def test_access_rows_preserve_location_zone_pairings():
    html = _sample(
        access_areas={
            "al_wathba_1": ["green"],
            "al_wathba_2": ["red"],
            "work_residence": False,
        },
        zones=["green", "red"],
    )
    assert "الوثبة 1" in html and "المنطقة الخضراء" in html
    assert "الوثبة 2" in html and "المنطقة الحمراء" in html
    assert "المواقع والمناطق الموضحة أدناه" in html
    assert "مواقع ومناطق الدخول المصرّح بها" in html

    w1_start = html.index("الوثبة 1")
    w2_start = html.index("الوثبة 2")
    w1_fragment = html[w1_start:w2_start]
    w2_fragment = html[w2_start:html.index("</td>", w2_start)]
    assert "المنطقة الخضراء" in w1_fragment
    assert "المنطقة الحمراء" not in w1_fragment
    assert "المنطقة الحمراء" in w2_fragment
    assert "المنطقة الخضراء" not in w2_fragment


def test_one_location_keeps_both_zones_on_its_line():
    html = _sample(
        access_areas={
            "al_wathba_1": ["green", "red"],
            "al_wathba_2": [],
            "work_residence": False,
        },
        zones=["green", "red"],
    )
    assert html.count("الوثبة 1") == 1
    assert "الوثبة 2" not in html


def test_legacy_letter_labels_location_unspecified():
    html = _sample(
        access_areas=None,
        zones=["green", "red", "work_residence"],
    )
    assert "الموقع غير محدد" in html
    assert "المنطقة الخضراء" in html and "المنطقة الحمراء" in html
    assert "منطقة أخرى" in html and "سكن العمل" in html


def test_letter_renders_job_and_no_end_date() -> None:
    html = build_permit_letter_html(
        company="ACME",
        start_date=date(2026, 8, 6),
        validity_value=2,
        validity_unit="month",
        people=[
            {
                "name": "Ali",
                "uae_id": "784-1",
                "nationality": "UAE",
                "role": "R&D <lead>",
            },
            {
                "name": "Legacy",
                "uae_id": "784-2",
                "nationality": "UAE",
                "role": None,
            },
        ],
        vehicles=[],
        access_areas={"al_wathba_1": ["green"], "al_wathba_2": [], "work_residence": False},
        zones=["green"],
    )
    expected_header = "<th>م</th><th>الاسم</th><th>رقم الهوية</th><th>الجنسية</th><th>المهنة</th>"
    assert expected_header in html
    people_table_start = html.index("الجدول الأول")
    header_start = html.index('<tr style="background-color:#eef2f6">', people_table_start)
    header_row = html[header_start : html.index("</tr>", header_start) + len("</tr>")]
    assert header_row == f'<tr style="background-color:#eef2f6">{expected_header}</tr>'
    assert header_row.count("<th>") == 5
    first_row = "<tr><td>1</td><td>Ali</td><td>784-1</td><td>UAE</td><td>R&amp;D &lt;lead&gt;</td></tr>"
    legacy_row = "<tr><td>2</td><td>Legacy</td><td>784-2</td><td>UAE</td><td></td></tr>"
    assert first_row in html and first_row.count("<td>") == 5
    assert legacy_row in html and legacy_row.count("<td>") == 5
    assert "شهران اعتباراً من 2026/08/06" in html
    assert "2026/10/05" not in html
