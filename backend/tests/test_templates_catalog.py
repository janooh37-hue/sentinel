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


def test_admin_types_labels_have_no_form_prefix():
    from app.core.constants import ADMIN_TYPES

    joined = "\n".join(ADMIN_TYPES)
    assert "نموذج استلام" not in joined
    assert "نموذج طلب مواد" not in joined
    assert "Acknowledgment Form - استلام المواد" in ADMIN_TYPES
    assert "Material Request Form - طلب مواد" in ADMIN_TYPES
