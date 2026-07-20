from app.core.docx_engine import _adapt_leave_application
from app.services.template_service import load_fields_meta


def test_leave_application_caps_signature_width() -> None:
    assert _adapt_leave_application({})["_sig_size_mm"] == 32
    assert _adapt_leave_application({"_sig_size_mm": 45})["_sig_size_mm"] == 32
    assert _adapt_leave_application({"_sig_size_mm": 24})["_sig_size_mm"] == 24


def test_leave_forms_offer_optional_manager_signature() -> None:
    forms = load_fields_meta()
    for name in (
        "Leave Application Form",
        "Leave Permit Form",
        "Administrative Leave Form",
    ):
        fields = forms[name]["fields"]
        assert any(field["key"] == "hand_sign_manager" for field in fields)
