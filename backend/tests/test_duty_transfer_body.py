# backend/tests/test_duty_transfer_body.py
from app.db.models import Employee
from app.services.duty_service import _build_body_html


def _emp(**kw) -> Employee:
    base = dict(id="G3309", name_ar="ماجد خالد محمد الحوسني", name_en="Majid",
                position_ar="حارس أمن", duty_unit="السرية الخامسة", duty_post="تفتيش")
    base.update(kw)
    return Employee(**base)


def test_body_has_intro_columns_rows_and_closing():
    html = _build_body_html([
        (_emp(), "السرية الثانية", "ليوان"),
        (_emp(id="G4017", name_ar="محمد سعيد", duty_unit="السرية الثانية", duty_post="تفتيش"),
         "السرية الثانية", "ليوان"),
    ])
    # Fixed intro (no date, no reason)
    assert "يطيب لنا أن نتقدم لسيادتكم بخالص التحية و التقدير" in html
    assert "إعتباراً من تاريخه" in html
    assert "السبب" not in html  # reason never rendered
    # Five headers, no serial column
    for col in ["الرقم الوظيفي", "المسمى الوظيفي", "الاسم", "من", "إلى"]:
        assert f">{col}<" in html
    assert ">م<" not in html
    # Row data: G-number, job title, name, from (pre-move), to
    assert ">G3309<" in html
    assert ">حارس أمن<" in html
    assert "السرية الخامسة - تفتيش" in html      # من
    assert "السرية الثانية - ليوان" in html       # إلى
    # Red header styling + closing
    assert "#C00000" in html
    assert "للتفضل بالعلم وأمركم حول تعديل الكشوفات لديكم ولإجراءاتكم لطفاً." in html
    assert "هذا وتفضلوا بقبول فائق الإحترام والتقدير." in html


def test_body_has_blank_line_around_table():
    html = _build_body_html([(_emp(), "السرية الثانية", "ليوان")])
    assert "<p>&nbsp;</p><table" in html      # blank line before the table
    assert "</table><p>&nbsp;</p>" in html    # blank line after the table


def test_each_row_carries_its_own_destination():
    """A swap: two employees exchange places in ONE letter."""
    a = _emp(id="G3309", name_ar="ماجد", duty_unit="السرية الأولى", duty_post="البوابة الرئيسية")
    b = _emp(id="G4030", name_ar="سيف", duty_unit="السرية الثانية", duty_post="التفتيش")
    html = _build_body_html([
        (a, "السرية الثانية", "التفتيش"),
        (b, "السرية الأولى", "البوابة الرئيسية"),
    ])
    rows = html.split("<tr>")
    # rows[0] is the pre-table markup, rows[1] the header row.
    assert "السرية الأولى - البوابة الرئيسية" in rows[2]  # من for G3309
    assert "السرية الثانية - التفتيش" in rows[2]          # إلى for G3309
    assert "السرية الثانية - التفتيش" in rows[3]          # من for G4030
    assert "السرية الأولى - البوابة الرئيسية" in rows[3]  # إلى for G4030
