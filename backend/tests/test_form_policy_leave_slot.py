from app.core.form_policy import attachment_slots_of


def test_leave_application_form_has_optional_medical_certificate_slot():
    slots = attachment_slots_of("Leave Application Form")
    keys = [s.key for s in slots]
    assert "medical_certificate" in keys
    slot = next(s for s in slots if s.key == "medical_certificate")
    assert slot.required is False
    assert slot.label_en
    assert slot.label_ar


def test_non_leave_template_unaffected():
    assert attachment_slots_of("General Book") == []
