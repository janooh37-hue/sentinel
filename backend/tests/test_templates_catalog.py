"""Services catalog: companions and aliased forms are hidden from the gallery
list but remain internally accessible (companions auto-generate with their
primary; aliased forms are minted by their own feature)."""

from __future__ import annotations

from app.core.constants import COMPANION_TEMPLATE_IDS, TEMPLATE_FILES
from app.core.form_kind import SERVICE_ALIASES
from app.services import notify_format, template_service


def test_companions_excluded_from_listing():
    ids = {m.id for m in template_service.list_templates().items}
    assert "Leave Undertaking" not in ids
    assert "Resignation Declaration" not in ids


def test_non_companions_all_listed() -> None:
    ids = {m.id for m in template_service.list_templates().items}
    expected = set(TEMPLATE_FILES) - set(COMPANION_TEMPLATE_IDS) - set(SERVICE_ALIASES)
    assert ids == expected


def test_aliased_template_is_hidden_but_still_generatable() -> None:
    """Security Permit is minted only by the permits register, so it owns no
    gallery tile — but its schema must stay reachable or generation breaks."""
    ids = {m.id for m in template_service.list_templates().items}
    assert "Security Permit" not in ids
    detail = template_service.get_template_fields("Security Permit")
    assert detail.meta.id == "Security Permit"
    assert detail.meta.category == "admin"
    assert detail.meta.signing_path == "chain"
    # The rich body field is what routes the letter through html_to_docx.
    assert {f.key: f.type for f in detail.fields}["body"] == "arabic_rich_full"


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


def test_report_form_has_no_rich_body_field():
    detail = template_service.get_template_fields("Report")
    types = {f.type for f in detail.fields}
    assert "arabic_rich_full" not in types  # body is written in Word, not the form
    keys = {f.key for f in detail.fields}
    assert keys == {"signer_id", "recipient_id", "subject", "report_date", "sign"}


def test_every_auto_notifying_template_publishes_capability():
    by_id = {item.id: item for item in template_service.list_templates().items}
    assert notify_format.AUTO_NOTIFY_TEMPLATE_IDS
    for template_id in notify_format.AUTO_NOTIFY_TEMPLATE_IDS:
        assert by_id[template_id].notifies_employee is True


def test_non_notifying_word_templates_publish_false():
    assert template_service.get_template_fields("General Book").meta.notifies_employee is False
    assert template_service.get_template_fields("Report").meta.notifies_employee is False


def test_auto_notify_capability_is_union_of_mapped_and_special_routes():
    assert (
        frozenset(set(notify_format.TEMPLATE_EVENTS) | set(notify_format.SPECIAL_TEMPLATE_ROUTES))
        == notify_format.AUTO_NOTIFY_TEMPLATE_IDS
    )
