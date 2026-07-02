from app.core.export_naming import export_filename


def test_sick_leave_is_gnumber_only():
    assert (
        export_filename(
            employee_id="G3082",
            ref_number="HR-0042",
            template_id="Leave Application Form",
            arabic_name="طلب إجازة مرضية",
            is_sick_leave=True,
            ext=".pdf",
        )
        == "G3082.pdf"
    )


def test_other_form_is_gnumber_plus_arabic():
    assert (
        export_filename(
            employee_id="G3082",
            ref_number="HR-0042",
            template_id="Leave Application Form",
            arabic_name="طلب إجازة سنوية",
            is_sick_leave=False,
            ext=".pdf",
        )
        == "G3082_طلب إجازة سنوية.pdf"
    )


def test_no_employee_falls_back_to_ref():
    assert (
        export_filename(
            employee_id=None,
            ref_number="GS-0333",
            template_id="General Book",
            arabic_name="",
            is_sick_leave=False,
            ext=".pdf",
        )
        == "GS-0333_General Book.pdf"
    )


def test_blank_arabic_falls_back_to_template_id():
    assert (
        export_filename(
            employee_id="G3082",
            ref_number="HR-0042",
            template_id="Material Request Form",
            arabic_name="",
            is_sick_leave=False,
            ext=".pdf",
        )
        == "G3082_Material Request Form.pdf"
    )


def test_sanitizes_unsafe_chars_but_keeps_arabic():
    out = export_filename(
        employee_id="G3082",
        ref_number="HR-0042",
        template_id="X",
        arabic_name="طلب/إجازة",
        is_sick_leave=False,
        ext=".pdf",
    )
    assert out == "G3082_طلب_إجازة.pdf"
    assert "/" not in out


def test_docx_extension():
    assert (
        export_filename(
            employee_id="G3082",
            ref_number="HR-0042",
            template_id="Leave Application Form",
            arabic_name="طلب إجازة مرضية",
            is_sick_leave=True,
            ext=".docx",
        )
        == "G3082.docx"
    )
