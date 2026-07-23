"""Services catalog: companions are hidden from the gallery list but remain
internally accessible (they still auto-generate with their primary)."""

from __future__ import annotations

from app.core.constants import COMPANION_TEMPLATE_IDS, TEMPLATE_FILES
from app.services import template_service


def test_companions_excluded_from_listing():
    ids = {m.id for m in template_service.list_templates().items}
    assert "Leave Undertaking" not in ids
    assert "Resignation Declaration" not in ids


def test_non_companions_all_listed():
    ids = {m.id for m in template_service.list_templates().items}
    expected = set(TEMPLATE_FILES) - set(COMPANION_TEMPLATE_IDS)
    assert ids == expected


def test_companion_schema_still_accessible():
    # Guards that companions remain generatable internally — we only hide them
    # from the *listing*, we do not remove the template.
    detail = template_service.get_template_fields("Leave Undertaking")
    assert detail.meta.id == "Leave Undertaking"


def test_arabic_names_have_no_form_prefix():
    for meta in template_service.list_templates().items:
        assert not meta.name_ar.startswith("نموذج"), meta.id


def test_acknowledgment_arabic_name_is_material_receipt():
    names = {m.id: m.name_ar for m in template_service.list_templates().items}
    assert names["Acknowledgment Form"] == "استلام المواد"


def test_per_employee_forms_are_personnel_category():
    """Leave Permit and Administrative Leave forms are per-employee (their DOCX
    templates require {{ employee_id }} / {{ employee_name_ar }}, and
    document_service gates the admin_leaves_this_month count on an employee).
    They must be category 'personnel' so ApplicationPage shows the employee
    picker and threads employee_id through — an 'admin' category silently drops
    the picker and blanks every employee token. Regression guard.
    """
    cats = {m.id: m.category for m in template_service.list_templates().items}
    assert cats["Leave Permit Form"] == "personnel"
    assert cats["Administrative Leave Form"] == "personnel"


def test_admin_types_labels_have_no_form_prefix():
    from app.core.constants import ADMIN_TYPES

    joined = "\n".join(ADMIN_TYPES)
    assert "نموذج استلام" not in joined
    assert "نموذج طلب مواد" not in joined
    assert "Acknowledgment Form - استلام المواد" in ADMIN_TYPES
    assert "Material Request Form - طلب مواد" in ADMIN_TYPES


def test_every_listed_template_fields_endpoint_loads():
    """Every listed template's field schema must validate against TemplateField.

    Regression guard: the Report form's _fields.json used field types
    ('employee_picker', 'checkbox') that were absent from the TemplateField.type
    Literal, so get_template_fields('Report') raised a 500 and the form never
    loaded. This asserts no _fields.json entry can carry a type the schema
    rejects — for *any* template, not just Report.
    """
    for meta in template_service.list_templates().items:
        detail = template_service.get_template_fields(meta.id)
        assert detail.meta.id == meta.id


def test_report_fields_include_signer_picker_and_sign_checkbox():
    detail = template_service.get_template_fields("Report")
    by_key = {f.key: f for f in detail.fields}
    assert by_key["signer_id"].type == "employee_picker"
    assert by_key["signer_id"].required is True
    assert by_key["sign"].type == "checkbox"


def test_report_tile_has_no_scannable_code_badge():
    """Report is a no-ref document (no classified register entry), so its
    Services tile must show 'no code', not 'carries a scannable ref code'."""
    metas = {m.id: m for m in template_service.list_templates().items}
    assert metas["Report"].has_code is False
