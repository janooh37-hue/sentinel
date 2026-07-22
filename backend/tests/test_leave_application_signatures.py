from app.core.docx_engine import _FORM_REGISTRY
from app.services.template_service import load_fields_meta


def test_all_forms_cap_signature_width() -> None:
    for spec in _FORM_REGISTRY.values():
        adapter = spec["adapter"]
        assert adapter({})["_sig_size_mm"] <= 32
        assert adapter({"_sig_size_mm": 45})["_sig_size_mm"] <= 32


def test_leave_forms_offer_optional_manager_signature() -> None:
    forms = load_fields_meta()
    for name in (
        "Leave Application Form",
        "Leave Permit Form",
        "Administrative Leave Form",
    ):
        fields = forms[name]["fields"]
        assert any(field["key"] == "hand_sign_manager" for field in fields)
